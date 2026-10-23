import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.core.redis import publish_event
from app.models.classroom import Classroom
from app.models.lab_session import LabSession
from app.models.user import User
from app.schemas.lab_session import SessionCreate, SessionUpdate
from app.services import audit_service, booking_service, class_service

logger = logging.getLogger(__name__)

# A session may be opened (by hand) from this long before its start; it opens itself at its start.
OPEN_EARLY_MINUTES = 15


def class_channel(class_id: int) -> str:
    return f"class:{class_id}"


def running():
    """SQL condition: open AND not past its scheduled end. A session whose end has passed counts as closed at once,
    even in the few seconds before close_ended_sessions() flips its flag (so writes stop exactly on time)."""
    return and_(LabSession.is_open.is_(True), LabSession.ends_at > utcnow())


def get_open_session(db: Session, class_id: int, lock: bool = False) -> Optional[LabSession]:
    stmt = select(LabSession).where(LabSession.class_id == class_id, running())
    if lock:
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def require_lab_open(db: Session, class_id: int) -> LabSession:
    """Guard for every student write (workspace edits, Run). Reading is never guarded."""
    session = get_open_session(db, class_id)
    if session is None:
        raise ForbiddenError("Laboratory access is closed", "LAB_CLOSED")
    return session


def _get_session_owned(db: Session, session_id: int, instructor: User) -> LabSession:
    session = db.get(LabSession, session_id)
    if session is None:
        raise NotFoundError("Lab session not found", "SESSION_NOT_FOUND")
    class_service.get_owned_class(db, session.class_id, instructor)
    return session


def create_session(db: Session, class_id: int, instructor: User, data: SessionCreate,
                   ip: Optional[str]) -> LabSession:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    if classroom.is_archived:
        raise AppError(400, "This class is archived", "CLASS_ARCHIVED")
    if data.ends_at <= data.starts_at:
        raise AppError(400, "ends_at must be after starts_at", "INVALID_SESSION_WINDOW")
    lab = booking_service.lock_lab(db, data.lab_id)
    booking_service.check_free(db, lab, data.starts_at, data.ends_at, instructor)
    session = LabSession(class_id=classroom.id, name=data.name.strip(),
                         starts_at=data.starts_at, ends_at=data.ends_at, is_open=False, lab_id=data.lab_id)
    db.add(session)
    db.flush()
    audit_service.record(db, audit_service.SESSION_CREATE, user_id=instructor.id,
                         details={"class_id": classroom.id, "session_id": session.id}, ip_address=ip)
    db.commit()
    return session


def list_sessions(db: Session, class_id: int, instructor: User, offset: int,
                  limit: int) -> tuple[list[LabSession], int]:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    stmt = select(LabSession).where(LabSession.class_id == classroom.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(LabSession.starts_at.desc(), LabSession.id.desc())
                       .offset(offset).limit(limit)).all()
    return list(items), total


def get_current(db: Session, class_id: int, user: User) -> Optional[LabSession]:
    """The open session of the class, or None. Visible to its instructor and approved students."""
    class_service.get_class_for_member(db, class_id, user)
    return get_open_session(db, class_id)


def open_session(db: Session, session_id: int, instructor: User, ip: Optional[str]) -> LabSession:
    session = _get_session_owned(db, session_id, instructor)
    # Serialise concurrent opens for the same class so "one open session per class" can't be raced.
    # Every read after taking the lock must be a locking read: plain reads would use this
    # transaction's older snapshot and miss a session another request just opened.
    classroom = db.scalars(select(Classroom).where(Classroom.id == session.class_id).with_for_update()).one()
    db.refresh(session, with_for_update=True)

    # Ended comes first: a session still flagged open in the seconds before the sweep closes it has ended too.
    if session.ends_at <= utcnow():
        db.rollback()
        raise ConflictError("This session's scheduled end has passed. Change its end time to open it again.",
                            "SESSION_ENDED")
    if session.is_open:  # already open: nothing to do
        db.rollback()
        return session
    if classroom.is_archived:
        db.rollback()
        raise AppError(400, "This class is archived", "CLASS_ARCHIVED")
    opens_at = session.starts_at - timedelta(minutes=OPEN_EARLY_MINUTES)
    if utcnow() < opens_at:
        name, starts_at = session.name, session.starts_at
        db.rollback()
        raise ConflictError(f"{name} starts {booking_service.when(starts_at)}: it can be opened from "
                            f"{booking_service.when_near(starts_at, opens_at)}.", "SESSION_NOT_STARTED",
                            opens_at=opens_at.isoformat() + "Z")
    other = get_open_session(db, session.class_id, lock=True)
    if other is not None:
        db.rollback()
        raise ConflictError(
            f"Another session ('{other.name}') is already open for this class", "SESSION_ALREADY_OPEN")
    if session.lab_id is None:   # (its lab was deleted after it ended, and its end was then moved later)
        db.rollback()
        raise ConflictError("Choose a lab for this session before opening it", "LAB_REQUIRED")
    booking_service.check_not_in_use(db, booking_service.lock_lab(db, session.lab_id), session, instructor)

    session.is_open = True
    session.opened_at = utcnow()
    session.closed_at = None
    audit_service.record(db, audit_service.SESSION_OPEN, user_id=instructor.id,
                         details={"class_id": session.class_id, "session_id": session.id}, ip_address=ip)
    db.commit()
    publish_event(class_channel(session.class_id), {"type": "session_opened"})
    return session


