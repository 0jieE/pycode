import csv
import io
import logging
from typing import Optional

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import generate_temp_password, hash_password
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.execution import Execution, ExecutionStatus
from app.models.lab_session import LabSession
from app.models.submission import Submission
from app.models.tutorial import TutorialProgress
from app.models.user import Role, User
from app.models.workspace import Workspace, WorkspaceFile
from app.schemas.user import (
    PASSWORD_MAX,
    PASSWORD_MIN,
    ImportResult,
    ImportRowError,
    UserCreate,
    UserUpdate,
    USERNAME_RE,
)
from app.services import audit_service

logger = logging.getLogger(__name__)

IMPORT_COLUMNS = ("student_no", "full_name", "username", "temp_password")
IMPORT_MAX_BYTES = 256 * 1024
IMPORT_MAX_ROWS = 1000


# ------------------------------------------------------------------------------- the one administrator
# The system has exactly ONE admin account, created by the first setup (app.seed). The users API never creates,
# lists, changes, deactivates or demotes it; the admin manages its own account through /me, and a lost password is
# recovered on the server with `python -m app.reset_admin`. The database enforces it too (uq_users_single_admin).

def admin_role_reserved() -> ForbiddenError:
    return ForbiddenError("There is only one administrator account: no other account can be an administrator",
                          "ADMIN_ROLE_RESERVED")


def admin_protected(what: str) -> ConflictError:
    return ConflictError(f"The administrator account cannot be {what}. The administrator changes its own name and "
                         "password under My account.", "ADMIN_PROTECTED")


def get_admin(db: Session) -> Optional[User]:
    return db.scalar(select(User).where(User.role == Role.ADMIN))


def create_admin(db: Session, username: str, full_name: str, password: Optional[str] = None) -> tuple[User, str]:
    """The first setup only (app.seed): the one administrator, with a generated password unless one is given.
    Refused when an administrator already exists."""
    if get_admin(db) is not None:
        raise ConflictError("The administrator account already exists", "ADMIN_EXISTS")
    _assert_unique(db, username, None)
    password = password or generate_temp_password()
    admin = User(username=username, password_hash=hash_password(password), full_name=full_name, role=Role.ADMIN)
    db.add(admin)
    db.flush()
    audit_service.record(db, audit_service.USER_CREATE, user_id=None,
                         details={"target_id": admin.id, "username": admin.username, "role": admin.role.value})
    _commit_or_conflict(db)
    return admin, password


def get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    return user


def _managed_user(db: Session, user_id: int, what: str) -> User:
    """A user the admin may manage: anyone but the administrator itself."""
    user = get_user(db, user_id)
    if user.role == Role.ADMIN:
        raise admin_protected(what)
    return user


def user_counts(db: Session) -> dict[str, int]:
    rows = dict(db.execute(select(User.role, func.count()).where(User.role != Role.ADMIN).group_by(User.role)).all())
    return {"instructors": rows.get(Role.INSTRUCTOR, 0), "students": rows.get(Role.STUDENT, 0)}


def list_users(
    db: Session, role: Optional[Role], q: Optional[str], offset: int, limit: int
) -> tuple[list[User], int]:
    """Instructors and students; the administrator is never listed."""
    stmt = select(User).where(User.role != Role.ADMIN)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(User.username.like(like), User.full_name.like(like), User.student_no.like(like))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(User.id).offset(offset).limit(limit)).all()
    return list(items), total


def _assert_unique(db: Session, username: Optional[str], student_no: Optional[str],
                   exclude_id: Optional[int] = None) -> None:
    if username is not None:
        stmt = select(User.id).where(User.username == username)
        if exclude_id is not None:
            stmt = stmt.where(User.id != exclude_id)
        if db.scalar(stmt) is not None:
            raise ConflictError("Username is already taken", "USERNAME_TAKEN")
    if student_no is not None:
        stmt = select(User.id).where(User.student_no == student_no)
        if exclude_id is not None:
            stmt = stmt.where(User.id != exclude_id)
        if db.scalar(stmt) is not None:
            raise ConflictError("Student number is already in use", "STUDENT_NO_TAKEN")


