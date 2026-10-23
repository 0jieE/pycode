import logging
from datetime import timedelta
from typing import Callable, Optional

import redis
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, NotFoundError
from app.core.ratelimit import acquire_slot
from app.core.redis import get_redis
from app.models.activity import Activity
from app.models.execution import Execution, ExecutionKind, ExecutionMode, ExecutionStatus
from app.models.submission import Submission
from app.models.test_case import TestCase
from app.models.user import Role, User
from app.models.workspace import Workspace, WorkspaceFile
from app.schemas.execution import ExecutionOut, RunRequest, RunResponse, TestSummary
from app.schemas.test_case import TestJobRequest
from app.services import (audit_service, class_service, grading_service, interactive_service, monitor_service,
                          session_service, workspace_service)
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)

RUN_COOLDOWN_SECONDS = 3
MAX_QUEUE_LENGTH = 150
MAX_PRACTICE_QUEUE_LENGTH = 50  # practice has far fewer workers, so a long queue would mean a long wait
QUEUE_NAME = "celery"  # Celery's default queue = the Redis list that holds waiting lab runs
PRACTICE_QUEUE = "practice"  # separate queue + worker: practice can never take capacity away from a lab
INTERACTIVE_QUEUE = "interactive"  # interactive runs (lab AND practice): their own queue and thread-pool worker
RUN_TASK = "app.worker.tasks.run_code"
INTERACTIVE_TASK = "app.worker.tasks.run_interactive"
# A queued/running execution older than this was lost (worker crash): it stops blocking the student.
STALE_AFTER = timedelta(seconds=60)
# A test job can legitimately take up to a minute, plus time waiting in the queue.
STALE_AFTER_TEST = timedelta(seconds=180)
# An interactive run can take 5 minutes (waiting for the student to type), plus the wait in the queue.
STALE_AFTER_INTERACTIVE = timedelta(seconds=interactive_service.TOTAL_SEC + 120)
# Grading jobs are system-initiated and may sit in a long queue (e.g. a regrade of a whole class): they are
# never expired here and never count against a student's "one active run" slot.
STUDENT_JOB_KINDS = [ExecutionKind.RUN, ExecutionKind.TEST]


def cooldown_key(student_id: int) -> str:
    return f"run:cooldown:{student_id}"


def queue_length(queue: Optional[str] = None) -> int:
    """Tasks waiting for a worker on a queue (default: the lab queue), not counting ones already running."""
    return int(get_redis().llen(queue or QUEUE_NAME))


def _send(execution_id: int, queue: str, task: str = RUN_TASK, files: Optional[list] = None) -> None:
    """Hand the job to Celery by name; the api never imports the task (it needs Docker). `files` makes the run use
    these files instead of a workspace (tutorial runs have none)."""
    extra = {"kwargs": {"files": files}} if files is not None else {}
    celery_app.send_task(task, args=[execution_id], queue=queue, retry=False, **extra)


def enqueue(execution_id: int) -> None:
    _send(execution_id, QUEUE_NAME)


def enqueue_practice(execution_id: int) -> None:
    _send(execution_id, PRACTICE_QUEUE)


def enqueue_interactive(execution_id: int) -> None:
    _send(execution_id, INTERACTIVE_QUEUE, INTERACTIVE_TASK)


def enqueue_job(execution_id: int, *, files: Optional[list] = None, case_ids: Optional[list[int]] = None,
                timeout: Optional[int] = None, queue: str = QUEUE_NAME) -> None:
    """Hand a test / grade / try job to the lab queue (or `queue`). `timeout` is the sandbox's overall limit for the
    job: Celery's own limits are raised just above it (a plain Run keeps 12 s soft / 15 s hard)."""
    limits = {} if timeout is None else {"soft_time_limit": timeout + 5, "time_limit": timeout + 10}
    celery_app.send_task(RUN_TASK, args=[execution_id], kwargs={"files": files, "case_ids": case_ids},
                         queue=queue, retry=False, **limits)


def _server_busy() -> AppError:
    return AppError(503, "Server busy, try again", "SERVER_BUSY")


