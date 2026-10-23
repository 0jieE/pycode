from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.classroom import (
    ClassCreate,
    ClassOut,
    ClassUpdate,
    InviteCodeCreate,
    InviteCodeOut,
    InviteCodeUpdate,
)
from app.schemas.common import Page
from app.services import class_service, enrollment_service

router = APIRouter(tags=["classes"])
instructor_only = require_role(Role.INSTRUCTOR)


@router.get("/classes", response_model=Page[ClassOut])
def list_classes(
    include_archived: bool = False,
    params: PageParams = Depends(pagination),
    user: User = Depends(instructor_only),
    db: Session = Depends(get_db),
) -> Page[ClassOut]:
    items, total = class_service.list_classes(db, user, include_archived, params.offset, params.size)
    return Page[ClassOut](items=items, total=total, page=params.page, size=params.size)


@router.post("/classes", response_model=ClassOut, status_code=201)
def create_class(body: ClassCreate, request: Request, user: User = Depends(instructor_only),
                 db: Session = Depends(get_db)) -> ClassOut:
    return class_service.create_class(db, user, body, client_ip(request))


@router.get("/classes/{class_id}", response_model=ClassOut)
def get_class(class_id: int, user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> ClassOut:
    return class_service.get_class(db, class_id, user)


@router.patch("/classes/{class_id}", response_model=ClassOut)
def update_class(class_id: int, body: ClassUpdate, user: User = Depends(instructor_only),
                 db: Session = Depends(get_db)) -> ClassOut:
    return class_service.update_class(db, class_id, user, body)


@router.get("/classes/{class_id}/invite-codes", response_model=Page[InviteCodeOut])
def list_invite_codes(
    class_id: int,
    params: PageParams = Depends(pagination),
    user: User = Depends(instructor_only),
    db: Session = Depends(get_db),
) -> Page[InviteCodeOut]:
    items, total = enrollment_service.list_invite_codes(db, class_id, user, params.offset, params.size)
    return Page[InviteCodeOut](items=[InviteCodeOut.model_validate(c) for c in items],
                               total=total, page=params.page, size=params.size)


@router.post("/classes/{class_id}/invite-codes", response_model=InviteCodeOut, status_code=201)
def create_invite_code(class_id: int, body: InviteCodeCreate, request: Request,
                       user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    return enrollment_service.create_invite_code(db, class_id, user, body, client_ip(request))


@router.patch("/invite-codes/{code_id}", response_model=InviteCodeOut)
def update_invite_code(code_id: int, body: InviteCodeUpdate, request: Request,
                       user: User = Depends(instructor_only), db: Session = Depends(get_db)):
    return enrollment_service.update_invite_code(db, code_id, user, body, client_ip(request))
