"""
Celery task: loads the student's workspace from MySQL, runs it in a fresh sandbox,
streams output to the student over Redis pub/sub, then saves the result.
(Model/import names match the app/models and app/core modules.)
"""
import json
import logging
import secrets
import time

import redis
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.core.database import SessionLocal, utcnow
from app.models.activity import Activity
from app.models.execution import Execution, ExecutionKind, ExecutionStatus
from app.models.submission import Submission, SubmissionFile
from app.models.test_case import TestCase
from app.models.tutorial import TutorialLesson
from app.models.user import User
from app.models.workspace import WorkspaceFile
from app.services import (grading_service, interactive_service, monitor_service, registration_service,
                          session_service, tutorial_service)
from app.services.health_service import DOCKER_HEALTH_KEY
from app.worker.celery_app import celery_app
from app.worker.sandbox import IMAGE, RunResult, client, reap_orphans, run_in_sandbox
from app.worker.sandbox import run_interactive as sandbox_run_interactive

logger = logging.getLogger(__name__)

r = redis.Redis.from_url(settings.REDIS_URL)


RETRIABLE_DB_ERRORS = {1205, 1213}  # lock wait timeout, deadlock victim: the transaction is safe to run again


def commit_with_retry(db, apply, attempts: int = 4) -> None:
    """Runs `apply()` (which sets attributes) and commits; retries when MySQL picked us as a deadlock victim.
    A lost status update would leave the student's run stuck, so this must not give up on a transient error."""
    for attempt in range(1, attempts + 1):
        try:
            apply()
            db.commit()
            return
        except OperationalError as exc:
            db.rollback()
            code = exc.orig.args[0] if exc.orig is not None and exc.orig.args else None
            if code not in RETRIABLE_DB_ERRORS or attempt == attempts:
                raise
            logger.warning("db deadlock/lock timeout, retrying", extra={"attempt": attempt, "code": code})
            time.sleep(0.05 * attempt)


@celery_app.task(acks_late=True, soft_time_limit=12, time_limit=15)
def run_code(execution_id: int, files=None, case_ids=None):
    """kind "run": run the entry file. kind "test"/"grade": run the test cases (see _run_test_job).
    `files` replaces the workspace (an instructor's "try", a tutorial run or check); `case_ids` limits a try."""
    channel = f"exec:{execution_id}"
    db = SessionLocal()
    started = time.monotonic()
    try:
        ex = db.get(Execution, execution_id)
        # Redelivered after a crash, or already expired as stale: never run the same job twice.
        if ex is None or ex.status != ExecutionStatus.QUEUED:
            logger.warning("run_code skipped", extra={"execution_id": execution_id,
                                                      "status": ex.status.value if ex else None})
            return
        if ex.kind != ExecutionKind.RUN:
            _run_test_job(db, ex, files, case_ids, started)
            return
        files = _given_files(files) if files is not None else [
            {"path": f.path, "content": f.content or "", "is_folder": f.is_folder}
            for f in db.query(WorkspaceFile).filter_by(workspace_id=ex.workspace_id)
        ]

        def mark_running() -> None:
            ex.status = "running"
            ex.started_at = utcnow()

        commit_with_retry(db, mark_running)
        r.publish(channel, json.dumps({"type": "status", "status": "running"}))

        try:
            result = run_in_sandbox(
                files=files,
                entry=ex.entry_path,
                stdin=ex.stdin or "",
                on_output=lambda chunk: r.publish(channel, json.dumps({"type": "output", "data": chunk})),
            )
        except SoftTimeLimitExceeded:
            # The sandbox stops runaway code itself at 10 s and reports "timeout". Reaching Celery's 12 s limit
            # therefore means the SERVER was too slow (e.g. Docker stalled), not that the student's code was.
            logger.warning("run overran the celery soft time limit", extra={"execution_id": execution_id})
            result = RunResult("system_error", None,
                               "[The server was too busy to finish this run. Please run it again.]",
                               int((time.monotonic() - started) * 1000))
        except Exception:
            logger.exception("sandbox crashed", extra={"execution_id": execution_id})
            result = RunResult("system_error", None, "[Sandbox error: the run could not be completed]",
                               int((time.monotonic() - started) * 1000))


        def save_result() -> None:
            ex.output, ex.exit_code = result.output, result.exit_code
            ex.status, ex.duration_ms = result.status, result.duration_ms
            ex.finished_at = utcnow()

        commit_with_retry(db, save_result)
        r.publish(channel, json.dumps({"type": "done", "status": result.status,
                                       "exit_code": result.exit_code,
                                       "duration_ms": result.duration_ms}))
        student = db.get(User, ex.student_id)
        monitor_service.emit(ex.lab_session_id, "run_done", ex.student_id, student.full_name if student else "",
                             execution_id=ex.id, status=result.status, exit_code=result.exit_code,
                             duration_ms=result.duration_ms)
    finally:
        db.close()


