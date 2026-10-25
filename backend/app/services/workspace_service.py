"""Workspace helpers: path validation, workspace creation and starter-file installation.
File CRUD, quotas and versions arrive in Phase 5 on top of these."""
from datetime import datetime, timedelta
from pathlib import PurePosixPath
from typing import Any, Optional

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.models.activity import Activity
from app.models.user import User
from app.models.workspace import FileVersion, Workspace, WorkspaceFile
from app.schemas.workspace import (
    CreateEntryRequest,
    FileMeta,
    FileOut,
    SaveFileRequest,
    TreeOut,
    Usage,
    VersionMeta,
    VersionOut,
)
from app.schemas.storage import ClearResult
from app.services import (audit_service, class_service, monitor_service, session_service, start_service,
                          storage_service)

ALLOWED_EXTENSIONS = frozenset({".py", ".txt", ".csv", ".json", ".md"})
MAX_PATH_LENGTH = 255
# File size, workspace size and file count are set by an admin per role / per user: storage_service.limits_for.
MAX_FOLDERS = 100  # not in the spec: stops a student filling the table with empty folders
MAX_VERSIONS = 20


def _invalid_path(reason: str) -> AppError:
    return AppError(400, f"Invalid path: {reason}", "INVALID_PATH")


def normalize_path(raw: str) -> str:
    """Validates a workspace-relative path and returns it normalized. Raises INVALID_PATH.

    Rejects: empty, longer than 255, absolute, backslashes, control characters, empty segments
    ("a//b", trailing "/"), "." / ".." segments, names starting with ".", and any path that
    PurePosixPath would rewrite (so what is stored is exactly what was checked).
    """
    if not isinstance(raw, str) or not raw:
        raise _invalid_path("path is empty")
    if len(raw) > MAX_PATH_LENGTH:
        raise _invalid_path(f"longer than {MAX_PATH_LENGTH} characters")
    if "\\" in raw:
        raise _invalid_path("backslashes are not allowed")
    if any(ord(ch) < 32 for ch in raw):
        raise _invalid_path("control characters are not allowed")
    if raw.startswith("/") or PurePosixPath(raw).is_absolute():
        raise _invalid_path("absolute paths are not allowed")
    segments = raw.split("/")
    if any(seg == "" for seg in segments):
        raise _invalid_path("empty path segment")
    if any(seg in (".", "..") for seg in segments):
        raise _invalid_path("'.' and '..' are not allowed")
    if any(seg.startswith(".") for seg in segments):
        raise _invalid_path("names cannot start with '.'")
    if any(seg != seg.strip() for seg in segments):
        raise _invalid_path("names cannot start or end with spaces")
    normalized = str(PurePosixPath(raw))
    if normalized != raw:
        raise _invalid_path("path is not in normal form")
    return normalized


def normalize_file_path(raw: str) -> str:
    """normalize_path + the allowed-extension rule (.py .txt .csv .json .md)."""
    path = normalize_path(raw)
    if PurePosixPath(path).suffix.lower() not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise AppError(400, f"File type not allowed (use {allowed})", "INVALID_EXTENSION")
    return path


def ensure_workspace(db: Session, student_id: int, class_id: int) -> Workspace:
    """Returns the student's workspace for the class, creating it if missing (race-safe)."""
    stmt = mysql_insert(Workspace).values(student_id=student_id, class_id=class_id)
    db.execute(stmt.on_duplicate_key_update(student_id=stmt.inserted.student_id))
    return db.scalars(
        select(Workspace).where(Workspace.student_id == student_id, Workspace.class_id == class_id)
    ).one()


def _insert_if_missing(db: Session, workspace_id: int, path: str, is_folder: bool, content: str | None) -> None:
    """INSERT ... ON DUPLICATE KEY no-op: an existing path is never overwritten, even under a race."""
    stmt = mysql_insert(WorkspaceFile).values(
        workspace_id=workspace_id,
        path=path,
        is_folder=is_folder,
        content=content,
        size_bytes=0 if content is None else len(content.encode("utf-8")),
    )
    db.execute(stmt.on_duplicate_key_update(path=stmt.inserted.path))


