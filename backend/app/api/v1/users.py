from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.user import (
    DeletePreview,
    ImportResult,
    ResetPasswordRequest,
    ResetPasswordResponse,
    UserCounts,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.services import user_service

# Admin-only: every route in this router requires the admin role.
router = APIRouter(prefix="/users", tags=["users"])
admin_only = require_role(Role.ADMIN)


@router.get("", response_model=Page[UserOut])
def list_users(
    role: Optional[Literal["instructor", "student"]] = None,
    q: Optional[str] = Query(None, max_length=100),
    params: PageParams = Depends(pagination),
    _: User = Depends(admin_only),
    db: Session = Depends(get_db),
) -> Page[UserOut]:
    """Instructors and students (never the administrator). ?role= instructor | student."""
    items, total = user_service.list_users(db, Role(role) if role else None, q, params.offset, params.size)
    return Page[UserOut](
        items=[UserOut.model_validate(u) for u in items], total=total, page=params.page, size=params.size
    )


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate, request: Request, actor: User = Depends(admin_only), db: Session = Depends(get_db)
) -> User:
    return user_service.create_user(db, body, actor.id, client_ip(request))


@router.get("/counts", response_model=UserCounts)
def user_counts(_: User = Depends(admin_only), db: Session = Depends(get_db)) -> UserCounts:
    """How many instructors and students there are (the administrator is not counted)."""
    return UserCounts(**user_service.user_counts(db))


# Declared before /{user_id} routes so "import" is never parsed as an id.
@router.post("/import", response_model=ImportResult)
def import_users(
    request: Request,
    file: UploadFile = File(...),
    actor: User = Depends(admin_only),
    db: Session = Depends(get_db),
) -> ImportResult:
    content = file.file.read(user_service.IMPORT_MAX_BYTES + 1)
    return user_service.import_students(db, content, actor, client_ip(request))


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    actor: User = Depends(admin_only),
    db: Session = Depends(get_db),
) -> User:
    return user_service.update_user(db, user_id, body, actor, client_ip(request))


@router.get("/{user_id}/delete-preview", response_model=DeletePreview)
def delete_preview(user_id: int, _: User = Depends(admin_only), db: Session = Depends(get_db)) -> DeletePreview:
    """What deleting this instructor or student would remove, and `blocked_by` (empty = the delete will work)."""
    return DeletePreview(**user_service.deletion_preview(db, user_id))


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request, actor: User = Depends(admin_only),
                db: Session = Depends(get_db)) -> None:
    """Permanently deletes an instructor or student and everything that is only theirs (workspaces, submissions and
    grades, runs, enrollments, tutorial progress). 409 USER_HAS_CLASSES / USER_RUN_ACTIVE (body: blocked_by) when
    something blocks it; 409 ADMIN_PROTECTED for the administrator. Their sessions end at once."""
    user_service.delete_user(db, user_id, actor, client_ip(request))


@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    user_id: int,
    request: Request,
    body: ResetPasswordRequest = ResetPasswordRequest(),
    actor: User = Depends(admin_only),
    db: Session = Depends(get_db),
) -> ResetPasswordResponse:
    password = user_service.reset_password(db, user_id, body.new_password, actor, client_ip(request))
    return ResetPasswordResponse(temporary_password=password)