def _expire_stale(db: Session, student_id: int) -> None:
    """Marks this student's lost runs as failed. Looks first with a plain read (no locks), then updates only
    those rows by primary key: a bulk `UPDATE ... WHERE status IN (...)` scans the status index and locks every
    student's queued rows, which deadlocked with the workers under load."""
    now = utcnow()
    stale_ids = db.scalars(
        select(Execution.id).where(
            Execution.student_id == student_id,
            Execution.status.in_([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING]),
            or_(and_(Execution.kind == ExecutionKind.RUN, Execution.mode == ExecutionMode.BATCH,
                     Execution.queued_at < now - STALE_AFTER),
                and_(Execution.kind == ExecutionKind.RUN, Execution.mode == ExecutionMode.INTERACTIVE,
                     Execution.queued_at < now - STALE_AFTER_INTERACTIVE),
                and_(Execution.kind == ExecutionKind.TEST, Execution.queued_at < now - STALE_AFTER_TEST)))
    ).all()
    if not stale_ids:
        return
    db.execute(
        update(Execution).where(Execution.id.in_(stale_ids))
        .values(status=ExecutionStatus.SYSTEM_ERROR, finished_at=utcnow(),
                output="[The run was lost because the server restarted. Please run it again.]"))
    db.commit()
    logger.warning("expired stale executions", extra={"student_id": student_id, "count": len(stale_ids)})


def _has_active_execution(db: Session, student_id: int) -> bool:
    return db.scalar(
        select(Execution.id).where(
            Execution.student_id == student_id,
            Execution.kind.in_(STUDENT_JOB_KINDS),
            Execution.status.in_([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING]),
        ).limit(1)
    ) is not None


def _activity_for(db: Session, class_id: int, entry_path: str) -> Optional[int]:
    """The published activity whose folder contains the entry file, if any."""
    folder = entry_path.split("/", 1)[0] if "/" in entry_path else None
    if folder is None:
        return None
    return db.scalar(select(Activity.id).where(
        Activity.class_id == class_id, Activity.title == folder, Activity.is_published.is_(True)))


def _validated_entry(db: Session, workspace: Workspace, raw_path: str) -> str:
    """The normalized entry path, after checking it is a .py file that exists in THIS workspace."""
    entry = workspace_service.normalize_file_path(raw_path)
    if not entry.lower().endswith(".py"):
        raise AppError(400, "Only .py files can be run", "INVALID_ENTRY")
    exists = db.scalar(select(WorkspaceFile.id).where(
        WorkspaceFile.workspace_id == workspace.id, WorkspaceFile.path == entry,
        WorkspaceFile.is_folder.is_(False)))
    if exists is None:
        raise NotFoundError(f"File not found: {entry}", "ENTRY_NOT_FOUND")
    return entry


def _admit(db: Session, student: User, waiting_for: Callable[[], int], max_waiting: int) -> int:
    """The per-student limits, identical for lab and practice runs and SHARED between them: one active run
    (429), one run per 3 seconds (429), and a cap on the queue (503). Returns the number of jobs waiting."""
    _expire_stale(db, student.id)
    if _has_active_execution(db, student.id):
        raise AppError(429, "Your previous run is still in progress", "RUN_IN_PROGRESS")
    try:
        if not acquire_slot(get_redis(), cooldown_key(student.id), RUN_COOLDOWN_SECONDS):
            raise AppError(429, "Please wait a few seconds between runs", "RUN_TOO_FAST")
        waiting = waiting_for()
    except redis.RedisError:
        logger.exception("redis unavailable while starting a run")
        raise _server_busy()
    if waiting > max_waiting:
        raise _server_busy()
    return waiting


def _queue_run(db: Session, student: User, workspace: Optional[Workspace], entry: str, stdin: Optional[str], *,
               activity_id: Optional[int], lab_session_id: Optional[int], send: Callable[[int], None],
               audit_details: dict, ip: Optional[str], kind: ExecutionKind = ExecutionKind.RUN,
               mode: ExecutionMode = ExecutionMode.BATCH) -> Execution:
    execution = Execution(
        student_id=student.id, workspace_id=workspace.id if workspace is not None else None, entry_path=entry,
        stdin=stdin, activity_id=activity_id, lab_session_id=lab_session_id, kind=kind, mode=mode,
        status=ExecutionStatus.QUEUED, queued_at=utcnow(),
    )
    db.add(execution)
    db.flush()
    audit_service.record(db, audit_service.RUN, user_id=student.id,
                         details={"execution_id": execution.id, "entry": entry, **audit_details}, ip_address=ip)
    db.commit()  # the worker must be able to see the row before it receives the job

    try:
        send(execution.id)
    except Exception:
        logger.exception("could not enqueue run", extra={"execution_id": execution.id})
        db.execute(update(Execution).where(Execution.id == execution.id).values(
            status=ExecutionStatus.SYSTEM_ERROR, finished_at=utcnow(),
            output="[The run could not be queued. Please try again.]"))
        db.commit()
        raise _server_busy()
    return execution


