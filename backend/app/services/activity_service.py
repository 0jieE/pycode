import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.redis import publish_event
from app.models.activity import Activity
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.user import Role, User
from app.schemas.activity import ActivityCreate, ActivityUpdate, Requirements, StarterFile
from app.services import audit_service, class_service, session_service, storage_service, workspace_service

logger = logging.getLogger(__name__)

MAX_STARTER_FILES = 50
MAX_STARTER_TOTAL_BYTES = 1024 * 1024


# ----------------------------------------------------------------- validation

def _validate_title(title: str) -> str:
    """The title becomes a top-level folder in every student workspace, so it must be a single valid name."""
    title = title.strip()
    if "/" in title:
        raise AppError(400, "Title cannot contain '/'", "INVALID_TITLE")
    try:
        return workspace_service.normalize_path(title)
    except AppError as exc:
        raise AppError(400, exc.detail.replace("Invalid path", "Invalid title"), "INVALID_TITLE")


def _validate_entry_file(raw: str) -> str:
    """The program graded for this activity: a .py path relative to the activity folder."""
    path = workspace_service.normalize_file_path(raw)
    if not path.lower().endswith(".py"):
        raise AppError(400, "entry_file must be a .py file", "INVALID_ENTRY_FILE")
    return path


def _validate_starter_files(db: Session, title: str, files: list[StarterFile]) -> list[dict[str, str]]:
    max_file = storage_service.role_limits(db, Role.STUDENT).max_file_bytes
    if len(files) > MAX_STARTER_FILES:
        raise AppError(400, f"At most {MAX_STARTER_FILES} starter files", "INVALID_STARTER_FILES")
    seen: set[str] = set()
    total = 0
    cleaned: list[dict[str, str]] = []
    for f in files:
        path = workspace_service.normalize_file_path(f.path)
        if len(f"{title}/{path}") > workspace_service.MAX_PATH_LENGTH:
            raise AppError(400, f"Path too long once placed in the activity folder: {path}", "INVALID_PATH")
        if path.lower() in seen:
            raise AppError(400, f"Duplicate starter file: {path}", "INVALID_STARTER_FILES")
        seen.add(path.lower())
        size = len(f.content.encode("utf-8"))
        if size > max_file:      # (copied into every student's workspace: the students' file limit)
            raise AppError(400, f"{path} is larger than {storage_service.human(max_file)}", "FILE_TOO_LARGE")
        total += size
        cleaned.append({"path": path, "content": f.content})
    if total > MAX_STARTER_TOTAL_BYTES:
        raise AppError(400, "Starter files are larger than 1 MB in total", "INVALID_STARTER_FILES")
    return cleaned


def _assert_title_free(db: Session, class_id: int, title: str, exclude_id: Optional[int] = None) -> None:
    stmt = select(Activity.id).where(Activity.class_id == class_id, Activity.title == title)
    if exclude_id is not None:
        stmt = stmt.where(Activity.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise ConflictError("This class already has an activity with that title", "TITLE_TAKEN")


# ------------------------------------------------------------------- access

def _get_activity(db: Session, activity_id: int) -> Activity:
    activity = db.get(Activity, activity_id)
    if activity is None:
        raise NotFoundError("Activity not found", "ACTIVITY_NOT_FOUND")
    return activity


def _get_visible(db: Session, activity_id: int, user: User) -> Activity:
    """Instructor owner: any activity. Approved student: published ones only (drafts look nonexistent)."""
    activity = _get_activity(db, activity_id)
    class_service.get_class_for_member(db, activity.class_id, user)
    if user.role == Role.STUDENT and (not activity.is_published or activity.is_archived):
        raise NotFoundError("Activity not found", "ACTIVITY_NOT_FOUND")
    return activity


def _get_owned(db: Session, activity_id: int, instructor: User) -> Activity:
    activity = _get_activity(db, activity_id)
    class_service.get_owned_class(db, activity.class_id, instructor)
    return activity


def get_owned_activity(db: Session, activity_id: int, instructor: User) -> Activity:
    """The activity, if it belongs to a class of this instructor (used by the test-case service)."""
    return _get_owned(db, activity_id, instructor)


def get_visible_activity(db: Session, activity_id: int, user: User) -> Activity:
    return _get_visible(db, activity_id, user)


# --------------------------------------------------------------------- CRUD

def create_activity(db: Session, class_id: int, instructor: User, data: ActivityCreate,
                    ip: Optional[str]) -> Activity:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    title = _validate_title(data.title)
    files = _validate_starter_files(db, title, data.starter_files)
    _assert_title_free(db, classroom.id, title)

    activity = Activity(class_id=classroom.id, title=title, instructions=data.instructions,
                        starter_files=files, due_at=data.due_at, is_published=False,
                        entry_file=_validate_entry_file(data.entry_file),
                        ignore_input_prompts=data.ignore_input_prompts)
    db.add(activity)
    db.flush()
    audit_service.record(db, audit_service.ACTIVITY_CREATE, user_id=instructor.id,
                         details={"class_id": classroom.id, "activity_id": activity.id}, ip_address=ip)
    db.commit()
    return activity


def list_activities(db: Session, class_id: int, user: User, offset: int, limit: int,
                    include_archived: bool = False) -> tuple[list[Activity], int]:
    class_service.get_class_for_member(db, class_id, user)
    stmt = select(Activity).where(Activity.class_id == class_id)
    if user.role == Role.STUDENT:
        stmt = stmt.where(Activity.is_published.is_(True), Activity.is_archived.is_(False))
    elif not include_archived:
        stmt = stmt.where(Activity.is_archived.is_(False))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(Activity.id).offset(offset).limit(limit)).all()
    return list(items), total


