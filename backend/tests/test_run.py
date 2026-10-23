"""POST /workspace/{class_id}/run and GET /executions/{id}. The Celery hand-off is replaced by a recorder, so
these tests need neither a worker nor Docker (the full path is covered in test_run_e2e.py)."""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.redis import get_redis
from app.models.activity_log import ActivityLog
from app.models.execution import Execution, ExecutionStatus
from app.models.user import Role
from app.services import execution_service
from tests.conftest import approved_student, login_as, new_class, new_code


@pytest.fixture()
def queued(monkeypatch) -> list[int]:
    """Replaces the Celery hand-off; returns the list of execution ids that would have been queued."""
    ids: list[int] = []
    monkeypatch.setattr(execution_service, "enqueue", ids.append)
    return ids


@pytest.fixture(autouse=True)
def fresh_cooldowns():
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    yield


def uid(c: TestClient) -> int:
    return c.get("/api/v1/auth/me").json()["id"]


def reset_cooldown(c: TestClient) -> None:
    get_redis().delete(execution_service.cooldown_key(uid(c)))


def put_file(c: TestClient, cid: int, path: str, content: str = "print('hi')") -> dict:
    r = c.post(f"/api/v1/workspace/{cid}/files", json={"path": path, "content": content})
    assert r.status_code == 201, r.text
    return r.json()


def run(c: TestClient, cid: int, entry: str = "main.py", stdin: str = ""):
    return c.post(f"/api/v1/workspace/{cid}/run", json={"mode": "batch", "entry_path": entry, "stdin": stdin})


def finish(db: Session, execution_id: int, status: ExecutionStatus = ExecutionStatus.OK) -> None:
    db.expire_all()
    ex = db.get(Execution, execution_id)
    ex.status, ex.finished_at = status, utcnow()
    db.commit()


# ---------------------------------------------------------------- happy path