def start_run(db: Session, student: User, class_id: int, data: RunRequest,
              ip: Optional[str]) -> RunResponse:
    """Validates the request and queues a lab run. Guards, in order: membership, lab open, entry file,
    one active run per student (429), 3-second cooldown (429), queue length (503)."""
    class_service.get_class_for_member(db, class_id, student)
    session = session_service.require_lab_open(db, class_id)
    workspace = workspace_service.ensure_workspace(db, student.id, class_id)
    entry = _validated_entry(db, workspace, data.entry_path)

    interactive = data.mode == "interactive"
    waiting = _admit(db, student, (lambda: queue_length(INTERACTIVE_QUEUE)) if interactive else queue_length,
                     MAX_QUEUE_LENGTH)
    execution = _queue_run(db, student, workspace, entry, None if interactive else data.stdin,
                           activity_id=_activity_for(db, class_id, entry), lab_session_id=session.id,
                           send=enqueue_interactive if interactive else enqueue,
                           audit_details={"class_id": class_id, "mode": data.mode}, ip=ip,
                           mode=ExecutionMode.INTERACTIVE if interactive else ExecutionMode.BATCH)
    monitor_service.emit(session.id, "run", student.id, student.full_name,
                         execution_id=execution.id, entry=entry, status="queued")
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def start_practice_run(db: Session, student: User, data: RunRequest, ip: Optional[str]) -> RunResponse:
    """Queues a run of the student's personal Practice workspace. Not tied to a class, so no lab session is
    needed, none is recorded, and the instructor's monitor never hears about it. It goes to the separate
    "practice" queue; the per-student limits are the same as for lab runs (and shared with them)."""
    workspace = workspace_service.ensure_practice_workspace(db, student)
    entry = _validated_entry(db, workspace, data.entry_path)

    interactive = data.mode == "interactive"
    if interactive:  # interactive runs of every kind share the "interactive" queue and its worker
        waiting = _admit(db, student, lambda: queue_length(INTERACTIVE_QUEUE), MAX_QUEUE_LENGTH)
    else:
        waiting = _admit(db, student, lambda: queue_length(PRACTICE_QUEUE), MAX_PRACTICE_QUEUE_LENGTH)
    execution = _queue_run(db, student, workspace, entry, None if interactive else data.stdin, activity_id=None,
                           lab_session_id=None, send=enqueue_interactive if interactive else enqueue_practice,
                           audit_details={"practice": True, "mode": data.mode}, ip=ip,
                           mode=ExecutionMode.INTERACTIVE if interactive else ExecutionMode.BATCH)
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def start_adhoc_run(db: Session, user: User, files: list[dict], entry: str, stdin: str, mode: str, *,
                    audit_details: dict, ip: Optional[str]) -> RunResponse:
    """A run of files that live nowhere (the tutorial editor): the files travel with the job. No class, no lab
    session, never locked; the practice queue (batch) or the interactive queue, with the usual per-student limits."""
    interactive = mode == "interactive"
    if interactive:
        waiting = _admit(db, user, lambda: queue_length(INTERACTIVE_QUEUE), MAX_QUEUE_LENGTH)
    else:
        waiting = _admit(db, user, lambda: queue_length(PRACTICE_QUEUE), MAX_PRACTICE_QUEUE_LENGTH)
    send = (lambda eid: _send(eid, INTERACTIVE_QUEUE, INTERACTIVE_TASK, files)) if interactive \
        else (lambda eid: _send(eid, PRACTICE_QUEUE, RUN_TASK, files))
    execution = _queue_run(db, user, None, entry, None if interactive else stdin, activity_id=None,
                           lab_session_id=None, send=send, audit_details={**audit_details, "mode": mode}, ip=ip,
                           mode=ExecutionMode.INTERACTIVE if interactive else ExecutionMode.BATCH)
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def start_tutorial_check(db: Session, student: User, lesson, files: list[dict], entry: str, test_count: int,
                         ip: Optional[str]) -> RunResponse:
    """A test job of the lesson's exercise on the given files (practice queue). Same guards as the Test button."""
    waiting = _admit(db, student, lambda: queue_length(PRACTICE_QUEUE), MAX_PRACTICE_QUEUE_LENGTH)
    timeout = grading_service.overall_timeout(test_count)
    execution = Execution(student_id=student.id, workspace_id=None, entry_path=entry, kind=ExecutionKind.TEST,
                          mode=ExecutionMode.BATCH, tutorial_lesson_id=lesson.id, status=ExecutionStatus.QUEUED,
                          queued_at=utcnow())
    db.add(execution)
    db.flush()
    audit_service.record(db, audit_service.RUN, user_id=student.id,
                         details={"execution_id": execution.id, "entry": entry, "kind": "tutorial_check",
                                  "lesson": lesson.slug}, ip_address=ip)
    db.commit()
    try:
        enqueue_job(execution.id, files=files, timeout=timeout, queue=PRACTICE_QUEUE)
    except Exception:
        logger.exception("could not enqueue the tutorial check", extra={"execution_id": execution.id})
        db.execute(update(Execution).where(Execution.id == execution.id).values(
            status=ExecutionStatus.SYSTEM_ERROR, finished_at=utcnow(),
            output="[The check could not be queued. Please try again.]"))
        db.commit()
        raise _server_busy()
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def get_execution(db: Session, user: User, execution_id: int) -> ExecutionOut:
    """Your own execution. Students see test output of visible cases only; an instructor sees their own
    "try" runs in full."""
    row = db.execute(
        select(Execution, Workspace.class_id, Activity.class_id)
        .outerjoin(Workspace, Workspace.id == Execution.workspace_id)
        .outerjoin(Activity, Activity.id == Execution.activity_id)
        .where(Execution.id == execution_id, Execution.student_id == user.id)
    ).first()
    if row is None:  # someone else's execution looks like it doesn't exist
        raise NotFoundError("Execution not found", "EXECUTION_NOT_FOUND")
    ex, workspace_class_id, activity_class_id = row

    results = ex.test_results
    if results is not None and user.role == Role.STUDENT:
        results = grading_service.redact_for_student(results)
    summary = None
    if ex.test_results is not None:  # pass/fail and points are not secret, only the hidden outputs are
        summary = TestSummary(**grading_service.summarize(ex.test_results).__dict__)
    return ExecutionOut(
        id=ex.id, class_id=workspace_class_id if workspace_class_id is not None else activity_class_id,
        practice=ex.workspace_id is not None and workspace_class_id is None, kind=ex.kind, mode=ex.mode,
        stdin=ex.stdin,
        activity_id=ex.activity_id, tutorial_lesson_id=ex.tutorial_lesson_id, entry_path=ex.entry_path,
        status=ex.status, exit_code=ex.exit_code, output=ex.output, test_results=results, test_summary=summary, duration_ms=ex.duration_ms,
        queued_at=ex.queued_at, started_at=ex.started_at, finished_at=ex.finished_at)


