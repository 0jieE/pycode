"""Workspace storage limits. An admin sets them per role (student, instructor) and, when needed, per user; a user's
own value wins over the role's, field by field. They apply to EACH workspace of the user (every class workspace and
the Practice workspace).

Lowering a limit never deletes anything: files already there stay, but the workspace cannot grow past the new limit
(new files and saves that make it bigger are refused, saves that shrink it still work)."""
from typing import Optional

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, NotFoundError
from app.models.classroom import Classroom
from app.models.storage import StorageLimit
from app.models.user import Role, User
from app.models.workspace import Workspace, WorkspaceFile
from app.schemas.storage import (BOUNDS, Limits, LimitsOverride, LimitsUpdate, RoleLimits, StorageLimitsOut,
                                 UserStorageOut, WorkspaceUsage)
from app.services import audit_service

# The built-in limits (used for a role without a storage_limits row).
DEFAULTS = Limits(max_file_bytes=100 * 1024, max_workspace_bytes=2 * 1024 * 1024, max_files=100)
ROLES_WITH_WORKSPACES = (Role.STUDENT, Role.INSTRUCTOR)
FIELDS = ("max_file_bytes", "max_workspace_bytes", "max_files")


def _role_row(db: Session, role: Role) -> Optional[StorageLimit]:
    return db.get(StorageLimit, role)


def role_limits(db: Session, role: Role) -> Limits:
    row = _role_row(db, role)
    return Limits(**{f: getattr(row, f) for f in FIELDS}) if row is not None else DEFAULTS


def _override(user: User) -> LimitsOverride:
    return LimitsOverride(max_file_bytes=user.storage_max_file_bytes,
                          max_workspace_bytes=user.storage_max_workspace_bytes, max_files=user.storage_max_files)


def limits_for(db: Session, user: User) -> Limits:
    """What applies to this user's workspaces: their own value for a field, else their role's."""
    base = role_limits(db, user.role if user.role in ROLES_WITH_WORKSPACES else Role.STUDENT)
    own = _override(user)
    return Limits(**{f: getattr(own, f) if getattr(own, f) is not None else getattr(base, f) for f in FIELDS})


def limits_for_workspace(db: Session, workspace: Workspace) -> Limits:
    return limits_for(db, db.get(User, workspace.student_id))


def _check_consistent(limits: Limits) -> None:
    if limits.max_file_bytes > limits.max_workspace_bytes:
        raise AppError(400, "The largest file cannot be bigger than the whole workspace", "INVALID_STORAGE_LIMITS")


# ------------------------------------------------------------------------------------------ admin: roles

def get_all(db: Session) -> StorageLimitsOut:
    out = {}
    for role in ROLES_WITH_WORKSPACES:
        row = _role_row(db, role)
        out[role.value] = RoleLimits(**role_limits(db, role).model_dump(),
                                     updated_at=row.updated_at if row else None,
                                     updated_by=row.updated_by if row else None)
    return StorageLimitsOut(**out, bounds=BOUNDS)


def update_role(db: Session, admin: User, role_name: str, data: LimitsUpdate, ip: Optional[str]) -> StorageLimitsOut:
    role = _role(role_name)
    changes = data.model_dump(exclude_unset=True)
    new = Limits(**{**role_limits(db, role).model_dump(), **changes})
    _check_consistent(new)
    row = db.scalar(select(StorageLimit).where(StorageLimit.role == role).with_for_update())
    if row is None:
        row = StorageLimit(role=role)
        db.add(row)
    for f in FIELDS:
        setattr(row, f, getattr(new, f))
    row.updated_at, row.updated_by = utcnow(), admin.id
    audit_service.record(db, audit_service.STORAGE_LIMITS_UPDATE, user_id=admin.id,
                         details={"role": role.value, **changes}, ip_address=ip)
    db.commit()
    return get_all(db)


def _role(name: str) -> Role:
    for role in ROLES_WITH_WORKSPACES:
        if role.value == name:
            return role
    raise NotFoundError("Storage limits exist for students and instructors only", "ROLE_NOT_FOUND")


# ------------------------------------------------------------------------------------------ admin: one user

def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    if user.role not in ROLES_WITH_WORKSPACES:
        raise AppError(400, "Admins have no workspace", "NO_WORKSPACE")
    return user


def _usage(db: Session, user: User) -> list[WorkspaceUsage]:
    rows = db.execute(
        select(Workspace.id, Workspace.class_id, Classroom.name,
               func.coalesce(func.sum(case((WorkspaceFile.is_folder.is_(False), 1), else_=0)), 0),
               func.coalesce(func.sum(WorkspaceFile.size_bytes), 0))
        .outerjoin(Classroom, Classroom.id == Workspace.class_id)
        .outerjoin(WorkspaceFile, WorkspaceFile.workspace_id == Workspace.id)
        .where(Workspace.student_id == user.id)
        .group_by(Workspace.id, Workspace.class_id, Classroom.name)
        .order_by(Workspace.class_id.is_(None), Classroom.name, Workspace.id)).all()
    return [WorkspaceUsage(workspace_id=w, class_id=c, class_name=n, files=int(f), bytes=int(b))
            for w, c, n, f, b in rows]


def _user_out(db: Session, user: User) -> UserStorageOut:
    return UserStorageOut(user_id=user.id, role=user.role.value, role_limits=role_limits(db, user.role),
                          override=_override(user), effective=limits_for(db, user), workspaces=_usage(db, user))


def get_user(db: Session, user_id: int) -> UserStorageOut:
    return _user_out(db, _user(db, user_id))


def set_user(db: Session, admin: User, user_id: int, data: LimitsOverride, ip: Optional[str]) -> UserStorageOut:
    """Replaces the user's own limits: a field left out or null goes back to the role's limit."""
    user = _user(db, user_id)
    base = role_limits(db, user.role)
    _check_consistent(Limits(**{f: getattr(data, f) if getattr(data, f) is not None else getattr(base, f)
                                for f in FIELDS}))
    user.storage_max_file_bytes = data.max_file_bytes
    user.storage_max_workspace_bytes = data.max_workspace_bytes
    user.storage_max_files = data.max_files
    audit_service.record(db, audit_service.USER_STORAGE_UPDATE, user_id=admin.id,
                         details={"target_user_id": user.id, **data.model_dump()}, ip_address=ip)
    db.commit()
    return _user_out(db, user)


# ------------------------------------------------------------------------------------------ messages

def human(size: int) -> str:
    """1536 -> "1.5 KB", 2097152 -> "2 MB"."""
    for unit, scale in (("MB", 1024 * 1024), ("KB", 1024)):
        if size >= scale:
            value = size / scale
            return f"{value:.1f}".rstrip("0").rstrip(".") + f" {unit}"
    return f"{size} bytes"