def install_activity(db: Session, workspace_id: int, activity: Activity) -> None:
    """Creates the folder "{title}/" and the starter files inside it. Existing paths are left untouched."""
    root = activity.title.strip()
    files: list[dict[str, Any]] = activity.starter_files or []

    folders = {root}
    for f in files:
        for parent in PurePosixPath(f["path"]).parents:
            if str(parent) != ".":
                folders.add(f"{root}/{parent}")

    for folder in sorted(folders, key=lambda p: p.count("/")):  # parents before children
        _insert_if_missing(db, workspace_id, folder, True, None)
    for f in files:
        _insert_if_missing(db, workspace_id, f"{root}/{f['path']}", False, f.get("content", ""))


def install_published_activities(db: Session, workspace: Workspace) -> None:
    """Copies the starter files of every published activity of the class into the workspace."""
    activities = db.scalars(
        select(Activity).where(Activity.class_id == workspace.class_id, Activity.is_published.is_(True),
                               Activity.is_archived.is_(False))
    ).all()
    for activity in activities:
        install_activity(db, workspace.id, activity)


# ============================================================ access helpers

def _byte_len(text: Optional[str]) -> int:
    return len(text.encode("utf-8")) if text else 0


def _escape_like(value: str) -> str:
    """Backslash is the escape character; it can never appear in a valid path, so this is unambiguous."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def under(prefix: str):
    """SQL condition: path is inside the folder `prefix` (not the folder itself)."""
    return WorkspaceFile.path.like(_escape_like(prefix) + "/%", escape="\\")


def _parent_folders(path: str) -> list[str]:
    """Ancestors of `path`, outermost first: 'a/b/c.py' -> ['a', 'a/b']."""
    parents = [str(p) for p in PurePosixPath(path).parents if str(p) != "."]
    return list(reversed(parents))


def _member_workspace(db: Session, student: User, class_id: int) -> Workspace:
    """The student's own workspace for a class they are approved in."""
    class_service.get_class_for_member(db, class_id, student)
    return ensure_workspace(db, student.id, class_id)


def ensure_practice_workspace(db: Session, student: User) -> Workspace:
    """The student's personal Practice workspace (class_id NULL), created on first access.

    The unique key (student_id, class_id) cannot stop duplicates here because MySQL allows many NULLs in it, so
    first-time creation is serialised on the student's own user row: two simultaneous first requests end up with
    one workspace, not two."""
    stmt = select(Workspace).where(Workspace.student_id == student.id, Workspace.class_id.is_(None))
    workspace = db.scalar(stmt)
    if workspace is not None:
        return workspace
    db.execute(select(User.id).where(User.id == student.id).with_for_update()).one()
    workspace = db.scalar(stmt)  # another request may have created it while we waited for the lock
    if workspace is None:
        workspace = Workspace(student_id=student.id, class_id=None)
        db.add(workspace)
        db.flush()
    db.commit()  # releases the lock
    return workspace


def _owned_file(db: Session, student: User, file_id: int, practice: bool = False) -> tuple[WorkspaceFile, Workspace]:
    """A file in the student's own workspace. Someone else's file looks like it doesn't exist.

    `practice` selects which of the student's workspaces is meant: the two kinds never mix, so a file of the
    Practice workspace is not reachable through the class endpoints and vice versa (it looks like it doesn't exist)."""
    kind = Workspace.class_id.is_(None) if practice else Workspace.class_id.is_not(None)
    row = db.execute(
        select(WorkspaceFile, Workspace)
        .join(Workspace, Workspace.id == WorkspaceFile.workspace_id)
        .where(WorkspaceFile.id == file_id, Workspace.student_id == student.id, kind)
    ).first()
    if row is None:
        raise NotFoundError("File not found", "FILE_NOT_FOUND")
    file, workspace = row
    if not practice and not class_service.is_approved_student(db, workspace.class_id, student.id):
        raise ForbiddenError("You are not a member of this class", "NOT_CLASS_MEMBER")
    return file, workspace