# ------------------------------------------------------------ automatic grading jobs

def _load_cases(db: Session, activity_id: int) -> list[TestCase]:
    return list(db.scalars(select(TestCase).where(TestCase.activity_id == activity_id)
                           .order_by(TestCase.sort_order, TestCase.id)))


def start_test(db: Session, student: User, class_id: int, data: TestJobRequest, ip: Optional[str]) -> RunResponse:
    """A student runs the activity's test cases against their own files. Same guards as Run: membership, lab open,
    one active job per student (429), 3 s between jobs (429), queue cap (503)."""
    class_service.get_class_for_member(db, class_id, student)
    session = session_service.require_lab_open(db, class_id)
    activity = db.get(Activity, data.activity_id)
    if activity is None or activity.class_id != class_id or not activity.is_published or activity.is_archived:
        raise NotFoundError("Activity not found", "ACTIVITY_NOT_FOUND")
    cases = _load_cases(db, activity.id)
    if not cases:
        raise AppError(400, "This activity has no test cases", "NO_TEST_CASES")

    workspace = workspace_service.ensure_workspace(db, student.id, class_id)
    entry = _validated_entry(db, workspace, data.entry_path)
    if not entry.lower().startswith(activity.title.lower() + "/"):
        raise AppError(400, f"The file to test must be inside the '{activity.title}' folder", "ENTRY_OUTSIDE_ACTIVITY")

    waiting = _admit(db, student, queue_length, MAX_QUEUE_LENGTH)
    timeout = grading_service.overall_timeout(len(cases))
    execution = _queue_run(
        db, student, workspace, entry, None, activity_id=activity.id, lab_session_id=session.id,
        send=lambda eid: enqueue_job(eid, timeout=timeout), audit_details={"class_id": class_id, "kind": "test"},
        ip=ip, kind=ExecutionKind.TEST)
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def start_try(db: Session, instructor: User, activity: Activity, case: TestCase, files: list[dict],
              ip: Optional[str]) -> RunResponse:
    """An instructor checks one test case against the given files (the activity's starter files by default).
    `files` are relative to the activity folder; they are placed in it exactly as a student's would be."""
    folder = activity.title
    placed = [{"path": f"{folder}/{f['path']}", "content": f.get("content", ""), "is_folder": False} for f in files]
    entry = f"{folder}/{activity.entry_file}"
    if entry not in {f["path"] for f in placed}:
        raise AppError(400, f"There is no '{activity.entry_file}' among the files to run", "ENTRY_NOT_FOUND")

    waiting = _admit(db, instructor, queue_length, MAX_QUEUE_LENGTH)
    timeout = grading_service.overall_timeout(1)
    execution = _queue_run(
        db, instructor, None, entry, None, activity_id=activity.id, lab_session_id=None,
        send=lambda eid: enqueue_job(eid, files=placed, case_ids=[case.id], timeout=timeout),
        audit_details={"kind": "try", "case_id": case.id}, ip=ip, kind=ExecutionKind.TEST)
    return RunResponse(execution_id=execution.id, queue_position=waiting + 1)