def test_run_creates_a_queued_execution_and_enqueues_it(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    r = run(lab.student, lab.cid, stdin="Nicole\n")
    assert r.status_code == 202
    body = r.json()
    assert body["queue_position"] == 1 and queued == [body["execution_id"]]

    db.expire_all()
    ex = db.get(Execution, body["execution_id"])
    assert ex.status == ExecutionStatus.QUEUED and ex.entry_path == "main.py" and ex.stdin == "Nicole\n"
    assert ex.lab_session_id == lab.session_id and ex.queued_at is not None and ex.started_at is None
    assert ex.output is None and ex.activity_id is None


def test_execution_is_linked_to_the_activity_folder(lab, db: Session, queued) -> None:
    a = lab.teacher.post(f"/api/v1/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [{"path": "main.py", "content": "print(1)"}]}).json()
    lab.teacher.post(f"/api/v1/activities/{a['id']}/publish")
    r = run(lab.student, lab.cid, entry="Lab 1/main.py")
    assert r.status_code == 202
    db.expire_all()
    assert db.get(Execution, r.json()["execution_id"]).activity_id == a["id"]


def test_queue_position_counts_the_tasks_ahead(lab, queued, monkeypatch) -> None:
    put_file(lab.student, lab.cid, "main.py")
    monkeypatch.setattr(execution_service, "queue_length", lambda: 7)
    assert run(lab.student, lab.cid).json()["queue_position"] == 8


def test_the_run_is_audited_without_code_or_stdin(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py", "SECRET_STUDENT_CODE = 1")
    run(lab.student, lab.cid, stdin="my private input")
    db.expire_all()
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "run")).one()
    assert log.details["entry"] == "main.py" and log.details["class_id"] == lab.cid
    assert "SECRET_STUDENT_CODE" not in str(log.details) and "private input" not in str(log.details)


# --------------------------------------------------------------- lab + access

def test_run_is_blocked_while_the_lab_is_closed(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    lab.teacher.patch(f"/api/v1/sessions/{lab.session_id}/close")
    r = run(lab.student, lab.cid)
    assert r.status_code == 403 and r.json() == {"detail": "Laboratory access is closed", "code": "LAB_CLOSED"}
    assert queued == []
    db.expire_all()
    assert db.scalars(select(Execution)).all() == []


def test_run_rules_for_roles_and_membership(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    pending = login_as(db, Role.STUDENT, "waiting")
    pending.post("/api/v1/enroll", json={"code": lab.code})
    other_cid = new_class(lab.teacher, "Other")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")
    admin = login_as(db, Role.ADMIN, "root")

    for c in (pending, outsider):
        assert run(c, lab.cid).json()["code"] == "NOT_CLASS_MEMBER"
    for c in (lab.teacher, admin):
        assert run(c, lab.cid).status_code == 403
    assert run(TestClient(lab.student.app), lab.cid).status_code == 401
    assert queued == []


# ------------------------------------------------------------- entry + input

@pytest.mark.parametrize("entry,code", [
    ("../main.py", "INVALID_PATH"), ("/etc/passwd.py", "INVALID_PATH"), ("a\\b.py", "INVALID_PATH"),
    ("notes.txt", "INVALID_ENTRY"), ("data.csv", "INVALID_ENTRY"), ("missing.py", "ENTRY_NOT_FOUND"),
])
def test_bad_entry_files_are_rejected_without_burning_the_cooldown(lab, queued, entry: str, code: str) -> None:
    put_file(lab.student, lab.cid, "main.py")
    put_file(lab.student, lab.cid, "notes.txt", "x")
    put_file(lab.student, lab.cid, "data.csv", "x")
    assert run(lab.student, lab.cid, entry=entry).json()["code"] == code
    assert queued == []
    assert run(lab.student, lab.cid).status_code == 202  # not rate-limited by the failed attempts


def test_entry_must_be_a_file_not_a_folder(lab, queued) -> None:
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "dir.py", "is_folder": True})
    assert run(lab.student, lab.cid, entry="dir.py").json()["code"] == "ENTRY_NOT_FOUND"


def test_cannot_run_another_students_file(lab, db: Session, queued) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    put_file(other, lab.cid, "theirs.py")
    assert run(lab.student, lab.cid, entry="theirs.py").json()["code"] == "ENTRY_NOT_FOUND"


def test_stdin_is_limited_and_always_fits_the_column(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    assert run(lab.student, lab.cid, stdin="x" * 10_001).status_code == 422
    worst_case = "\U0001F600" * 10_000  # 4 bytes per character in UTF-8: the largest possible stdin
    r = run(lab.student, lab.cid, stdin=worst_case)
    assert r.status_code == 202
    db.expire_all()
    assert db.get(Execution, r.json()["execution_id"]).stdin == worst_case


# --------------------------------------------------------- 429 rate limiting

def test_only_one_run_at_a_time_per_student(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    first = run(lab.student, lab.cid).json()["execution_id"]

    reset_cooldown(lab.student)  # isolate the "already running" rule from the 3-second rule
    r = run(lab.student, lab.cid)
    assert r.status_code == 429 and r.json()["code"] == "RUN_IN_PROGRESS"
    assert queued == [first]

    finish(db, first)
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).status_code == 202


@pytest.mark.parametrize("state", [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING])
def test_both_queued_and_running_block_a_new_run(lab, db: Session, queued, state: ExecutionStatus) -> None:
    put_file(lab.student, lab.cid, "main.py")
    first = run(lab.student, lab.cid).json()["execution_id"]
    db.expire_all()
    db.get(Execution, first).status = state
    db.commit()
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).json()["code"] == "RUN_IN_PROGRESS"


@pytest.mark.parametrize("state", [ExecutionStatus.OK, ExecutionStatus.ERROR, ExecutionStatus.TIMEOUT,
                                   ExecutionStatus.MEMORY_EXCEEDED, ExecutionStatus.OUTPUT_LIMIT,
                                   ExecutionStatus.SYSTEM_ERROR])
def test_every_finished_status_frees_the_student(lab, db: Session, queued, state: ExecutionStatus) -> None:
    put_file(lab.student, lab.cid, "main.py")
    finish(db, run(lab.student, lab.cid).json()["execution_id"], state)
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).status_code == 202


def test_three_second_cooldown_between_runs(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    first = run(lab.student, lab.cid).json()["execution_id"]
    finish(db, first)  # finished immediately, so only the cooldown can block

    r = run(lab.student, lab.cid)
    assert r.status_code == 429 and r.json()["code"] == "RUN_TOO_FAST"
    ttl = get_redis().ttl(execution_service.cooldown_key(uid(lab.student)))
    assert 0 < ttl <= 3

    time.sleep(3.2)  # the Redis key expires by itself
    deadline = time.monotonic() + 3  # (a step back of the Docker VM clock delays Redis's expiry)
    while (r := run(lab.student, lab.cid)).status_code == 429 and time.monotonic() < deadline:
        time.sleep(0.25)
    assert r.status_code == 202


def test_cooldown_is_per_student(lab, db: Session, queued) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    put_file(lab.student, lab.cid, "main.py")
    put_file(other, lab.cid, "main.py")
    assert run(lab.student, lab.cid).status_code == 202
    assert run(other, lab.cid).status_code == 202


def test_double_click_race_queues_only_one_run(lab, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: run(lab.student, lab.cid), range(8)))
    assert sorted(r.status_code for r in results) == [202] + [429] * 7
    assert len(queued) == 1


def test_lost_executions_stop_blocking_the_student(lab, db: Session, queued) -> None:
    """A worker that died mid-run leaves 'running' behind; after 60 s it must not block the student."""
    put_file(lab.student, lab.cid, "main.py")
    lost = run(lab.student, lab.cid).json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, lost)
    ex.status, ex.queued_at = ExecutionStatus.RUNNING, utcnow() - timedelta(seconds=61)
    db.commit()
    reset_cooldown(lab.student)

    assert run(lab.student, lab.cid).status_code == 202
    db.expire_all()
    lost_row = db.get(Execution, lost)
    assert lost_row.status == ExecutionStatus.SYSTEM_ERROR and lost_row.finished_at is not None