def assert_username_free(db: Session, username: str, exclude_id: Optional[int] = None) -> None:
    _assert_unique(db, username, None, exclude_id=exclude_id)


def commit_or_conflict(db: Session) -> None:
    _commit_or_conflict(db)


def _commit_or_conflict(db: Session) -> None:
    """Backstop for races between the uniqueness pre-check and the insert."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("Username or student number is already in use", "DUPLICATE_USER")


def create_user(db: Session, data: UserCreate, actor_id: Optional[int] = None,
                ip: Optional[str] = None) -> User:
    if data.role == Role.ADMIN:
        raise admin_role_reserved()
    student_no = data.student_no.strip() if data.student_no else None
    _assert_unique(db, data.username, student_no)
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        full_name=data.full_name.strip(),
        student_no=student_no,
        role=data.role,
    )
    db.add(user)
    db.flush()
    audit_service.record(
        db, audit_service.USER_CREATE, user_id=actor_id,
        details={"target_id": user.id, "username": user.username, "role": user.role.value}, ip_address=ip,
    )
    _commit_or_conflict(db)
    return user


def update_user(db: Session, user_id: int, data: UserUpdate, actor: User,
                ip: Optional[str] = None) -> User:
    changes = data.model_dump(exclude_unset=True)
    if changes.get("role") == Role.ADMIN:
        raise admin_role_reserved()
    user = _managed_user(db, user_id, "changed, deactivated or demoted here")
    role = changes.pop("role", None)
    if role is not None and role != user.role:
        raise AppError(400, "An account's role cannot be changed", "ROLE_CHANGE_NOT_ALLOWED")

    if "student_no" in changes:
        _assert_unique(db, None, changes["student_no"], exclude_id=user.id)
        user.student_no = changes["student_no"]
    if changes.get("full_name"):
        user.full_name = changes["full_name"].strip()
    if "is_active" in changes and changes["is_active"] is not None:
        user.is_active = changes["is_active"]
        if not user.is_active:
            user.current_session_id = None  # kick them out immediately

    audit_service.record(
        db, audit_service.USER_UPDATE, user_id=actor.id,
        details={"target_id": user.id, "fields": sorted(changes)}, ip_address=ip,
    )
    _commit_or_conflict(db)
    return user


def reset_password(db: Session, user_id: int, new_password: Optional[str], actor: User,
                   ip: Optional[str] = None) -> str:
    """Sets a new password (generated if none given) and ends the user's current session."""
    user = _managed_user(db, user_id, "reset here (on the server: python -m app.reset_admin)")
    password = new_password or generate_temp_password()
    user.password_hash = hash_password(password)
    user.current_session_id = None
    user.must_change_password = True  # the admin knows this password: the user has to choose their own
    audit_service.record(
        db, audit_service.PASSWORD_RESET, user_id=actor.id, details={"target_id": user.id}, ip_address=ip
    )
    db.commit()
    return password


# ------------------------------------------------------------------------------- deleting an account
# A hard delete: the account and everything that is only theirs (workspaces with files and versions, submissions
# with grades and snapshots, runs and their output, enrollments, tutorial progress, sign-in log, session starts).
# Kept: the audit trail (its rows lose the user id; the deletion itself is recorded with the username).
# Refused while it would break something else: an instructor who still owns classes (a class cannot be deleted or
# given to another instructor, and deleting it would take the students' grades with it), or a run still in progress.

def _blockers(db: Session, user: User, classes: int) -> list[dict[str, str]]:
    blocked = []
    if classes:
        blocked.append({"code": "USER_HAS_CLASSES", "message": (
            f"This instructor still owns {classes} class{'es' if classes != 1 else ''}. Classes cannot be deleted "
            "or moved to another instructor, so deactivate the account instead.")})
    active = db.scalar(select(func.count()).select_from(Execution).where(
        Execution.student_id == user.id,
        Execution.status.in_([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING])))
    if active:
        blocked.append({"code": "USER_RUN_ACTIVE",
                        "message": "A run of this account is still in progress. Try again in a few seconds."})
    return blocked


