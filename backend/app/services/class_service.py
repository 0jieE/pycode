from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.errors import ForbiddenError, NotFoundError
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.user import Role, User
from app.schemas.classroom import ClassCreate, ClassOut, ClassUpdate
from app.services import audit_service


def get_owned_class(db: Session, class_id: int, instructor: User) -> Classroom:
    """The class, if it belongs to this instructor. Used by every instructor-side service."""
    classroom = db.get(Classroom, class_id)
    if classroom is None:
        raise NotFoundError("Class not found", "CLASS_NOT_FOUND")
    if classroom.instructor_id != instructor.id:
        raise ForbiddenError("You do not own this class", "NOT_CLASS_OWNER")
    return classroom


def get_class_for_member(db: Session, class_id: int, user: User) -> Classroom:
    """The class, if `user` is its instructor or one of its approved students. Admins have no access."""
    classroom = db.get(Classroom, class_id)
    if classroom is None:
        raise NotFoundError("Class not found", "CLASS_NOT_FOUND")
    if user.role == Role.INSTRUCTOR and classroom.instructor_id == user.id:
        return classroom
    if user.role == Role.STUDENT and is_approved_student(db, class_id, user.id):
        return classroom
    raise ForbiddenError("You are not a member of this class", "NOT_CLASS_MEMBER")


def is_approved_student(db: Session, class_id: int, student_id: int) -> bool:
    return db.scalar(
        select(Enrollment.id).where(
            Enrollment.class_id == class_id,
            Enrollment.student_id == student_id,
            Enrollment.status == EnrollmentStatus.APPROVED,
        )
    ) is not None


def _counts(db: Session, class_ids: list[int]) -> dict[int, tuple[int, int]]:
    """class_id -> (approved, pending) enrollment counts, in one query."""
    if not class_ids:
        return {}
    rows = db.execute(
        select(
            Enrollment.class_id,
            func.sum(case((Enrollment.status == EnrollmentStatus.APPROVED, 1), else_=0)),
            func.sum(case((Enrollment.status == EnrollmentStatus.PENDING, 1), else_=0)),
        )
        .where(Enrollment.class_id.in_(class_ids))
        .group_by(Enrollment.class_id)
    ).all()
    return {cid: (int(a or 0), int(p or 0)) for cid, a, p in rows}


def _to_out(db: Session, classes: list[Classroom]) -> list[ClassOut]:
    counts = _counts(db, [c.id for c in classes])
    out = []
    for c in classes:
        approved, pending = counts.get(c.id, (0, 0))
        out.append(ClassOut(
            id=c.id, instructor_id=c.instructor_id, name=c.name, year_and_section=c.year_and_section,
            school_year=c.school_year, is_archived=c.is_archived, created_at=c.created_at,
            tutorial_unlock_in_order=c.tutorial_unlock_in_order,
            approved_count=approved, pending_count=pending,
        ))
    return out


def create_class(db: Session, instructor: User, data: ClassCreate, ip: Optional[str]) -> ClassOut:
    classroom = Classroom(
        instructor_id=instructor.id, name=data.name.strip(),
        year_and_section=data.year_and_section.strip(), school_year=data.school_year.strip(),
    )
    db.add(classroom)
    db.flush()
    audit_service.record(db, audit_service.CLASS_CREATE, user_id=instructor.id,
                         details={"class_id": classroom.id}, ip_address=ip)
    db.commit()
    return _to_out(db, [classroom])[0]


def list_classes(db: Session, instructor: User, include_archived: bool,
                 offset: int, limit: int) -> tuple[list[ClassOut], int]:
    stmt = select(Classroom).where(Classroom.instructor_id == instructor.id)
    if not include_archived:
        stmt = stmt.where(Classroom.is_archived.is_(False))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(Classroom.id.desc()).offset(offset).limit(limit)).all()
    return _to_out(db, list(items)), total


def get_class(db: Session, class_id: int, instructor: User) -> ClassOut:
    return _to_out(db, [get_owned_class(db, class_id, instructor)])[0]


def update_class(db: Session, class_id: int, instructor: User, data: ClassUpdate) -> ClassOut:
    classroom = get_owned_class(db, class_id, instructor)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(classroom, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return _to_out(db, [classroom])[0]