def test_recent_running_execution_is_not_treated_as_lost(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    first = run(lab.student, lab.cid).json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, first)
    ex.status, ex.queued_at = ExecutionStatus.RUNNING, utcnow() - timedelta(seconds=30)
    db.commit()
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).json()["code"] == "RUN_IN_PROGRESS"


# ------------------------------------------------------------ 503 busy server

def test_server_busy_when_more_than_150_tasks_are_waiting(lab, db: Session, queued, monkeypatch) -> None:
    put_file(lab.student, lab.cid, "main.py")
    monkeypatch.setattr(execution_service, "queue_length", lambda: 151)
    r = run(lab.student, lab.cid)
    assert r.status_code == 503 and r.json() == {"detail": "Server busy, try again", "code": "SERVER_BUSY"}
    assert queued == []
    db.expire_all()
    assert db.scalars(select(Execution)).all() == []  # nothing was created

    monkeypatch.setattr(execution_service, "queue_length", lambda: 150)  # exactly 150 is still accepted
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).status_code == 202


def test_the_real_queue_length_reads_the_redis_list(monkeypatch) -> None:
    monkeypatch.setattr(execution_service, "QUEUE_NAME", "test-queue-length")
    r = get_redis()
    r.delete("test-queue-length")
    r.rpush("test-queue-length", "a", "b", "c")
    try:
        assert execution_service.queue_length() == 3
    finally:
        r.delete("test-queue-length")


def test_if_celery_is_unreachable_the_run_fails_cleanly(lab, db: Session, monkeypatch) -> None:
    put_file(lab.student, lab.cid, "main.py")

    def broken(_: int) -> None:
        raise ConnectionError("broker down")

    monkeypatch.setattr(execution_service, "enqueue", broken)
    r = run(lab.student, lab.cid)
    assert r.status_code == 503 and r.json()["code"] == "SERVER_BUSY"
    db.expire_all()
    ex = db.scalars(select(Execution)).one()
    assert ex.status == ExecutionStatus.SYSTEM_ERROR  # not left 'queued' forever

    monkeypatch.setattr(execution_service, "enqueue", lambda _: None)
    reset_cooldown(lab.student)
    assert run(lab.student, lab.cid).status_code == 202  # the student is not stuck


# -------------------------------------------------------------- GET /executions

def test_student_reads_their_own_execution(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = run(lab.student, lab.cid).json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, eid)
    ex.status, ex.output, ex.exit_code, ex.duration_ms = ExecutionStatus.OK, "hi\n", 0, 412
    ex.started_at = ex.finished_at = utcnow()
    db.commit()

    body = lab.student.get(f"/api/v1/executions/{eid}").json()
    assert body["status"] == "ok" and body["output"] == "hi\n" and body["exit_code"] == 0
    assert body["duration_ms"] == 412 and body["class_id"] == lab.cid and body["finished_at"].endswith("Z")


def test_executions_are_private(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = run(lab.student, lab.cid).json()["execution_id"]
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    r = other.get(f"/api/v1/executions/{eid}")
    assert r.status_code == 404 and r.json()["code"] == "EXECUTION_NOT_FOUND"
    # an instructor can read their OWN try-runs, but not a student's execution: it looks like it doesn't exist
    assert lab.teacher.get(f"/api/v1/executions/{eid}").status_code == 404
    assert lab.student.get("/api/v1/executions/99999").status_code == 404
    assert TestClient(lab.student.app).get(f"/api/v1/executions/{eid}").status_code == 401


def test_expiring_lost_runs_only_touches_that_students_rows(lab, db: Session, queued) -> None:
    """Regression: a bulk UPDATE on the status index deadlocked with the workers. Another student's stale
    run must be left alone, and the one-by-one update must still clear this student's lost run."""
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    put_file(lab.student, lab.cid, "main.py")
    put_file(other, lab.cid, "main.py")
    mine, theirs = run(lab.student, lab.cid).json()["execution_id"], run(other, lab.cid).json()["execution_id"]
    db.expire_all()
    for eid in (mine, theirs):
        row = db.get(Execution, eid)
        row.status, row.queued_at = ExecutionStatus.RUNNING, utcnow() - timedelta(seconds=120)
    db.commit()
    reset_cooldown(lab.student)

    assert run(lab.student, lab.cid).status_code == 202
    db.expire_all()
    assert db.get(Execution, mine).status == ExecutionStatus.SYSTEM_ERROR
    assert db.get(Execution, theirs).status == ExecutionStatus.RUNNING  # not ours to expire
