"""The sign-in log: every login writes a login_events row (tied to the student's open lab session, if any), and the
instructor reads a session's sign-ins back. Nothing here looks at addresses or devices."""
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import NotFoundError
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.lab import LoginEvent, LoginOutcome
from app.models.lab_session import LabSession
from app.models.user import Role, User
from app.schemas.enrollment import StudentBrief
from app.schemas.lab import LoginOut
from app.services import class_service, session_service


def _open_session_of(db: Session, student_id: int) -> Optional[LabSession]:
    """The running lab session of one of the student's approved classes, if any."""
    return db.scalar(
        select(LabSession).join(Enrollment, Enrollment.class_id == LabSession.class_id)
        .where(Enrollment.student_id == student_id, Enrollment.status == EnrollmentStatus.APPROVED,
               session_service.running()).order_by(LabSession.id).limit(1))


def log_login(db: Session, user: User, user_agent: Optional[str], outcome: LoginOutcome) -> None:
    """One login_events row (the caller commits)."""
    session = _open_session_of(db, user.id) if user.role == Role.STUDENT else None
    db.add(LoginEvent(user_id=user.id, user_agent=(user_agent or "")[:255] or None,
                      lab_session_id=session.id if session else None, outcome=outcome, created_at=utcnow()))


def list_logins(db: Session, instructor: User, session_id: int, since: Optional[datetime], offset: int,
                limit: int) -> tuple[list[LoginOut], int]:
    """Every sign-in recorded for the session, newest first (only those after `since`, if given)."""
    session = db.get(LabSession, session_id)
    if session is None:
        raise NotFoundError("Lab session not found", "SESSION_NOT_FOUND")
    class_service.get_owned_class(db, session.class_id, instructor)
    stmt = (select(LoginEvent, User).join(User, User.id == LoginEvent.user_id)
            .where(LoginEvent.lab_session_id == session.id))
    if since is not None:
        stmt = stmt.where(LoginEvent.created_at > since)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(LoginEvent.created_at.desc(), LoginEvent.id.desc()).offset(offset).limit(limit))
    return [LoginOut(id=e.id, at=e.created_at, outcome=e.outcome,
                     student=StudentBrief(id=u.id, username=u.username, full_name=u.full_name, student_no=u.student_no))
            for e, u in rows], total