def display_time(utc_time: datetime) -> str:
    """"Oct 14, 10:00 AM" in the school's time zone (DISPLAY_UTC_OFFSET_HOURS)."""
    t = utc_time + timedelta(hours=settings.DISPLAY_UTC_OFFSET_HOURS)
    return f"{t:%b} {t.day}, {t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


class ActivityRules:
    """What the class's published activities allow in a student's workspace, worked out once per request:

    * read-only folders: an archived activity's folder (ACTIVITY_ARCHIVED) and, from its due_at on, a past-due one
      (ACTIVITY_PAST_DUE): nothing may be created, saved, renamed or deleted in it, moved into or out of it;
    * protected entries: the activity folder, its starter files and the folders holding starter files may not be
      deleted, renamed or moved (STARTER_FILE_PROTECTED); files keep being editable. A Practice workspace has no rules.
    Reading, Run and Test are never affected."""

    def __init__(self, db: Session, workspace: Workspace) -> None:
        self.locked: dict[str, tuple[str, str]] = {}     # activity folder -> (code, message)
        self.protected: dict[str, str] = {}              # path -> message
        self.folders: set[str] = set()                   # activity folders, lowercase (paths compare case-insensitively)
        self.class_workspace = workspace.class_id is not None
        if workspace.class_id is None:
            return
        now = utcnow()
        for title, archived, due_at, starter_files in db.execute(
                select(Activity.title, Activity.is_archived, Activity.due_at, Activity.starter_files)
                .where(Activity.class_id == workspace.class_id, Activity.is_published.is_(True))):
            self.folders.add(title.lower())
            if archived:
                self.locked[title] = ("ACTIVITY_ARCHIVED", f"'{title}' was archived by your instructor: its folder is read-only")
            elif due_at is not None and now >= due_at:
                self.locked[title] = ("ACTIVITY_PAST_DUE", f"'{title}' was due on {display_time(due_at)}: its folder is read-only")
            self.protected[title] = f"'{title}' is the folder of an activity: it cannot be deleted, renamed or moved"
            for starter in starter_files or []:
                path = f"{title}/{starter['path']}"
                name = starter["path"].rsplit("/", 1)[-1]
                self.protected[path] = (f"{name} is a starter file of '{title}': it can be edited but not deleted, "
                                        f"renamed or moved")
                for parent in _parent_folders(path):
                    if parent != title:
                        self.protected.setdefault(parent, f"'{parent.split('/', 1)[1]}' holds starter files of "
                                                          f"'{title}': it cannot be deleted, renamed or moved")

    def lock_of(self, path: str) -> Optional[tuple[str, str]]:
        for title, lock in self.locked.items():
            if path == title or path.startswith(title + "/"):
                return lock
        return None

    def check_inside_activity(self, path: str) -> None:
        """A class workspace holds nothing at the top level but the activity folders (which the server makes):
        a new or moved entry must end up INSIDE one. Older top-level entries may stay (and be deleted)."""
        if not self.class_workspace:
            return
        top, _, rest = path.partition("/")
        if not rest or top.lower() not in self.folders:
            raise ForbiddenError("Files and folders go inside an activity folder.", "OUTSIDE_ACTIVITY_FOLDER")

    def check_writable(self, *paths: str) -> None:
        for path in paths:
            lock = self.lock_of(path)
            if lock is not None:
                raise ForbiddenError(lock[1], lock[0])

    def check_movable(self, path: str, is_folder: bool) -> None:
        """Deleting, renaming or moving `path` (a folder takes everything under it along)."""
        if path in self.protected:
            raise ForbiddenError(self.protected[path], "STARTER_FILE_PROTECTED")
        if is_folder:
            inside = next((p for p in self.protected if p.startswith(path + "/")), None)
            if inside is not None:
                raise ForbiddenError(self.protected[inside], "STARTER_FILE_PROTECTED")

    def meta(self, file: WorkspaceFile) -> FileMeta:
        lock = self.lock_of(file.path)
        return FileMeta.model_validate(file).model_copy(update={
            "protected": file.path in self.protected, "read_only_reason": lock[1] if lock else None})


