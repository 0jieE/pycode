from typing import Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.lab_session import LabSession
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.lab_session import SessionCreate, SessionOut, SessionUpdate
from app.services import session_service

router = APIRouter(tags=["lab sessions"])
instructor_only = require_role(Role.INSTRUCTOR)


@router.post("/classes/{class_id}/sessions", response_model=SessionOut, status_code=201)
def create_session(class_id: int, body: SessionCreate, request: Request,
                   user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> LabSession:
    return session_service.create_session(db, class_id, user, body, client_ip(request))


@router.get("/classes/{class_id}/sessions", response_model=Page[SessionOut])
def list_sessions(class_id: int, params: PageParams = Depends(pagination),
                  user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> Page[SessionOut]:
    items, total = session_service.list_sessions(db, class_id, user, params.offset, params.size)
    return Page[SessionOut](items=[SessionOut.model_validate(s) for s in items],
                            total=total, page=params.page, size=params.size)


@router.get("/classes/{class_id}/sessions/current", response_model=Optional[SessionOut])
def current_session(class_id: int, user: User = Depends(require_role(Role.INSTRUCTOR, Role.STUDENT)),
                    db: Session = Depends(get_db)) -> Optional[LabSession]:
    """The open session, or null when the lab is closed."""
    return session_service.get_current(db, class_id, user)


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(session_id: int, body: SessionUpdate, request: Request, user: User = Depends(instructor_only),
                   db: Session = Depends(get_db)) -> LabSession:
    """Rename or reschedule a session, e.g. extend a running one (a session closes itself at ends_at)."""
    return session_service.update_session(db, session_id, user, body, client_ip(request))


@router.patch("/sessions/{session_id}/open", response_model=SessionOut)
def open_session(session_id: int, request: Request, user: User = Depends(instructor_only),
                 db: Session = Depends(get_db)) -> LabSession:
    return session_service.open_session(db, session_id, user, client_ip(request))


@router.patch("/sessions/{session_id}/close", response_model=SessionOut)
def close_session(session_id: int, request: Request, user: User = Depends(instructor_only),
                  db: Session = Depends(get_db)) -> LabSession:
    return session_service.close_session(db, session_id, user, client_ip(request))