def update_session(db: Session, session_id: int, instructor: User, data: SessionUpdate,
                   ip: Optional[str]) -> LabSession:
    """Rename or reschedule, e.g. extend a running session by 30 minutes. Allowed while it is open; a new end in
    the past makes it end now (the next sweep closes it).

    A session that has ALREADY ended stays ended: if it is still flagged open (the seconds before the sweep), it is
    closed first, exactly as the sweep would, so moving its end later never lets students back in without Open."""
    _get_session_owned(db, session_id, instructor)
    session = db.scalar(select(LabSession).where(LabSession.id == session_id).with_for_update())  # vs the sweep
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    starts_at, ends_at = changes.get("starts_at", session.starts_at), changes.get("ends_at", session.ends_at)
    if ends_at <= starts_at:
        db.rollback()
        raise AppError(400, "ends_at must be after starts_at", "INVALID_SESSION_WINDOW")
    lab_id = changes.get("lab_id", session.lab_id)
    moving = lab_id != session.lab_id
    if lab_id is not None and (moving or (starts_at, ends_at) != (session.starts_at, session.ends_at)):
        lab = booking_service.lock_lab(db, lab_id)        # (lock order: the session, then the lab)
        booking_service.check_free(db, lab, starts_at, ends_at, instructor, exclude_session_id=session.id)
        if moving and session.is_open and session.ends_at > utcnow():   # a running session: the room must be free
            booking_service.check_not_in_use(db, lab, session, instructor)
    ended_while_open = session.is_open and session.ends_at <= utcnow()
    if ended_while_open:
        _close_at_scheduled_end(db, session)
    if "name" in changes:
        session.name = changes["name"].strip()
    session.starts_at, session.ends_at, session.lab_id = starts_at, ends_at, lab_id
    audit_service.record(db, audit_service.SESSION_UPDATE, user_id=instructor.id,
                         details={"class_id": session.class_id, "session_id": session.id, "fields": sorted(changes)},
                         ip_address=ip)
    db.commit()
    if ended_while_open:
        _announce_scheduled_end(session)
    return session


def _close_at_scheduled_end(db: Session, session: LabSession) -> None:
    """The sweep's close (the caller holds the row lock and commits, then calls _announce_scheduled_end)."""
    session.is_open = False
    session.closed_at = utcnow()
    audit_service.record(db, audit_service.SESSION_CLOSE, user_id=None,
                         details={"class_id": session.class_id, "session_id": session.id, "reason": "scheduled_end"})


def _announce_scheduled_end(session: LabSession) -> None:
    publish_event(class_channel(session.class_id), {"type": "session_closed", "reason": "scheduled_end"})


def run_schedule(db: Session) -> dict[str, int]:
    """The scheduler (Celery beat, every 15 s): closes sessions at their end, puts back sessions opened too early,
    and opens sessions at their start."""
    return {"closed_ended": close_ended_sessions(db), "closed_early": close_sessions_opened_too_early(db),
            "opened": open_started_sessions(db)}


def close_sessions_opened_too_early(db: Session) -> int:
    """Sessions open more than OPEN_EARLY_MINUTES before their start (opened before that rule existed, or moved
    later while open) would hold their lab outside their booked slot. They are closed and put back to "not opened
    yet" (opened_at and closed_at cleared), so they still open themselves at their start. The class hears
    "session_closed" with reason "before_start"."""
    early = db.scalars(select(LabSession.id).where(
        LabSession.is_open.is_(True),
        LabSession.starts_at > utcnow() + timedelta(minutes=OPEN_EARLY_MINUTES))).all()
    closed = 0
    for session_id in early:
        session = db.scalar(select(LabSession).where(LabSession.id == session_id).with_for_update())
        if session is None or not session.is_open or \
                session.starts_at <= utcnow() + timedelta(minutes=OPEN_EARLY_MINUTES):
            db.rollback()
            continue
        session.is_open, session.opened_at, session.closed_at = False, None, None
        audit_service.record(db, audit_service.SESSION_CLOSE, user_id=None,
                             details={"class_id": session.class_id, "session_id": session.id,
                                      "reason": "before_start"})
        db.commit()
        publish_event(class_channel(session.class_id), {"type": "session_closed", "reason": "before_start"})
        closed += 1
    if closed:
        logger.info("closed sessions opened before their start", extra={"count": closed})
    return closed


