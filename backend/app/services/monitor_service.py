"""Live monitoring: events for the instructor's monitor, student presence, and the monitor snapshot.

Events go to Redis channel `monitor:{lab_session_id}` as
  {"type": "run"|"run_done"|"saved"|"submitted"|"online"|"offline", "student_id", "student", "ts", ...}
Presence is a Redis sorted set `online:{class_id}` (member = student id, score = last heartbeat time).
"""
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import redis
from sqlalchemy import case, func, literal_column, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import NotFoundError
from app.core.redis import get_redis, publish_event
from app.models.activity import Activity
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.execution import Execution, ExecutionKind, ExecutionStatus
from app.models.lab_session import LabSession
from app.models.submission import Submission
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceFile
from app.schemas.enrollment import StudentBrief
from app.schemas.monitor import LastRun, LastTest, MonitorSnapshot, StudentMonitor
from app.services import class_service, grading_service, session_service

logger = logging.getLogger(__name__)

PRESENCE_TIMEOUT = 30  # seconds without a heartbeat before a student counts as offline
PRESENCE_KEY_TTL = 300


def monitor_channel(session_id: int) -> str:
    return f"monitor:{session_id}"


def presence_key(class_id: int) -> str:
    return f"online:{class_id}"


# ------------------------------------------------------------------- events

def emit(session_id: Optional[int], event_type: str, student_id: int, student_name: str, **data: Any) -> None:
    """Publish one monitor event. No lab session = nobody is monitoring = nothing to do."""
    if session_id is None:
        return
    payload = {"type": event_type, "student_id": student_id, "student": student_name,
               "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), **data}
    publish_event(monitor_channel(session_id), payload)


def emit_for_class(db: Session, class_id: int, event_type: str, student_id: int, student_name: str,
                   **data: Any) -> None:
    session = session_service.get_open_session(db, class_id)
    emit(session.id if session else None, event_type, student_id, student_name, **data)


# ----------------------------------------------------------------- presence

def presence_touch(class_id: int, student_id: int) -> bool:
    """Record a heartbeat. Returns True if the student was not online until now."""
    r, now = get_redis(), time.time()
    previous = r.zscore(presence_key(class_id), str(student_id))
    r.zadd(presence_key(class_id), {str(student_id): now})
    r.expire(presence_key(class_id), PRESENCE_KEY_TTL)
    return previous is None or now - previous > PRESENCE_TIMEOUT


def presence_remove(class_id: int, student_id: int) -> None:
    get_redis().zrem(presence_key(class_id), str(student_id))


def online_ids(class_id: int) -> set[int]:
    members = get_redis().zrangebyscore(presence_key(class_id), time.time() - PRESENCE_TIMEOUT, "+inf")
    return {int(m) for m in members}


def sweep_presence(db: Session) -> int:
    """Beat job: drop students whose heartbeat stopped (browser crashed, cable pulled) and announce them
    as offline. A clean disconnect is handled by the WebSocket itself; this catches the rest."""
    r, removed = get_redis(), 0
    cutoff = time.time() - PRESENCE_TIMEOUT
    try:
        for key in r.scan_iter("online:*"):
            class_id = int(key.split(":", 1)[1])
            for member in r.zrangebyscore(key, "-inf", cutoff):
                if r.zrem(key, member):  # only the sweeper that actually removed it announces it
                    removed += 1
                    student = db.get(User, int(member))
                    if student is not None:
                        emit_for_class(db, class_id, "offline", student.id, student.full_name, reason="timeout")
    except redis.RedisError:
        logger.exception("presence sweep failed")
    return removed


# ----------------------------------------------------------------- snapshot

def snapshot(db: Session, instructor: User, session_id: int) -> MonitorSnapshot:
    session = db.get(LabSession, session_id)
    if session is None:
        raise NotFoundError("Lab session not found", "SESSION_NOT_FOUND")
    class_service.get_owned_class(db, session.class_id, instructor)

    rows = db.execute(
        select(User).join(Enrollment, Enrollment.student_id == User.id)
        .where(Enrollment.class_id == session.class_id, Enrollment.status == EnrollmentStatus.APPROVED)
        .order_by(User.full_name, User.id)
    ).scalars().all()

    # most recent plain Run per student during this session (Test jobs are reported as last_test)
    newest_run = (select(func.max(Execution.id))
                  .where(Execution.lab_session_id == session.id, Execution.kind == ExecutionKind.RUN)
                  .group_by(Execution.student_id))
    last_runs = {e.student_id: e for e in db.scalars(select(Execution).where(Execution.id.in_(newest_run)))}

    # most recent FINISHED Test per student during this session (one that is still running has no result yet,
    # so the previous finished one is shown until it completes)
    newest_test = (select(func.max(Execution.id))
                   .where(Execution.lab_session_id == session.id, Execution.kind == ExecutionKind.TEST,
                          Execution.status.not_in([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING,
                                                   ExecutionStatus.SYSTEM_ERROR]))
                   .group_by(Execution.student_id))
    last_tests = {e.student_id: e for e in db.scalars(select(Execution).where(Execution.id.in_(newest_test)))
                  if e.test_results}

    # last real save: updated_at moves >= 1 s past created_at only when content is saved (installing starter
    # files and renaming leave it alone)
    saved = case((func.timestampdiff(literal_column("SECOND"), WorkspaceFile.created_at,
                                     WorkspaceFile.updated_at) >= 1, WorkspaceFile.updated_at))
    last_saves = dict(db.execute(
        select(Workspace.student_id, func.max(saved))
        .join(WorkspaceFile, WorkspaceFile.workspace_id == Workspace.id)
        .where(Workspace.class_id == session.class_id, WorkspaceFile.is_folder.is_(False))
        .group_by(Workspace.student_id)).all())

    since = min(session.starts_at, session.opened_at) if session.opened_at else session.starts_at
    submissions = dict(db.execute(
        select(Submission.student_id, func.max(Submission.submitted_at))
        .join(Activity, Activity.id == Submission.activity_id)
        .where(Activity.class_id == session.class_id, Submission.submitted_at >= since)
        .group_by(Submission.student_id)).all())

    online = online_ids(session.class_id)
    students = []
    for u in rows:
        run, test = last_runs.get(u.id), last_tests.get(u.id)
        totals = grading_service.summarize(test.test_results) if test is not None else None
        students.append(StudentMonitor(
            student=StudentBrief(id=u.id, username=u.username, full_name=u.full_name, student_no=u.student_no),
            online=u.id in online,
            last_run=None if run is None else LastRun(
                execution_id=run.id, entry_path=run.entry_path, status=run.status,
                duration_ms=run.duration_ms, queued_at=run.queued_at, finished_at=run.finished_at),
            last_test=None if test is None else LastTest(
                execution_id=test.id, activity_id=test.activity_id, passed=totals.passed, total=totals.total,
                score=totals.score, max_score=totals.max_score, finished_at=test.finished_at),
            last_save=last_saves.get(u.id),
            submitted=u.id in submissions,
            last_submitted_at=submissions.get(u.id),
        ))
    return MonitorSnapshot(session_id=session.id, class_id=session.class_id, is_open=session.is_open,
                           generated_at=utcnow(), online_count=sum(s.online for s in students),
                           students=students)