def deletion_preview(db: Session, user_id: int) -> dict:
    """What DELETE /users/{id} would remove, and what (if anything) blocks it."""
    user = _managed_user(db, user_id, "deleted")
    uid = user.id
    count = lambda stmt: db.scalar(stmt) or 0  # noqa: E731
    classes = count(select(func.count()).select_from(Classroom).where(Classroom.instructor_id == uid))
    files = db.execute(
        select(func.count(), func.coalesce(func.sum(WorkspaceFile.size_bytes), 0))
        .join(Workspace, Workspace.id == WorkspaceFile.workspace_id)
        .where(Workspace.student_id == uid, WorkspaceFile.is_folder.is_(False))).one()
    open_class_ids = select(Enrollment.class_id).where(
        Enrollment.student_id == uid, Enrollment.status == EnrollmentStatus.APPROVED)
    owned_class_ids = select(Classroom.id).where(Classroom.instructor_id == uid)
    in_open_session = db.scalar(select(LabSession.id).where(
        LabSession.is_open.is_(True),
        or_(LabSession.class_id.in_(open_class_ids), LabSession.class_id.in_(owned_class_ids))).limit(1)) is not None
    return {
        "user_id": uid, "username": user.username, "full_name": user.full_name, "role": user.role,
        "classes": classes,
        "enrollments": count(select(func.count()).select_from(Enrollment).where(Enrollment.student_id == uid)),
        "submissions": count(select(func.count()).select_from(Submission).where(Submission.student_id == uid)),
        "executions": count(select(func.count()).select_from(Execution).where(Execution.student_id == uid)),
        "workspaces": count(select(func.count()).select_from(Workspace).where(Workspace.student_id == uid)),
        "workspace_files": int(files[0]), "workspace_bytes": int(files[1]),
        "tutorial_lessons": count(select(func.count()).select_from(TutorialProgress)
                                  .where(TutorialProgress.student_id == uid)),
        "in_open_session": in_open_session,
        "blocked_by": _blockers(db, user, classes),
    }


def delete_user(db: Session, user_id: int, actor: User, ip: Optional[str] = None) -> None:
    """Hard-deletes an instructor or student (see above). Their signed-in sessions end at once: the next request
    with their token gets 401, and an open WebSocket is closed within 20 s."""
    _managed_user(db, user_id, "deleted")
    # Lock the account row first: a class, submission or run being created for it at the same moment (each takes a
    # shared lock on this row through its foreign key) waits for this transaction instead of slipping past the checks.
    user = db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    preview = deletion_preview(db, user_id)
    if preview["blocked_by"]:
        first = preview["blocked_by"][0]
        db.rollback()
        raise ConflictError(first["message"], first["code"], blocked_by=preview["blocked_by"],
                            classes=preview["classes"])

    uid = user.id
    no_sync = {"synchronize_session": False}
    db.execute(delete(Execution).where(Execution.student_id == uid), execution_options=no_sync)
    db.execute(delete(Submission).where(Submission.student_id == uid), execution_options=no_sync)  # + files
    db.execute(update(Enrollment).where(Enrollment.reviewed_by == uid).values(reviewed_by=None),
               execution_options=no_sync)
    db.execute(delete(Enrollment).where(Enrollment.student_id == uid), execution_options=no_sync)
    db.execute(delete(Workspace).where(Workspace.student_id == uid), execution_options=no_sync)  # + files, versions
    audit_service.record(db, audit_service.USER_DELETE, user_id=actor.id, ip_address=ip, details={
        "target_id": uid, "username": user.username, "role": user.role.value,
        **{k: preview[k] for k in ("enrollments", "submissions", "executions", "workspace_files")}})
    # The rest goes with the row: tutorial progress, sign-in log and session starts (ON DELETE CASCADE); the user id
    # in the audit trail and on storage limits becomes NULL (ON DELETE SET NULL).
    db.execute(delete(User).where(User.id == uid), execution_options=no_sync)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.exception("user delete refused by a foreign key", extra={"target_id": uid})
        raise ConflictError("This account is still referenced by other records and cannot be deleted. "
                            "Deactivate it instead.", "USER_IN_USE")
    db.expunge(user)


