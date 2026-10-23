"""Admin-only management of one-time student registration codes."""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.registration import (
    BatchOut,
    RegistrationCodeCreate,
    RegistrationCodeOut,
    RegistrationCodesCreated,
    RevokeResult,
)
from app.services import registration_service

router = APIRouter(prefix="/registration-codes", tags=["registration codes"])
admin_only = require_role(Role.ADMIN)


@router.post("", response_model=RegistrationCodesCreated, status_code=201)
def create_codes(body: RegistrationCodeCreate, request: Request, response: Response,
                 admin: User = Depends(admin_only), db: Session = Depends(get_db)) -> RegistrationCodesCreated:
    """Generates codes. They are returned in plaintext HERE ONLY and cannot be retrieved again."""
    response.headers["Cache-Control"] = "no-store"  # a response full of secrets must not be cached
    return registration_service.create_codes(db, admin, body, client_ip(request))


@router.get("", response_model=Page[RegistrationCodeOut])
def list_codes(batch: Optional[str] = Query(None, max_length=100), params: PageParams = Depends(pagination),
               _: User = Depends(admin_only), db: Session = Depends(get_db)) -> Page[RegistrationCodeOut]:
    """Unused codes (never the code itself: only its last 4 characters)."""
    items, total = registration_service.list_codes(db, batch, params.offset, params.size)
    return Page[RegistrationCodeOut](items=items, total=total, page=params.page, size=params.size)


@router.get("/batches", response_model=list[BatchOut])
def list_batches(_: User = Depends(admin_only), db: Session = Depends(get_db)) -> list[BatchOut]:
    return registration_service.list_batches(db)


@router.delete("/{code_id}", status_code=204)
def revoke_code(code_id: int, request: Request, admin: User = Depends(admin_only),
                db: Session = Depends(get_db)) -> Response:
    registration_service.revoke_code(db, admin, code_id, client_ip(request))
    return Response(status_code=204)


@router.delete("", response_model=RevokeResult)
def revoke_batch(request: Request, batch: str = Query(..., min_length=1, max_length=100),
                 admin: User = Depends(admin_only), db: Session = Depends(get_db)) -> RevokeResult:
    """Revokes every unused code of a batch."""
    return RevokeResult(revoked=registration_service.revoke_batch(db, admin, batch, client_ip(request)))