def _writable(db: Session, workspace: Workspace):
    """Every class-workspace write needs an open lab session; returns that session.
    The Practice workspace is never locked by lab sessions (returns None)."""
    if workspace.class_id is None:
        return None
    return session_service.require_lab_open(db, workspace.class_id)


def _lock_workspace(db: Session, workspace_id: int) -> None:
    """Serialises writers of one workspace so quotas and the save check can't be raced."""
    db.execute(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update()).one()


def _usage(db: Session, workspace_id: int) -> tuple[int, int, int]:
    files, folders, size = db.execute(
        select(
            func.coalesce(func.sum(case((WorkspaceFile.is_folder.is_(False), 1), else_=0)), 0),
            func.coalesce(func.sum(case((WorkspaceFile.is_folder.is_(True), 1), else_=0)), 0),
            func.coalesce(func.sum(WorkspaceFile.size_bytes), 0),
        ).where(WorkspaceFile.workspace_id == workspace_id)
    ).one()
    return int(files), int(folders), int(size)


def _usage_out(db: Session, workspace: Workspace) -> Usage:
    files, folders, size = _usage(db, workspace.id)
    limits = storage_service.limits_for_workspace(db, workspace)
    return Usage(files=files, folders=folders, bytes=size, max_files=limits.max_files, max_folders=MAX_FOLDERS,
                 max_bytes=limits.max_workspace_bytes, max_file_bytes=limits.max_file_bytes)


def _find(db: Session, workspace_id: int, path: str) -> Optional[WorkspaceFile]:
    return db.scalar(select(WorkspaceFile).where(
        WorkspaceFile.workspace_id == workspace_id, WorkspaceFile.path == path))


def _check_file_size(content: str, limits: storage_service.Limits) -> int:
    size = _byte_len(content)
    if size > limits.max_file_bytes:
        raise AppError(413, f"File is larger than {storage_service.human(limits.max_file_bytes)}", "FILE_TOO_LARGE")
    return size


def _quota_exceeded(limits: storage_service.Limits) -> AppError:
    return AppError(413, f"Workspace storage limit ({storage_service.human(limits.max_workspace_bytes)}) reached",
                    "QUOTA_EXCEEDED")


def _missing_parents(db: Session, workspace_id: int, path: str) -> list[str]:
    """Parent folders of `path` that don't exist yet. Raises if one of them exists as a file."""
    missing = []
    for parent in _parent_folders(path):
        existing = _find(db, workspace_id, parent)
        if existing is None:
            missing.append(parent)
        elif not existing.is_folder:
            raise ConflictError(f"'{parent}' is a file, not a folder", "PATH_CONFLICT")
    return missing


def _check_folder_quota(db: Session, workspace_id: int, new_folders: int) -> None:
    _, folders, _ = _usage(db, workspace_id)
    if folders + new_folders > MAX_FOLDERS:
        raise AppError(400, f"A workspace can have at most {MAX_FOLDERS} folders", "TOO_MANY_FILES")


# ================================================================= reading

def _tree(db: Session, workspace: Workspace) -> TreeOut:
    entries = db.scalars(
        select(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace.id).order_by(WorkspaceFile.path)
    ).all()  # note: no content column is ever serialised into the tree
    rules = ActivityRules(db, workspace)
    return TreeOut(workspace_id=workspace.id, class_id=workspace.class_id,
                   entries=[rules.meta(e) for e in entries],
                   usage=_usage_out(db, workspace))


def get_tree(db: Session, student: User, class_id: int) -> TreeOut:
    tree = _tree(db, _member_workspace(db, student, class_id))
    start_service.record_access(db, student, class_id)          # a lab session start, the first time
    return tree


