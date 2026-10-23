"""Lab bookings. A session with a lab books that room from starts_at to ends_at: two sessions of the same lab may not
overlap (back-to-back is fine), and a session may not be opened while another running session uses its lab.

Only sessions that have not ended book a room, and sessions of archived classes do not (they can never be opened
again, so they would block the room for good). A session closed early keeps its booking: it can still be reopened
until its ends_at (move its end time to free the room). Every session has a lab (a session only loses it when its lab
is deleted, which is refused while the lab has sessions that have not ended).

Every check runs under a row lock on the lab, so two instructors booking the same room at the same moment are
serialised and the second one sees the first booking. Lock order everywhere: classes -> lab_sessions -> labs."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import utcnow
from app.core.errors import ConflictError, NotFoundError
from app.models.classroom import Classroom
from app.models.lab import Lab
from app.models.lab_session import LabSession
from app.models.user import User
from app.schemas.lab import BookingClass, BookingInstructor, LabBooking


def _with_owner() -> Select:
    return (select(LabSession, Classroom, User).join(Classroom, Classroom.id == LabSession.class_id)
            .join(User, User.id == Classroom.instructor_id))


def _booked(lab_id: int) -> Select:
    """The sessions that currently book this lab."""
    return _with_owner().where(LabSession.lab_id == lab_id, LabSession.ends_at > utcnow(),
                               Classroom.is_archived.is_(False))


def _is_running(session: LabSession) -> bool:
    return session.is_open and session.ends_at > utcnow()


def _booking(session: LabSession, classroom: Classroom, instructor: User, viewer: Optional[User]) -> LabBooking:
    return LabBooking(session_id=session.id, name=session.name, starts_at=session.starts_at,
                      ends_at=session.ends_at, is_open=_is_running(session),
                      class_=BookingClass(id=classroom.id, name=classroom.name,
                                          year_and_section=classroom.year_and_section),
                      instructor=BookingInstructor(id=instructor.id, full_name=instructor.full_name),
                      mine=viewer is not None and classroom.instructor_id == viewer.id)


def schedule(db: Session, viewer: User, lab_id: int, start: Optional[datetime],
             end: Optional[datetime]) -> list[LabBooking]:
    """The lab's bookings that have not ended: running ones first, then upcoming by starts_at. `start`/`end` keep only
    the sessions that overlap that window (for paging through later dates)."""
    if db.get(Lab, lab_id) is None:
        raise NotFoundError("Lab not found", "LAB_NOT_FOUND")
    stmt = _booked(lab_id)
    if start is not None:
        stmt = stmt.where(LabSession.ends_at > start)
    if end is not None:
        stmt = stmt.where(LabSession.starts_at < end)
    rows = db.execute(stmt).all()
    rows.sort(key=lambda r: (not _is_running(r[0]), r[0].starts_at, r[0].id))
    return [_booking(s, c, u, viewer) for s, c, u in rows]


def lock_lab(db: Session, lab_id: int) -> Lab:
    lab = db.scalar(select(Lab).where(Lab.id == lab_id).with_for_update())
    if lab is None:
        raise NotFoundError("Lab not found", "LAB_NOT_FOUND")
    return lab


def check_free(db: Session, lab: Lab, starts_at: datetime, ends_at: datetime, viewer: User,
               exclude_session_id: Optional[int] = None) -> None:
    """LAB_BOOKED if another session books the lab during [starts_at, ends_at). The caller holds lock_lab()."""
    if ends_at <= utcnow():           # a window that is over books nothing
        return
    stmt = _booked(lab.id).where(LabSession.starts_at < ends_at, LabSession.ends_at > starts_at)
    if exclude_session_id is not None:
        stmt = stmt.where(LabSession.id != exclude_session_id)
    row = db.execute(stmt.order_by(LabSession.starts_at, LabSession.id).limit(1)).first()
    if row is not None:
        _refuse(db, "LAB_BOOKED", f"{lab.name} is booked {_span(row[0].starts_at, row[0].ends_at)}", row, viewer)


def count_booked(db: Session, lab_id: int) -> int:
    """How many sessions book this lab (not ended, of a class that is not archived)."""
    return db.scalar(select(func.count()).select_from(_booked(lab_id).subquery())) or 0


def check_not_in_use(db: Session, lab: Lab, session: LabSession, viewer: Optional[User]) -> None:
    """LAB_IN_USE if another session using the lab is running right now, including one opened before its start (it
    uses the room from the moment it was opened). The caller holds lock_lab(). viewer None = the scheduler."""
    stmt = _with_owner().where(LabSession.lab_id == lab.id, LabSession.id != session.id,
                               LabSession.is_open.is_(True), LabSession.ends_at > utcnow())
    row = db.execute(stmt.order_by(LabSession.ends_at).limit(1)).first()
    if row is not None:
        _refuse(db, "LAB_IN_USE", f"{lab.name} is in use until {_time(_local(row[0].ends_at))}", row, viewer)


def _refuse(db: Session, code: str, what: str, row, viewer: Optional[User]) -> None:
    other, classroom, instructor = row
    conflict = _booking(other, classroom, instructor, viewer).model_dump(mode="json", by_alias=True)
    detail = f"{what} by {instructor.full_name} ({classroom.name}, {other.name})"
    db.rollback()   # releases the locks
    raise ConflictError(detail, code, conflict=conflict)


# --------------------------------------------------------------------- "Oct 15, 10:00–11:00 AM" (school time)

def _local(moment: datetime) -> datetime:
    return moment + timedelta(hours=settings.DISPLAY_UTC_OFFSET_HOURS)


def _clock(t: datetime) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d}"


def _time(t: datetime) -> str:
    return f"{_clock(t)} {'AM' if t.hour < 12 else 'PM'}"


def when(moment: datetime) -> str:
    """"Oct 19, 8:00 AM" in school time."""
    t = _local(moment)
    return f"{t:%b} {t.day}, {_time(t)}"


def when_near(reference: datetime, moment: datetime) -> str:
    """Like when(), without the date when it is the same day as `reference` ("7:45 AM")."""
    return _time(_local(moment)) if _local(moment).date() == _local(reference).date() else when(moment)


def _span(starts_at: datetime, ends_at: datetime) -> str:
    a, b = _local(starts_at), _local(ends_at)
    day = f"{a:%b} {a.day}"
    if a.date() != b.date():
        return f"{day}, {_time(a)} – {b:%b} {b.day}, {_time(b)}"
    if (a.hour < 12) == (b.hour < 12):
        return f"{day}, {_clock(a)}–{_time(b)}"
    return f"{day}, {_time(a)}–{_time(b)}"