def queue_grading(db: Session, activity: Activity, student_id: int, workspace_id: Optional[int]) -> Optional[Execution]:
    """Queues a grading job for one student's submission snapshot. Best effort: grading is system-initiated, so it
    ignores the per-student limits and the queue cap, and a failure to queue never breaks the caller (the score
    simply stays empty until the instructor regrades). Returns the execution, or None if it could not be queued."""
    cases = _load_cases(db, activity.id)
    if not cases:
        return None
    entry = f"{activity.title}/{activity.entry_file}"
    timeout = grading_service.overall_timeout(len(cases))
    execution = Execution(student_id=student_id, workspace_id=workspace_id, activity_id=activity.id,
                          entry_path=entry, kind=ExecutionKind.GRADE, status=ExecutionStatus.QUEUED,
                          queued_at=utcnow())
    db.add(execution)
    db.commit()
    try:
        enqueue_job(execution.id, timeout=timeout)
    except Exception:
        logger.exception("could not queue grading", extra={"execution_id": execution.id})
        db.execute(update(Execution).where(Execution.id == execution.id).values(
            status=ExecutionStatus.SYSTEM_ERROR, finished_at=utcnow()))
        db.commit()
        return None
    return execution


def regrade_activity(db: Session, instructor: User, activity: Activity, ip: Optional[str]) -> tuple[int, int]:
    """Queues grading for every submission of the activity. Returns (queued, skipped); a submission whose grading
    is already waiting or running is skipped, so pressing the button twice does not double the work."""
    if not _load_cases(db, activity.id):
        raise AppError(400, "This activity has no test cases", "NO_TEST_CASES")
    busy = set(db.scalars(select(Execution.student_id).where(
        Execution.activity_id == activity.id, Execution.kind == ExecutionKind.GRADE,
        Execution.status.in_([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING]))))
    queued = skipped = 0
    for student_id, workspace_id in db.execute(
            select(Submission.student_id, Workspace.id)
            .outerjoin(Workspace, and_(Workspace.student_id == Submission.student_id,
                                       Workspace.class_id == activity.class_id))
            .where(Submission.activity_id == activity.id).order_by(Submission.id)).all():
        if student_id in busy:
            skipped += 1
        elif queue_grading(db, activity, student_id, workspace_id) is not None:
            queued += 1
    audit_service.record(db, audit_service.REGRADE, user_id=instructor.id,
                         details={"activity_id": activity.id, "queued": queued, "skipped": skipped}, ip_address=ip)
    db.commit()
    return queued, skipped