class _RedisControl:
    """The student's messages for one interactive run, from Redis (the api relays the WebSocket's messages here).
    Subscribed before the program starts. A Stop pressed while the run was still queued is found through its key."""

    def __init__(self, execution_id: int) -> None:
        self.stop_key = interactive_service.stop_key(execution_id)
        self.pubsub = r.pubsub(ignore_subscribe_messages=True)
        self.pubsub.subscribe(interactive_service.control_channel(execution_id))
        self._next_stop_check = 0.0

    def get(self, timeout: float):
        message = self.pubsub.get_message(timeout=timeout)
        if message is not None and message.get("type") == "message":
            parsed, _error = interactive_service.parse_client_message(message["data"])
            if parsed is not None:
                return parsed
        now = time.monotonic()
        if now >= self._next_stop_check:
            self._next_stop_check = now + 1.0
            if r.exists(self.stop_key):
                return {"type": "stop"}
        return None

    def stop_requested(self) -> bool:
        return bool(r.exists(self.stop_key))

    def close(self) -> None:
        try:
            self.pubsub.close()
        except Exception:
            pass


# No Celery time limits matter here: this task runs in a thread pool (which cannot enforce them), and the sandbox
# enforces its own (5 minutes in total, 120 s per input, 10 s of CPU time).
@celery_app.task(acks_late=True, soft_time_limit=interactive_service.TOTAL_SEC + 30,
                 time_limit=interactive_service.TOTAL_SEC + 45)
def run_interactive(execution_id: int, files=None):
    """An interactive run: the program pauses at input() and the student types the value live. Output is streamed on
    exec:{id} as usual, plus {"type":"input_request"} whenever the program waits; the student's lines, eof and stop
    arrive on exec_in:{id}. What was typed is saved in executions.stdin (one line each)."""
    channel = f"exec:{execution_id}"
    db = SessionLocal()
    started = time.monotonic()
    control = None
    try:
        ex = db.get(Execution, execution_id)
        if ex is None or ex.status != ExecutionStatus.QUEUED:
            logger.warning("run_interactive skipped", extra={"execution_id": execution_id,
                                                             "status": ex.status.value if ex else None})
            return
        files = _given_files(files) if files is not None else [
            {"path": f.path, "content": f.content or "", "is_folder": f.is_folder}
            for f in db.query(WorkspaceFile).filter_by(workspace_id=ex.workspace_id)
        ]

        def mark_running() -> None:
            ex.status = "running"
            ex.started_at = utcnow()

        commit_with_retry(db, mark_running)
        control = _RedisControl(execution_id)
        r.publish(channel, json.dumps({"type": "status", "status": "running"}))

        typed: list = []
        if control.stop_requested():  # Stop was pressed while the run was waiting in the queue
            result = RunResult("stopped", None, "[Stopped]", 0)
        else:
            try:
                result, typed = sandbox_run_interactive(
                    files=files, entry=ex.entry_path, nonce=secrets.token_hex(16), control=control,
                    on_output=lambda chunk: r.publish(channel, json.dumps({"type": "output", "data": chunk})),
                    on_input_request=lambda: r.publish(channel, json.dumps({"type": "input_request"})),
                )
            except SoftTimeLimitExceeded:
                logger.warning("interactive run overran the celery soft time limit", extra={"execution_id": execution_id})
                result = RunResult("system_error", None, "[The server was too busy to finish this run. Please run it again.]",
                                   int((time.monotonic() - started) * 1000))
            except Exception:
                logger.exception("sandbox crashed", extra={"execution_id": execution_id})
                result = RunResult("system_error", None, "[Sandbox error: the run could not be completed]",
                                   int((time.monotonic() - started) * 1000))

        def save_result() -> None:
            ex.output, ex.exit_code = result.output, result.exit_code
            ex.status, ex.duration_ms = result.status, result.duration_ms
            ex.stdin = "\n".join(typed)  # "Run again with the same inputs"
            ex.finished_at = utcnow()

        commit_with_retry(db, save_result)
        r.publish(channel, json.dumps({"type": "done", "status": result.status, "exit_code": result.exit_code,
                                       "duration_ms": result.duration_ms}))
        student = db.get(User, ex.student_id)
        monitor_service.emit(ex.lab_session_id, "run_done", ex.student_id, student.full_name if student else "",
                             execution_id=ex.id, status=result.status, exit_code=result.exit_code,
                             duration_ms=result.duration_ms)
    finally:
        if control is not None:
            control.close()
        db.close()