def get_practice_tree(db: Session, student: User) -> TreeOut:
    return _tree(db, ensure_practice_workspace(db, student))


def get_file(db: Session, student: User, file_id: int, practice: bool = False) -> FileOut:
    file, workspace = _owned_file(db, student, file_id, practice)
    out = FileOut.model_validate(file)
    if workspace.class_id is not None:    # a class file: a session start, and the start of its activity
        start_service.record_access(db, student, workspace.class_id, file.path)
    return out


def instructor_tree(db: Session, instructor: User, class_id: int, student_id: int) -> TreeOut:
    """Read-only view of a student's workspace, for the instructor who owns the class."""
    class_service.get_owned_class(db, class_id, instructor)
    workspace = db.scalar(select(Workspace).where(
        Workspace.class_id == class_id, Workspace.student_id == student_id))
    if workspace is None:
        raise NotFoundError("This student has no workspace in the class", "WORKSPACE_NOT_FOUND")
    return _tree(db, workspace)


def instructor_file(db: Session, instructor: User, class_id: int, student_id: int, file_id: int) -> FileOut:
    class_service.get_owned_class(db, class_id, instructor)
    file = db.scalar(
        select(WorkspaceFile).join(Workspace, Workspace.id == WorkspaceFile.workspace_id)
        .where(WorkspaceFile.id == file_id, Workspace.class_id == class_id, Workspace.student_id == student_id))
    if file is None:
        raise NotFoundError("File not found", "FILE_NOT_FOUND")
    return FileOut.model_validate(file)


# ================================================================== writing

def create_entry(db: Session, student: User, class_id: int, data: CreateEntryRequest) -> FileOut:
    return _create_entry(db, _member_workspace(db, student, class_id), data)


def create_practice_entry(db: Session, student: User, data: CreateEntryRequest) -> FileOut:
    return _create_entry(db, ensure_practice_workspace(db, student), data)


def _create_entry(db: Session, workspace: Workspace, data: CreateEntryRequest) -> FileOut:
    _writable(db, workspace)

    path = normalize_path(data.path) if data.is_folder else normalize_file_path(data.path)
    rules = ActivityRules(db, workspace)
    rules.check_writable(path)
    rules.check_inside_activity(path)
    content = None if data.is_folder else data.content
    limits = storage_service.limits_for_workspace(db, workspace)
    size = 0 if data.is_folder else _check_file_size(data.content, limits)

    _lock_workspace(db, workspace.id)
    if _find(db, workspace.id, path) is not None:
        raise ConflictError(f"'{path}' already exists", "PATH_EXISTS")
    new_parents = _missing_parents(db, workspace.id, path)

    files, folders, total = _usage(db, workspace.id)
    if not data.is_folder and files + 1 > limits.max_files:
        raise AppError(400, f"A workspace can have at most {limits.max_files} files", "TOO_MANY_FILES")
    if folders + len(new_parents) + (1 if data.is_folder else 0) > MAX_FOLDERS:
        raise AppError(400, f"A workspace can have at most {MAX_FOLDERS} folders", "TOO_MANY_FILES")
    if total + size > limits.max_workspace_bytes:
        raise _quota_exceeded(limits)

    for parent in new_parents:
        db.add(WorkspaceFile(workspace_id=workspace.id, path=parent, is_folder=True, size_bytes=0))
    entry = WorkspaceFile(workspace_id=workspace.id, path=path, is_folder=data.is_folder,
                          content=content, size_bytes=size)
    db.add(entry)
    db.commit()
    return FileOut.model_validate(entry)


