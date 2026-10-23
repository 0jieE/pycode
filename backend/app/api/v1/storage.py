from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models.user import Role, User
from app.schemas.storage import ClearResult, LimitsOverride, LimitsUpdate, StorageLimitsOut, UserStorageOut
from app.services import storage_service, workspace_service

# Admin-only: workspace storage limits, per role and per user.
router = APIRouter(tags=["storage limits"])
admin_only = require_role(Role.ADMIN)


@router.get("/storage-limits", response_model=StorageLimitsOut)
def get_limits(user: User = Depends(admin_only), db: Session = Depends(get_db)) -> StorageLimitsOut:
    """The limits of students and instructors (bytes, per workspace) and the range each may be set to."""
    return storage_service.get_all(db)


@router.patch("/storage-limits/{role}", response_model=StorageLimitsOut)
def update_limits(role: str, body: LimitsUpdate, request: Request, user: User = Depends(admin_only),
                  db: Session = Depends(get_db)) -> StorageLimitsOut:
    """Change a role's limits (role: student or instructor). Lowering one deletes nothing: a workspace already over it
    keeps its files but cannot grow."""
    return storage_service.update_role(db, user, role, body, client_ip(request))


@router.get("/users/{user_id}/storage", response_model=UserStorageOut)
def get_user_storage(user_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)) -> UserStorageOut:
    """One user's limits (their role's, their own, what applies) and the usage of each of their workspaces."""
    return storage_service.get_user(db, user_id)


@router.put("/users/{user_id}/storage", response_model=UserStorageOut)
def set_user_storage(user_id: int, body: LimitsOverride, request: Request, user: User = Depends(admin_only),
                     db: Session = Depends(get_db)) -> UserStorageOut:
    """Set this user's own limits; a field that is null or left out follows the role again ({} = all from the role)."""
    return storage_service.set_user(db, user, user_id, body, client_ip(request))


@router.post("/users/{user_id}/workspaces/{workspace_id}/clear", response_model=ClearResult)
def clear_workspace(user_id: int, workspace_id: int, request: Request, user: User = Depends(admin_only),
                    db: Session = Depends(get_db)) -> ClearResult:
    """Delete every file of one of the user's workspaces (ids from GET /users/{id}/storage). A class workspace gets
    its activities' starter files back fresh; Practice is left empty. Submissions are not touched. Cannot be undone."""
    return workspace_service.admin_clear_workspace(db, user, user_id, workspace_id, client_ip(request))