def _opened_in_its_slot(session: LabSession) -> bool:
    """Opened (by anyone) from OPEN_EARLY_MINUTES before its start on. An opening days before (allowed before that
    rule existed) does not count."""
    return session.opened_at is not None and \
        session.opened_at >= session.starts_at - timedelta(minutes=OPEN_EARLY_MINUTES)


def open_started_sessions(db: Session) -> int:
    """Opens each session at its start, exactly like the instructor's Open (the class hears "session_opened" with
    reason "scheduled_start", the audit log records it with no user). Only a session not yet opened during its slot:
    one the instructor opened and closed again stays closed. Skipped (and tried again on the next run) while the class
    has another session open or the lab is in use; a session without a lab never opens itself."""
    now = utcnow()
    candidates = db.scalars(select(LabSession).join(Classroom, Classroom.id == LabSession.class_id).where(
        LabSession.is_open.is_(False), LabSession.lab_id.is_not(None),
        LabSession.starts_at <= now, LabSession.ends_at > now, Classroom.is_archived.is_(False))
        .order_by(LabSession.starts_at, LabSession.id)).all()
    due = [s.id for s in candidates if not _opened_in_its_slot(s)]
    db.rollback()
    opened = 0
    for session_id in due:
        class_id = db.scalar(select(LabSession.class_id).where(LabSession.id == session_id))
        # the same lock order as open_session: the class, the session, then the lab
        classroom = db.scalars(select(Classroom).where(Classroom.id == class_id).with_for_update()).one()
        session = db.scalar(select(LabSession).where(LabSession.id == session_id).with_for_update())
        now = utcnow()
        if session is None or session.is_open or _opened_in_its_slot(session) or session.lab_id is None or \
                classroom.is_archived or not (session.starts_at <= now < session.ends_at) or \
                get_open_session(db, class_id, lock=True) is not None:
            db.rollback()
            continue
        try:
            booking_service.check_not_in_use(db, booking_service.lock_lab(db, session.lab_id), session, None)
        except AppError:                       # the lab is in use (or was just deleted): not now
            db.rollback()
            continue
        session.is_open, session.opened_at, session.closed_at = True, now, None
        audit_service.record(db, audit_service.SESSION_OPEN, user_id=None,
                             details={"class_id": class_id, "session_id": session.id, "reason": "scheduled_start"})
        db.commit()
        publish_event(class_channel(class_id), {"type": "session_opened", "reason": "scheduled_start"})
        opened += 1
    if opened:
        logger.info("opened sessions at their scheduled start", extra={"count": opened})
    return opened


def close_ended_sessions(db: Session) -> int:
    """Closes every open session whose scheduled end has passed, exactly like the instructor's Close (the class hears
    "session_closed", the audit log records it, with no user and reason "scheduled_end"). Run by Celery beat."""
    ended = db.scalars(select(LabSession.id).where(LabSession.is_open.is_(True),
                                                   LabSession.ends_at <= utcnow())).all()
    closed = 0
    for session_id in ended:
        session = db.scalar(select(LabSession).where(LabSession.id == session_id).with_for_update())
        if session is None or not session.is_open or session.ends_at > utcnow():  # closed or extended meanwhile
            db.rollback()
            continue
        _close_at_scheduled_end(db, session)
        db.commit()
        _announce_scheduled_end(session)
        closed += 1
    if closed:
        logger.info("closed sessions at their scheduled end", extra={"count": closed})
    return closed


def close_session(db: Session, session_id: int, instructor: User, ip: Optional[str]) -> LabSession:
    session = _get_session_owned(db, session_id, instructor)
    if not session.is_open:  # already closed: nothing to do, nothing to announce
        return session

    session.is_open = False
    session.closed_at = utcnow()
    audit_service.record(db, audit_service.SESSION_CLOSE, user_id=instructor.id,
                         details={"class_id": session.class_id, "session_id": session.id}, ip_address=ip)
    db.commit()
    publish_event(class_channel(session.class_id), {"type": "session_closed"})
    return session