def save_file(db: Session, student: User, file_id: int, data: SaveFileRequest, make_version: bool,
              practice: bool = False) -> FileMeta:
    """Optimistic-locked save: 409 if `last_updated_at` isn't the file's current updated_at."""
    file, workspace = _owned_file(db, student, file_id, practice)
    lab_session = _writable(db, workspace)
    rules = ActivityRules(db, workspace)
    rules.check_writable(file.path)
    if file.is_folder:
        raise AppError(400, "A folder has no content", "IS_FOLDER")
    limits = storage_service.limits_for_workspace(db, workspace)
    new_size = _check_file_size(data.content, limits)

    _lock_workspace(db, workspace.id)
    try:
        db.refresh(file, with_for_update=True)  # re-read under the lock: it may have just been saved/deleted
    except InvalidRequestError:
        raise NotFoundError("File not found", "FILE_NOT_FOUND")
    if file.updated_at != data.last_updated_at:
        raise ConflictError("This file changed since you opened it. Reload it before saving.", "SAVE_CONFLICT")

    growth = new_size - file.size_bytes
    if growth > 0 and _usage(db, workspace.id)[2] + growth > limits.max_workspace_bytes:
        raise _quota_exceeded(limits)

    now = utcnow()
    if now <= file.updated_at:  # the token must always change, even on a same-microsecond re-save
        now = file.updated_at.replace(microsecond=min(file.updated_at.microsecond + 1, 999999))
    file.content = data.content
    file.size_bytes = new_size
    file.updated_at = now

    if make_version:
        db.add(FileVersion(file_id=file.id, content=data.content, saved_at=now))
        db.flush()
        _prune_versions(db, file.id)
    db.commit()
    if lab_session is not None:  # practice saves are private: the instructor's monitor never hears about them
        monitor_service.emit(lab_session.id, "saved", student.id, student.full_name,
                             file_id=file.id, path=file.path, size_bytes=new_size, manual=make_version)
    return rules.meta(file)


def _prune_versions(db: Session, file_id: int) -> None:
    """Keep only the newest MAX_VERSIONS versions of a file."""
    stale = db.scalars(
        select(FileVersion.id).where(FileVersion.file_id == file_id)
        .order_by(FileVersion.id.desc()).offset(MAX_VERSIONS)
    ).all()
    if stale:
        db.execute(delete(FileVersion).where(FileVersion.id.in_(stale)))


def rename_entry(db: Session, student: User, file_id: int, new_path: str, practice: bool = False) -> FileMeta:
    """Rename/move a file or folder. A folder takes everything under it along, in one transaction.
    updated_at is deliberately untouched: it is the content token, and an open editor must stay valid."""
    file, workspace = _owned_file(db, student, file_id, practice)
    _writable(db, workspace)
    new = normalize_path(new_path) if file.is_folder else normalize_file_path(new_path)
    rules = ActivityRules(db, workspace)
    rules.check_writable(file.path, new)
    if new != file.path:
        rules.check_movable(file.path, file.is_folder)
        rules.check_inside_activity(new)

    _lock_workspace(db, workspace.id)
    try:
        db.refresh(file, with_for_update=True)
    except InvalidRequestError:
        raise NotFoundError("File not found", "FILE_NOT_FOUND")
    old = file.path
    if new == old:
        return rules.meta(file)

    if file.is_folder and (new.lower() + "/").startswith(old.lower() + "/"):
        raise AppError(400, "A folder cannot be moved into itself", "INVALID_MOVE")
    clash = _find(db, workspace.id, new)
    if clash is not None and clash.id != file.id:  # clash with itself = a case-only rename, which is fine
        raise ConflictError(f"'{new}' already exists", "PATH_EXISTS")

    moved = [file]
    if file.is_folder:
        moved += list(db.scalars(select(WorkspaceFile).where(
            WorkspaceFile.workspace_id == workspace.id, under(old))))
    new_paths = {m.id: new + m.path[len(old):] for m in moved}
    if any(len(p) > MAX_PATH_LENGTH for p in new_paths.values()):
        raise AppError(400, f"Invalid path: longer than {MAX_PATH_LENGTH} characters", "INVALID_PATH")

    new_parents = _missing_parents(db, workspace.id, new)
    _check_folder_quota(db, workspace.id, len(new_parents))
    for parent in new_parents:
        db.add(WorkspaceFile(workspace_id=workspace.id, path=parent, is_folder=True, size_bytes=0))
        db.flush()
    for m in moved:
        db.execute(update(WorkspaceFile).where(WorkspaceFile.id == m.id)
                   .values(path=new_paths[m.id], updated_at=WorkspaceFile.updated_at))
    db.commit()
    db.refresh(file)
    return rules.meta(file)