def _given_files(files) -> list:
    return [{"path": f["path"], "content": f.get("content", ""), "is_folder": bool(f.get("is_folder"))} for f in files]


def _job_files(db, ex: Execution, files):
    """(files for the sandbox, submitted_at of the snapshot or None). A grade job runs the frozen SUBMISSION
    SNAPSHOT, a test job the student's live workspace, a try job the files it was given."""
    if files is not None:
        return [{"path": f["path"], "content": f.get("content", ""), "is_folder": False} for f in files], None
    if ex.kind == ExecutionKind.GRADE:
        submission = db.scalar(select(Submission).where(
            Submission.activity_id == ex.activity_id, Submission.student_id == ex.student_id))
        if submission is None:
            return None, None
        rows = db.scalars(select(SubmissionFile).where(SubmissionFile.submission_id == submission.id))
        return [{"path": f.path, "content": f.content or "", "is_folder": False} for f in rows], submission.submitted_at
    rows = db.query(WorkspaceFile).filter_by(workspace_id=ex.workspace_id)
    return [{"path": f.path, "content": f.content or "", "is_folder": f.is_folder} for f in rows], None


def _run_test_job(db, ex: Execution, files, case_ids, started: float) -> None:
    """Runs every test case of the activity against the job's files and records the per-case results.

    The sandbox gets only each case's id and stdin. Its answer is one JSON block framed by a random nonce that
    only the sandbox's boot script knows, so nothing the student's program prints can pass for a result. The
    expected outputs are compared HERE, from the database."""
    channel = f"exec:{ex.id}"
    kind = ex.kind.value

    def finish(status: str, results, summary, note: str, exit_code=None, duration_ms=None) -> None:
        def save() -> None:
            ex.status, ex.exit_code, ex.output = status, exit_code, note
            ex.test_results = results
            ex.duration_ms = duration_ms if duration_ms is not None else int((time.monotonic() - started) * 1000)
            ex.finished_at = utcnow()

        commit_with_retry(db, save)
        done = {"type": "done", "kind": kind, "status": status, "exit_code": exit_code, "duration_ms": ex.duration_ms}
        if summary is not None:
            done.update(passed=summary.passed, total=summary.total, score=summary.score, max_score=summary.max_score)
        r.publish(channel, json.dumps(done))

    activity = db.get(Activity, ex.activity_id) if ex.activity_id else None
    lesson = db.get(TutorialLesson, ex.tutorial_lesson_id) if ex.tutorial_lesson_id else None
    if lesson is not None:  # a tutorial exercise: its tests live in the lesson, not in test_cases
        cases, ignore_prompts = tutorial_service.cases_of(lesson)
    else:
        query = select(TestCase).where(TestCase.activity_id == ex.activity_id).order_by(TestCase.sort_order, TestCase.id)
        cases = [
            grading_service.CaseData(id=c.id, name=c.name, stdin=c.stdin or "", expected=c.expected_output or "",
                                     is_hidden=c.is_hidden, points=c.points, match_mode=c.match_mode,
                                     require_input_read=c.require_input_read)
            for c in db.scalars(query) if case_ids is None or c.id in case_ids
        ] if activity is not None else []
        ignore_prompts = activity.ignore_input_prompts if activity is not None else True
    snapshot, submitted_at = _job_files(db, ex, files)
    if not cases or snapshot is None:
        finish("system_error", None, None, "[Nothing to grade: no test cases or no files]")
        return

    def mark_running() -> None:
        ex.status = "running"
        ex.started_at = utcnow()

    commit_with_retry(db, mark_running)
    r.publish(channel, json.dumps({"type": "status", "status": "running"}))

    # The activity's code requirements, checked on its folder before anything runs: a violation fails every case.
    sources = grading_service.python_files_in(snapshot, ex.entry_path)
    problems = grading_service.check_requirements(activity.requirements, sources) if activity is not None else []
    if problems:
        note = grading_service.requirement_message(problems)
        results, summary = grading_service.failed_results(cases, grading_service.REQUIREMENT_FAILED, note)
        job_status, exit_code, duration_ms = "ok", None, None
    else:
        ran = _run_cases(ex, snapshot, cases, ignore_prompts, started)
        if ran is None:
            finish("system_error", None, None, "[The tests could not be run. Please try again.]")
            return
        results, summary, job_status, exit_code, duration_ms = ran
        note = f"{summary.passed}/{summary.total} tests passed"

    for event in grading_service.progress_events(results):
        r.publish(channel, json.dumps(event))
    finish(job_status, results, summary, note, exit_code, duration_ms)

    if lesson is not None:
        tutorial_service.record_check(db, ex.student_id, lesson.id, summary.passed == summary.total)
    elif ex.kind == ExecutionKind.GRADE and activity is not None and files is None:
        starter = {f["path"]: f.get("content") or "" for f in activity.starter_files or [] if f["path"].endswith(".py")}
        hardcoded = [] if problems else grading_service.hardcoded_cases(cases, sources, activity.instructions or "",
                                                                        starter)
        _record_grade(db, ex, activity, files, submitted_at, summary, hardcoded)
    elif ex.kind == ExecutionKind.TEST and files is None:
        student = db.get(User, ex.student_id)
        monitor_service.emit(ex.lab_session_id, "tested", ex.student_id, student.full_name if student else "",
                             execution_id=ex.id, activity_id=ex.activity_id, passed=summary.passed,
                             total=summary.total, score=summary.score, max_score=summary.max_score)