def get_activity(db: Session, activity_id: int, user: User) -> Activity:
    return _get_visible(db, activity_id, user)


def update_activity(db: Session, activity_id: int, instructor: User, data: ActivityUpdate,
                    ip: Optional[str]) -> Activity:
    activity = _get_owned(db, activity_id, instructor)
    changes = data.model_dump(exclude_unset=True)

    wants_title = changes.get("title") is not None
    wants_files = changes.get("starter_files") is not None
    if activity.is_published and (wants_title or wants_files):
        raise ConflictError(
            "Title and starter files can't change after publishing (students already have the folder)",
            "ACTIVITY_PUBLISHED")

    title = _validate_title(changes["title"]) if wants_title else activity.title
    if wants_title:
        _assert_title_free(db, activity.class_id, title, exclude_id=activity.id)
    if wants_title or wants_files:
        raw_files = data.starter_files if wants_files else [StarterFile(**f) for f in activity.starter_files or []]
        activity.starter_files = _validate_starter_files(db, title, raw_files)
        activity.title = title
    if "instructions" in changes:
        activity.instructions = changes["instructions"]
    if "due_at" in changes:
        activity.due_at = changes["due_at"]
    # Grading settings stay editable after publishing (unlike the title and starter files).
    if changes.get("entry_file") is not None:
        activity.entry_file = _validate_entry_file(changes["entry_file"])
    if changes.get("ignore_input_prompts") is not None:
        activity.ignore_input_prompts = changes["ignore_input_prompts"]
    if changes.get("is_archived") is not None and changes["is_archived"] != activity.is_archived:
        if not activity.is_published:
            raise AppError(400, "Only published activities can be archived; delete the draft instead",
                           "ACTIVITY_NOT_PUBLISHED")
        activity.is_archived = changes["is_archived"]
        if not activity.is_archived:
            # Back in view: students who joined while it was archived get its folder now (nothing is overwritten).
            for student_id in db.scalars(select(Enrollment.student_id).where(
                    Enrollment.class_id == activity.class_id, Enrollment.status == EnrollmentStatus.APPROVED)):
                workspace = workspace_service.ensure_workspace(db, student_id, activity.class_id)
                workspace_service.install_activity(db, workspace.id, activity)
        audit_service.record(db, audit_service.ACTIVITY_ARCHIVE, user_id=instructor.id,
                             details={"activity_id": activity.id, "archived": activity.is_archived}, ip_address=ip)

    audit_service.record(db, audit_service.ACTIVITY_UPDATE, user_id=instructor.id,
                         details={"activity_id": activity.id, "fields": sorted(changes)}, ip_address=ip)
    db.commit()
    return activity


def publish_activity(db: Session, activity_id: int, instructor: User, ip: Optional[str]) -> Activity:
    """Marks the activity published and creates its folder in every approved student's workspace.

    Existing paths are never overwritten. Everything happens in one transaction.
    """
    activity = _get_owned(db, activity_id, instructor)
    if activity.is_published:
        raise ConflictError("This activity is already published", "ACTIVITY_ALREADY_PUBLISHED")

    activity.is_published = True
    student_ids = db.scalars(
        select(Enrollment.student_id).where(
            Enrollment.class_id == activity.class_id, Enrollment.status == EnrollmentStatus.APPROVED)
    ).all()
    for student_id in student_ids:
        workspace = workspace_service.ensure_workspace(db, student_id, activity.class_id)
        workspace_service.install_activity(db, workspace.id, activity)

    audit_service.record(db, audit_service.ACTIVITY_PUBLISH, user_id=instructor.id,
                         details={"activity_id": activity.id, "students": len(student_ids)}, ip_address=ip)
    db.commit()
    publish_event(session_service.class_channel(activity.class_id),
                  {"type": "activity_published", "activity_id": activity.id, "title": activity.title})
    return activity


def delete_activity(db: Session, activity_id: int, instructor: User, ip: Optional[str]) -> None:
    """Drafts only: a draft has no student folders, submissions or grades. Its test cases go with it (FK cascade);
    executions keep their row with activity_id NULL (FK SET NULL). A published activity can be archived instead."""
    activity = _get_owned(db, activity_id, instructor)
    if activity.is_published:
        raise ConflictError("Published activities can be archived, not deleted", "ACTIVITY_PUBLISHED")
    audit_service.record(db, audit_service.ACTIVITY_DELETE, user_id=instructor.id,
                         details={"activity_id": activity.id, "class_id": activity.class_id, "title": activity.title},
                         ip_address=ip)
    db.delete(activity)
    db.commit()


def validate_starter_files(db: Session, title: str, files: list[StarterFile]) -> list[dict[str, str]]:
    """Public wrapper: the same path / size / count rules as for an activity's starter files."""
    return _validate_starter_files(db, title, files)


# ------------------------------------------------------------------------------------- code requirements

def get_requirements(db: Session, activity_id: int, instructor: User) -> Requirements:
    activity = get_owned_activity(db, activity_id, instructor)
    return Requirements.model_validate(activity.requirements or {})


def set_requirements(db: Session, activity_id: int, instructor: User, data: Requirements,
                     ip: Optional[str]) -> Requirements:
    """Replaces the activity's requirements (all empty = none). They apply to the next Test and grading; existing
    grades change only with a regrade."""
    activity = get_owned_activity(db, activity_id, instructor)
    activity.requirements = None if data.is_empty() else data.model_dump()
    audit_service.record(db, audit_service.ACTIVITY_UPDATE, user_id=instructor.id,
                         details={"activity_id": activity.id, "fields": ["requirements"]}, ip_address=ip)
    db.commit()
    return Requirements.model_validate(activity.requirements or {})