def delete_entry(db: Session, student: User, file_id: int, practice: bool = False) -> None:
    """Delete a file, or a folder with everything under it (versions go with them via ON DELETE CASCADE)."""
    file, workspace = _owned_file(db, student, file_id, practice)
    _writable(db, workspace)
    rules = ActivityRules(db, workspace)
    rules.check_writable(file.path)
    rules.check_movable(file.path, file.is_folder)
    _lock_workspace(db, workspace.id)
    condition = WorkspaceFile.id == file.id
    if file.is_folder:
        condition = condition | under(file.path)
    db.execute(delete(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace.id, condition))
    db.commit()


# ================================================================= versions

def list_versions(db: Session, student: User, file_id: int, offset: int, limit: int,
                  practice: bool = False) -> tuple[list[VersionMeta], int]:
    file, _ = _owned_file(db, student, file_id, practice)
    where = FileVersion.file_id == file.id
    total = db.scalar(select(func.count()).select_from(FileVersion).where(where)) or 0
    rows = db.execute(
        select(FileVersion.id, FileVersion.file_id, FileVersion.saved_at,
               func.coalesce(func.length(FileVersion.content), 0))  # LENGTH() = bytes; avoids loading content
        .where(where).order_by(FileVersion.id.desc()).offset(offset).limit(limit)
    ).all()
    return [VersionMeta(id=i, file_id=f, saved_at=s, size_bytes=int(n)) for i, f, s, n in rows], total


def get_version(db: Session, student: User, version_id: int, practice: bool = False) -> VersionOut:
    version = db.get(FileVersion, version_id)
    if version is None:
        raise NotFoundError("Version not found", "VERSION_NOT_FOUND")
    _owned_file(db, student, version.file_id, practice)  # 404 unless it belongs to this student (and this kind)
    return VersionOut(id=version.id, file_id=version.file_id, saved_at=version.saved_at,
                      size_bytes=_byte_len(version.content), content=version.content)


# ================================================================== admin: clearing a workspace

def admin_clear_workspace(db: Session, admin: User, user_id: int, workspace_id: int,
                          ip: Optional[str]) -> ClearResult:
    """Deletes every file and folder of one workspace of the user (with their saved versions). A class workspace then
    gets the starter files of the class's published activities again, exactly like a newly enrolled student's;
    the Practice workspace is left empty. Submissions are frozen copies and are not touched."""
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    workspace = db.scalar(select(Workspace).where(Workspace.id == workspace_id, Workspace.student_id == user.id))
    if workspace is None:
        raise NotFoundError("This user has no such workspace", "WORKSPACE_NOT_FOUND")

    _lock_workspace(db, workspace.id)      # waits for a save in progress; the next one finds its file gone
    files, _, size = _usage(db, workspace.id)
    db.execute(delete(WorkspaceFile).where(WorkspaceFile.workspace_id == workspace.id))   # versions: ON DELETE CASCADE
    if workspace.class_id is not None:
        install_published_activities(db, workspace)
    restored = _usage(db, workspace.id)[0]
    audit_service.record(db, audit_service.WORKSPACE_CLEAR, user_id=admin.id,
                         details={"target_user_id": user.id, "workspace_id": workspace.id,
                                  "class_id": workspace.class_id, "files_deleted": files, "bytes_deleted": size,
                                  "starter_files_restored": restored}, ip_address=ip)
    db.commit()
    return ClearResult(workspace_id=workspace.id, class_id=workspace.class_id, files_deleted=files,
                       bytes_deleted=size, starter_files_restored=restored)

