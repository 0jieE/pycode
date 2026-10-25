"""When students start working in a lab session.

The first time a student reaches their class workspace (the file tree, or a file opened) while the class has an
OPEN lab session, a session_starts row is written; the first time they open a file inside an activity's folder in
that session, a session_activity_starts row. Both are written once (INSERT IGNORE behind a unique key, so reloads
and simultaneous first requests change nothing) and announced on the instructor's monitor as
{"type": "started", "student_id", "student", "ts", "started_at", "activity_id"?, "activity"?}.
The client never says which session: the server finds the open one itself. Recording never breaks the request that
triggered it.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity import Activity
from app.models.session_start import SessionActivityStart, SessionStart
from app.models.user import Role, User
from app.services import monitor_service, session_service

logger = logging.getLogger(__name__)


def _iso(moment: datetime) -> str:
    return moment.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _activity_of(db: Session, class_id: int, path: Optional[str]) -> Optional[Activity]:
    """The published activity whose folder holds this path (the folder is the activity's title)."""
    if not path:
        return None
    folder = path.split("/", 1)[0]
    return db.scalar(select(Activity).where(Activity.class_id == class_id, Activity.is_published.is_(True),
                                            Activity.title == folder))


def _insert_once(db: Session, model, **values) -> bool:
    """INSERT IGNORE: True when this call wrote the row, False when it already existed."""
    return db.execute(insert(model).prefix_with("IGNORE").values(**values)).rowcount == 1


def record_access(db: Session, student: User, class_id: int, path: Optional[str] = None) -> None:
    """A student reached their class workspace (`path` = the file they opened, if any)."""
    if student.role != Role.STUDENT:
        return
    try:
        session = session_service.get_open_session(db, class_id)
        if session is None:
            return
        activity = _activity_of(db, class_id, path)
        started = db.scalar(select(SessionStart.id).where(SessionStart.lab_session_id == session.id,
                                                          SessionStart.student_id == student.id))
        known = activity is None or db.scalar(select(SessionActivityStart.id).where(
            SessionActivityStart.lab_session_id == session.id, SessionActivityStart.student_id == student.id,
            SessionActivityStart.activity_id == activity.id)) is not None
        if started is not None and known:
            return                                  # nothing new: the usual case, no write at all

        now = utcnow()
        events = []
        if started is None and _insert_once(db, SessionStart, lab_session_id=session.id, student_id=student.id,
                                            started_at=now):
            events.append({"started_at": _iso(now)})
        if not known and _insert_once(db, SessionActivityStart, lab_session_id=session.id, student_id=student.id,
                                      activity_id=activity.id, started_at=now):
            db.execute(update(SessionStart).where(
                SessionStart.lab_session_id == session.id, SessionStart.student_id == student.id,
                SessionStart.first_activity_id.is_(None)).values(first_activity_id=activity.id))
            events.append({"started_at": _iso(now), "activity_id": activity.id, "activity": activity.title})
        db.commit()
        for data in events:
            monitor_service.emit(session.id, "started", student.id, student.full_name, **data)
    except Exception:
        db.rollback()
        logger.exception("could not record a session start", extra={"class_id": class_id})
