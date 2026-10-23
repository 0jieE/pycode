import logging
from typing import Optional

from sqlalchemy import exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.security import generate_invite_code
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.invite_code import InviteCode
from app.models.lab_session import LabSession
from app.models.user import User
from app.schemas.classroom import InviteCodeCreate, InviteCodeUpdate
from app.schemas.enrollment import (
    EnrollmentAction,
    EnrollmentOut,
    EnrollResponse,
    MyClassOut,
    StudentBrief,
)
from app.services import audit_service, class_service, session_service, workspace_service

logger = logging.getLogger(__name__)

S = EnrollmentStatus

# action -> (statuses it may be applied from, resulting status)
_TRANSITIONS: dict[EnrollmentAction, tuple[set[EnrollmentStatus], EnrollmentStatus]] = {
    EnrollmentAction.APPROVE: ({S.PENDING, S.REJECTED, S.REMOVED}, S.APPROVED),
    EnrollmentAction.REJECT: ({S.PENDING}, S.REJECTED),
    EnrollmentAction.REMOVE: ({S.APPROVED}, S.REMOVED),
}
_AUDIT_ACTION = {
    EnrollmentAction.APPROVE: audit_service.ENROLLMENT_APPROVE,
    EnrollmentAction.REJECT: audit_service.ENROLLMENT_REJECT,
    EnrollmentAction.REMOVE: audit_service.ENROLLMENT_REMOVE,
}


# ---------------------------------------------------------------- invite codes

def _check_window(valid_from, valid_until) -> None:
    if valid_until <= valid_from:
        raise AppError(400, "valid_until must be after valid_from", "INVALID_CODE_WINDOW")


def _unique_code(db: Session) -> str:
    for _ in range(10):
        code = generate_invite_code()
        if db.scalar(select(InviteCode.id).where(InviteCode.code == code)) is None:
            return code
    raise AppError(500, "Could not generate a unique invite code", "CODE_GENERATION_FAILED")


def create_invite_code(db: Session, class_id: int, instructor: User, data: InviteCodeCreate,
                       ip: Optional[str]) -> InviteCode:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    valid_from = data.valid_from or utcnow()
    _check_window(valid_from, data.valid_until)
    code = InviteCode(class_id=classroom.id, code=_unique_code(db), valid_from=valid_from,
                      valid_until=data.valid_until, max_uses=data.max_uses, is_active=True)
    db.add(code)
    db.flush()
    audit_service.record(db, audit_service.INVITE_CODE_CREATE, user_id=instructor.id,
                         details={"class_id": classroom.id, "invite_code_id": code.id}, ip_address=ip)
    db.commit()
    return code


def list_invite_codes(db: Session, class_id: int, instructor: User, offset: int,
                      limit: int) -> tuple[list[InviteCode], int]:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    stmt = select(InviteCode).where(InviteCode.class_id == classroom.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(InviteCode.id.desc()).offset(offset).limit(limit)).all()
    return list(items), total


def update_invite_code(db: Session, code_id: int, instructor: User, data: InviteCodeUpdate,
                       ip: Optional[str]) -> InviteCode:
    code = db.get(InviteCode, code_id)
    if code is None:
        raise NotFoundError("Invite code not found", "CODE_NOT_FOUND")
    class_service.get_owned_class(db, code.class_id, instructor)

    changes = data.model_dump(exclude_unset=True)
    if "is_active" in changes and changes["is_active"] is not None:
        code.is_active = changes["is_active"]
    if changes.get("valid_from") is not None:
        code.valid_from = changes["valid_from"]
    if changes.get("valid_until") is not None:
        code.valid_until = changes["valid_until"]
    if "max_uses" in changes:  # explicit null clears the limit
        code.max_uses = changes["max_uses"]
    _check_window(code.valid_from, code.valid_until)

    audit_service.record(db, audit_service.INVITE_CODE_UPDATE, user_id=instructor.id,
                         details={"invite_code_id": code.id, "fields": sorted(changes)}, ip_address=ip)
    db.commit()
    return code


def _assert_code_usable(code: InviteCode, now) -> None:
    """The three rules of the spec: active, inside its window, and not used up."""
    if not code.is_active:
        raise AppError(400, "This invite code is turned off", "CODE_INACTIVE")
    if now < code.valid_from:
        raise AppError(400, "This invite code is not valid yet", "CODE_NOT_YET_VALID")
    if now > code.valid_until:
        raise AppError(400, "This invite code has expired", "CODE_EXPIRED")
    if code.max_uses is not None and code.use_count >= code.max_uses:
        raise AppError(400, "This invite code has reached its maximum uses", "CODE_EXHAUSTED")


# ------------------------------------------------------------------ joining