def _validate_import_row(row: dict[str, str]) -> Optional[str]:
    if not all(row[c] for c in IMPORT_COLUMNS):
        return "student_no, full_name, username and temp_password are all required"
    if not USERNAME_RE.match(row["username"]):
        return "username must be 3-64 characters: letters, digits, dot, underscore or dash"
    if not PASSWORD_MIN <= len(row["temp_password"]) <= PASSWORD_MAX:
        return f"temp_password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters"
    if len(row["student_no"]) > 32 or len(row["full_name"]) > 150:
        return "student_no (max 32) or full_name (max 150) is too long"
    return None


def _parse_import_csv(content: bytes) -> list[tuple[int, dict[str, str]]]:
    if len(content) > IMPORT_MAX_BYTES:
        raise AppError(413, "CSV file is too large (max 256 KB)", "FILE_TOO_LARGE")
    try:
        text = content.decode("utf-8-sig")  # tolerate the BOM Excel adds
    except UnicodeDecodeError:
        raise AppError(400, "CSV must be UTF-8 encoded", "INVALID_CSV")

    reader = csv.DictReader(io.StringIO(text))
    header = [h.strip().lower() for h in (reader.fieldnames or [])]
    missing = [c for c in IMPORT_COLUMNS if c not in header]
    if missing:
        raise AppError(400, f"CSV is missing columns: {', '.join(missing)}", "INVALID_CSV")
    reader.fieldnames = header

    rows: list[tuple[int, dict[str, str]]] = []
    for line_no, raw in enumerate(reader, start=2):
        rows.append((line_no, {c: (raw.get(c) or "").strip() for c in (*IMPORT_COLUMNS, "role") if c in header}))
        if len(rows) > IMPORT_MAX_ROWS:
            raise AppError(400, f"CSV has more than {IMPORT_MAX_ROWS} rows", "INVALID_CSV")
    if not rows:
        raise AppError(400, "CSV has no student rows", "INVALID_CSV")
    return rows


def import_students(db: Session, content: bytes, actor: User, ip: Optional[str] = None) -> ImportResult:
    """Creates a student account per valid row; invalid or duplicate rows are reported, not fatal. An optional
    `role` column may only say student: "admin" anywhere rejects the whole file, another role skips that row."""
    rows = _parse_import_csv(content)
    if any(row.get("role", "").lower() == Role.ADMIN.value for _, row in rows):
        raise admin_role_reserved()

    taken_usernames = {u.lower() for u in db.scalars(select(User.username))}
    taken_student_nos = {s.lower() for s in db.scalars(select(User.student_no)) if s}

    errors: list[ImportRowError] = []
    to_create: list[User] = []
    for line_no, row in rows:
        problem = _validate_import_row(row)
        if problem is None and row.get("role", "").lower() not in ("", Role.STUDENT.value):
            problem = "only student accounts can be imported"
        if problem is None and row["username"].lower() in taken_usernames:
            problem = "username already exists"
        if problem is None and row["student_no"].lower() in taken_student_nos:
            problem = "student_no already exists"
        if problem:
            errors.append(ImportRowError(row=line_no, username=row["username"] or None, detail=problem))
            continue
        taken_usernames.add(row["username"].lower())
        taken_student_nos.add(row["student_no"].lower())
        to_create.append(User(
            username=row["username"],
            password_hash=hash_password(row["temp_password"]),
            full_name=row["full_name"],
            student_no=row["student_no"],
            role=Role.STUDENT,
            must_change_password=True,  # CSV passwords are temporary
        ))

    db.add_all(to_create)
    audit_service.record(
        db, audit_service.USER_IMPORT, user_id=actor.id,
        details={"created": len(to_create), "skipped": len(errors)}, ip_address=ip,
    )
    _commit_or_conflict(db)
    return ImportResult(created=len(to_create), skipped=len(errors), errors=errors)