def _run_cases(ex: Execution, snapshot, cases, ignore_prompts: bool, started: float):
    """Runs the cases in the sandbox: (results, summary, job status, exit code, duration), or None when the tests
    could not be run at all (an infrastructure failure scores nothing, so the submission can be regraded)."""
    nonce = secrets.token_hex(16)
    tests = [{"id": c.id, "stdin": c.stdin} for c in cases]  # ids and stdin only: never the expected outputs
    try:
        result = run_in_sandbox(files=snapshot, entry=ex.entry_path, tests=tests, nonce=nonce,
                                ignore_input_prompts=ignore_prompts,
                                timeout_sec=grading_service.overall_timeout(len(cases)))
    except SoftTimeLimitExceeded:
        logger.warning("test job overran the celery soft time limit", extra={"execution_id": ex.id})
        result = RunResult("system_error", None, "", int((time.monotonic() - started) * 1000))
    except Exception:
        logger.exception("sandbox crashed", extra={"execution_id": ex.id})
        result = RunResult("system_error", None, "", int((time.monotonic() - started) * 1000))

    parsed = grading_service.parse_block(result.output, nonce)
    if parsed is None:
        # No answer from the sandbox. The container's own verdict says why (timeout, memory, ...).
        status = result.status if result.status != "ok" else "error"
        if status == "system_error":
            return None
        fallback = status if status in grading_service.CASE_STATUSES else "error"
        results, summary = grading_service.build_results(cases, None, fallback)
        return results, summary, status, result.exit_code, result.duration_ms
    # A block was delivered, so every case's own verdict stands, even if the container as a whole was marked
    # "memory_exceeded" because the kernel killed one runaway program.
    results, summary = grading_service.build_results(cases, parsed)
    return results, summary, "ok", result.exit_code, result.duration_ms


def _record_grade(db, ex: Execution, activity, files, submitted_at, summary, hardcoded: list[str]) -> None:
    """A grade job's score (and hardcoding flag) on the submission. Only if the student has not resubmitted
    meanwhile (a newer grading job is already queued for that)."""
    if ex.kind != ExecutionKind.GRADE or activity is None or files is not None:
        return
    db.execute(update(Submission).where(
        Submission.activity_id == ex.activity_id, Submission.student_id == ex.student_id,
        Submission.submitted_at == submitted_at
    ).values(tests_passed=summary.passed, tests_total=summary.total, score=summary.score,
             max_score=summary.max_score, graded_at=utcnow(), hardcode_suspected=bool(hardcoded),
             hardcode_tests=hardcoded or None))
    db.commit()


@celery_app.task
def cleanup_orphan_containers():
    """Scheduled every 60 s with Celery beat."""
    return reap_orphans(max_age_sec=30)


@celery_app.task
def run_session_schedule() -> dict:
    """Every 15 s: lab sessions open themselves at their start and close themselves at their end (as if the
    instructor pressed Open / Close), and sessions opened too early are put back."""
    with SessionLocal() as db:
        return session_service.run_schedule(db)


@celery_app.task
def presence_sweep() -> int:
    """Every 10 s: mark students whose heartbeat stopped as offline."""
    with SessionLocal() as db:
        return monitor_service.sweep_presence(db)


@celery_app.task
def delete_expired_registration_codes() -> int:
    """Daily (beat): remove registration codes whose expiry has passed."""
    with SessionLocal() as db:
        return registration_service.delete_expired(db)


@celery_app.task(soft_time_limit=10, time_limit=12)
def docker_heartbeat() -> str:
    """Every 15 s: tell the api (which has no Docker socket) whether Docker and the runner image work."""
    try:
        client.ping()
        client.images.get(IMAGE)
        state = "ok"
    except Exception:
        logger.exception("docker heartbeat failed")
        state = "down"
    r.set(DOCKER_HEALTH_KEY, state, ex=45)
    return state