def join_class(db: Session, student: User, raw_code: str,
               ip: Optional[str]) -> tuple[EnrollResponse, bool]:
    """Creates a pending enrollment. Returns (response, created).

    Joining a class twice returns the existing enrollment (any status) and never consumes another use.
    """
    code = db.scalar(select(InviteCode).where(InviteCode.code == raw_code.strip().upper()))
    if code is None:
        raise NotFoundError("Invite code not found", "CODE_NOT_FOUND")
    classroom = db.get(Classroom, code.class_id)

    existing = db.scalar(select(Enrollment).where(
        Enrollment.class_id == code.class_id, Enrollment.student_id == student.id))
    if existing is not None:
        return _enroll_response(existing, classroom), False

    _assert_code_usable(code, utcnow())
    if classroom.is_archived:
        raise AppError(400, "This class is archived", "CLASS_ARCHIVED")

    # Atomic claim of one use: the WHERE clause stops concurrent joins from exceeding max_uses.
    claimed = db.execute(
        update(InviteCode)
        .where(InviteCode.id == code.id,
               (InviteCode.max_uses.is_(None)) | (InviteCode.use_count < InviteCode.max_uses))
        .values(use_count=InviteCode.use_count + 1)
    ).rowcount
    if not claimed:
        db.rollback()
        raise AppError(400, "This invite code has reached its maximum uses", "CODE_EXHAUSTED")

    enrollment = Enrollment(class_id=code.class_id, student_id=student.id, invite_code_id=code.id,
                            status=EnrollmentStatus.PENDING)
    db.add(enrollment)
    try:
        db.flush()
    except IntegrityError:  # the same student joined in parallel: hand back the winner's row
        db.rollback()
        existing = db.scalars(select(Enrollment).where(
            Enrollment.class_id == code.class_id, Enrollment.student_id == student.id)).one()
        return _enroll_response(existing, classroom), False

    audit_service.record(db, audit_service.ENROLL_REQUEST, user_id=student.id,
                         details={"class_id": code.class_id, "invite_code_id": code.id}, ip_address=ip)
    db.commit()
    return _enroll_response(enrollment, classroom), True


def _enroll_response(enrollment: Enrollment, classroom: Classroom) -> EnrollResponse:
    return EnrollResponse(enrollment_id=enrollment.id, class_id=classroom.id,
                          class_name=classroom.name, status=enrollment.status)


# ---------------------------------------------------------- instructor review

def _to_out(enrollment: Enrollment, student: User) -> EnrollmentOut:
    return EnrollmentOut(
        id=enrollment.id, class_id=enrollment.class_id, status=enrollment.status,
        student=StudentBrief(id=student.id, username=student.username,
                             full_name=student.full_name, student_no=student.student_no),
        requested_at=enrollment.created_at, reviewed_by=enrollment.reviewed_by,
        reviewed_at=enrollment.reviewed_at,
    )


def list_enrollments(db: Session, class_id: int, instructor: User, status: Optional[EnrollmentStatus],
                     offset: int, limit: int) -> tuple[list[EnrollmentOut], int]:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    stmt = (select(Enrollment, User).join(User, User.id == Enrollment.student_id)
            .where(Enrollment.class_id == classroom.id))
    if status is not None:
        stmt = stmt.where(Enrollment.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Enrollment.created_at, Enrollment.id).offset(offset).limit(limit)).all()
    return [_to_out(e, u) for e, u in rows], total


def review_enrollment(db: Session, enrollment_id: int, instructor: User, action: EnrollmentAction,
                      ip: Optional[str]) -> EnrollmentOut:
    enrollment = db.get(Enrollment, enrollment_id)
    if enrollment is None:
        raise NotFoundError("Enrollment not found", "ENROLLMENT_NOT_FOUND")
    class_service.get_owned_class(db, enrollment.class_id, instructor)
    student = db.get(User, enrollment.student_id)

    allowed_from, target = _TRANSITIONS[action]
    if enrollment.status == target:  # e.g. a double-clicked Approve: nothing to do
        return _to_out(enrollment, student)
    if enrollment.status not in allowed_from:
        raise ConflictError(
            f"Cannot {action.value} an enrollment that is {enrollment.status.value}", "INVALID_TRANSITION")

    enrollment.status = target
    enrollment.reviewed_by = instructor.id
    enrollment.reviewed_at = utcnow()
    if target == EnrollmentStatus.APPROVED:
        workspace = workspace_service.ensure_workspace(db, enrollment.student_id, enrollment.class_id)
        workspace_service.install_published_activities(db, workspace)

    audit_service.record(db, _AUDIT_ACTION[action], user_id=instructor.id,
                         details={"enrollment_id": enrollment.id, "class_id": enrollment.class_id,
                                  "student_id": enrollment.student_id}, ip_address=ip)
    db.commit()
    return _to_out(enrollment, student)


# ------------------------------------------------------------------ student

def my_classes(db: Session, student: User, offset: int, limit: int) -> tuple[list[MyClassOut], int]:
    lab_open = exists().where(LabSession.class_id == Classroom.id, session_service.running())
    stmt = (
        select(Enrollment, Classroom, User.full_name, lab_open.label("lab_open"))
        .join(Classroom, Classroom.id == Enrollment.class_id)
        .join(User, User.id == Classroom.instructor_id)
        .where(Enrollment.student_id == student.id, Enrollment.status != EnrollmentStatus.REMOVED)
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Classroom.name, Enrollment.id).offset(offset).limit(limit)).all()
    return [
        MyClassOut(enrollment_id=e.id, status=e.status, class_id=c.id, class_name=c.name,
                   year_and_section=c.year_and_section, school_year=c.school_year, instructor_name=teacher,
                   is_archived=c.is_archived, lab_open=bool(is_open))
        for e, c, teacher, is_open in rows
    ], total
