"""Computer labs (named rooms that sessions book), their schedule, and the sign-in log of a session."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.lab import LabBooking, LabCreate, LabOut, LabUpdate, LoginOut
from app.services import booking_service, lab_service, login_log_service

router = APIRouter(tags=["labs"])
staff = require_role(Role.ADMIN, Role.INSTRUCTOR)
instructor_only = require_role(Role.INSTRUCTOR)


def _utc(moment: Optional[datetime]) -> Optional[datetime]:
    """A query time in any ISO form: an offset is converted to UTC, a time without one is taken as UTC."""
    if moment is None or moment.tzinfo is None:
        return moment
    return moment.astimezone(timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------------------------------------ labs

@router.get("/labs", response_model=list[LabOut])
def list_labs(user: User = Depends(staff), db: Session = Depends(get_db)) -> list[LabOut]:
    return lab_service.list_labs(db)


@router.post("/labs", response_model=LabOut, status_code=201)
def create_lab(body: LabCreate, request: Request, user: User = Depends(staff),
               db: Session = Depends(get_db)) -> LabOut:
    return lab_service.create_lab(db, user, body, client_ip(request))


@router.get("/labs/{lab_id}", response_model=LabOut)
def get_lab(lab_id: int, user: User = Depends(staff), db: Session = Depends(get_db)) -> LabOut:
    return lab_service.get_lab(db, lab_id)


@router.get("/labs/{lab_id}/schedule", response_model=list[LabBooking])
def lab_schedule(lab_id: int, start: Optional[datetime] = Query(default=None, alias="from"),
                 end: Optional[datetime] = Query(default=None, alias="to"), user: User = Depends(staff),
                 db: Session = Depends(get_db)) -> list[LabBooking]:
    """The sessions booking this lab that have not ended, across all instructors: running ones first, then upcoming
    by starts_at. ?from=&to= (ISO) keep only the sessions overlapping that window, for paging through later dates."""
    return booking_service.schedule(db, user, lab_id, _utc(start), _utc(end))


@router.patch("/labs/{lab_id}", response_model=LabOut)
def update_lab(lab_id: int, body: LabUpdate, request: Request, user: User = Depends(staff),
               db: Session = Depends(get_db)) -> LabOut:
    """Rename a lab."""
    return lab_service.update_lab(db, user, lab_id, body, client_ip(request))


@router.delete("/labs/{lab_id}", status_code=204)
def delete_lab(lab_id: int, request: Request, user: User = Depends(staff), db: Session = Depends(get_db)) -> Response:
    lab_service.delete_lab(db, user, lab_id, client_ip(request))
    return Response(status_code=204)


# ------------------------------------------------------------------------- the sign-in log of a session

@router.get("/sessions/{session_id}/logins", response_model=Page[LoginOut])
def session_logins(session_id: int, since: Optional[datetime] = Query(default=None),
                   params: PageParams = Depends(pagination), user: User = Depends(instructor_only),
                   db: Session = Depends(get_db)) -> Page[LoginOut]:
    """Every sign-in of the session's students, newest first, with its outcome (success / replaced_other_session).
    ?since=<iso> returns only newer ones."""
    items, total = login_log_service.list_logins(db, user, session_id, _utc(since), params.offset, params.size)
    return Page[LoginOut](items=items, total=total, page=params.page, size=params.size)
