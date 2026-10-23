"""The Celery task logic with the sandbox replaced by fakes (runs anywhere; no Docker needed)."""
import json

import pytest
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.redis import get_redis
from app.models.execution import Execution, ExecutionStatus
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceFile
from app.services import execution_service
from tests.conftest import Listener


@pytest.fixture()
def queued_execution(lab, db: Session):
    """A queued execution for stu1 with a small workspace; returns (execution_id, channel)."""
    for path, content in (("Lab 1/main.py", "print('hi')"), ("Lab 1/data.csv", "a,b")):
        lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": path, "content": content})
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Empty", "is_folder": True})
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    ids: list[int] = []
    import app.services.execution_service as svc

    original = svc.enqueue
    svc.enqueue = ids.append
    try:
        r = lab.student.post(f"/api/v1/workspace/{lab.cid}/run", json={"mode": "batch", "entry_path": "Lab 1/main.py", "stdin": "in\n"})
    finally:
        svc.enqueue = original
    assert r.status_code == 202, r.text
    return ids[0]


def fake_result(tasks, status="ok", exit_code=0, output="hi\n", ms=123):
    return tasks.RunResult(status, exit_code, output, ms)


def load(db: Session, eid: int) -> Execution:
    db.rollback()
    return db.get(Execution, eid)


def test_successful_run_is_saved_and_streamed(tasks_module, db, queued_execution, monkeypatch) -> None:
    eid, seen = queued_execution, {}

    def fake_sandbox(files, entry, stdin="", on_output=None):
        seen.update(files=files, entry=entry, stdin=stdin)
        on_output("hi\n")
        on_output("more\n")
        return fake_result(tasks_module, output="hi\nmore\n")

    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake_sandbox)
    events = Listener(f"exec:{eid}")
    try:
        tasks_module.run_code(eid)
        got = events.messages()
    finally:
        events.close()

    ex = load(db, eid)
    assert ex.status == ExecutionStatus.OK and ex.exit_code == 0 and ex.output == "hi\nmore\n"
    assert ex.duration_ms == 123 and ex.started_at is not None and ex.finished_at is not None
    assert ex.started_at <= ex.finished_at

    assert got == [
        {"type": "status", "status": "running"},
        {"type": "output", "data": "hi\n"},
        {"type": "output", "data": "more\n"},
        {"type": "done", "status": "ok", "exit_code": 0, "duration_ms": 123},
    ]
    # what the sandbox received: the whole workspace (folders flagged), the entry, and the stdin
    assert seen["entry"] == "Lab 1/main.py" and seen["stdin"] == "in\n"
    by_path = {f["path"]: f for f in seen["files"]}
    assert by_path["Lab 1/main.py"]["content"] == "print('hi')" and by_path["Lab 1/main.py"]["is_folder"] is False
    assert by_path["Empty"]["is_folder"] is True and by_path["Empty"]["content"] == ""
    assert set(by_path) == {"Lab 1", "Lab 1/main.py", "Lab 1/data.csv", "Empty"}


def test_status_is_running_while_the_sandbox_works(tasks_module, db, queued_execution, monkeypatch) -> None:
    eid, during = queued_execution, {}

    def fake_sandbox(files, entry, stdin="", on_output=None):
        ex = load(db, eid)
        during.update(status=ex.status, started=ex.started_at, finished=ex.finished_at)
        return fake_result(tasks_module)

    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake_sandbox)
    tasks_module.run_code(eid)
    assert during["status"] == ExecutionStatus.RUNNING
    assert during["started"] is not None and during["finished"] is None


@pytest.mark.parametrize("status,code", [("error", 1), ("timeout", None), ("memory_exceeded", 137),
                                         ("output_limit", 137), ("system_error", None)])
def test_every_sandbox_status_is_stored_as_is(tasks_module, db, queued_execution, monkeypatch, status, code) -> None:
    monkeypatch.setattr(tasks_module, "run_in_sandbox",
                        lambda *a, **k: fake_result(tasks_module, status, code, "out"))
    tasks_module.run_code(queued_execution)
    ex = load(db, queued_execution)
    assert ex.status.value == status and ex.exit_code == code and ex.finished_at is not None


def test_a_crashing_sandbox_becomes_system_error_without_leaking_details(
        tasks_module, db, queued_execution, monkeypatch) -> None:
    def boom(*a, **k):
        raise RuntimeError("secret internal detail /var/run/docker.sock")

    monkeypatch.setattr(tasks_module, "run_in_sandbox", boom)
    events = Listener(f"exec:{queued_execution}")
    try:
        tasks_module.run_code(queued_execution)  # must not raise
        got = events.messages()
    finally:
        events.close()
    ex = load(db, queued_execution)
    assert ex.status == ExecutionStatus.SYSTEM_ERROR and ex.finished_at is not None
    assert "secret internal detail" not in ex.output and "docker.sock" not in ex.output
    assert got[-1]["type"] == "done" and got[-1]["status"] == "system_error"


def test_celery_soft_time_limit_is_a_server_problem_not_a_student_timeout(
        tasks_module, db, queued_execution, monkeypatch) -> None:
    def too_slow(*a, **k):
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr(tasks_module, "run_in_sandbox", too_slow)
    tasks_module.run_code(queued_execution)
    ex = load(db, queued_execution)
    assert ex.status == ExecutionStatus.SYSTEM_ERROR and "too busy" in ex.output and ex.finished_at is not None


def test_a_job_is_never_run_twice(tasks_module, db, queued_execution, monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(tasks_module, "run_in_sandbox",
                        lambda *a, **k: calls.append(1) or fake_result(tasks_module, output="first"))
    tasks_module.run_code(queued_execution)
    events = Listener(f"exec:{queued_execution}")
    try:
        tasks_module.run_code(queued_execution)  # e.g. redelivered by the broker after a crash
        assert events.messages() == []
    finally:
        events.close()
    assert len(calls) == 1 and load(db, queued_execution).output == "first"


@pytest.mark.parametrize("state", [ExecutionStatus.RUNNING, ExecutionStatus.SYSTEM_ERROR, ExecutionStatus.OK])
def test_only_queued_executions_are_run(tasks_module, db, queued_execution, monkeypatch, state) -> None:
    ex = load(db, queued_execution)
    ex.status = state
    db.commit()
    monkeypatch.setattr(tasks_module, "run_in_sandbox", lambda *a, **k: pytest.fail("must not run"))
    tasks_module.run_code(queued_execution)
    assert load(db, queued_execution).status == state


def test_unknown_execution_is_ignored(tasks_module, monkeypatch, db) -> None:
    monkeypatch.setattr(tasks_module, "run_in_sandbox", lambda *a, **k: pytest.fail("must not run"))
    tasks_module.run_code(987654321)


def test_task_limits_match_the_spec(tasks_module) -> None:
    t = tasks_module.run_code
    assert (t.acks_late, t.soft_time_limit, t.time_limit) == (True, 12, 15)


# ------------------------------------------------------- beat jobs / heartbeat

def test_orphan_cleanup_uses_a_30_second_age(tasks_module, monkeypatch) -> None:
    seen = []
    monkeypatch.setattr(tasks_module, "reap_orphans", lambda max_age_sec: seen.append(max_age_sec) or 2)
    assert tasks_module.cleanup_orphan_containers() == 2 and seen == [30]


def test_heartbeat_reports_docker_state_to_redis(tasks_module, monkeypatch) -> None:
    from unittest.mock import MagicMock

    r = get_redis()
    r.delete("health:docker")
    good = MagicMock()
    monkeypatch.setattr(tasks_module, "client", good)
    assert tasks_module.docker_heartbeat() == "ok" and r.get("health:docker") == "ok"
    assert 0 < r.ttl("health:docker") <= 45

    bad_daemon = MagicMock()
    bad_daemon.ping.side_effect = ConnectionError("daemon gone")
    monkeypatch.setattr(tasks_module, "client", bad_daemon)
    assert tasks_module.docker_heartbeat() == "down" and r.get("health:docker") == "down"

    no_image = MagicMock()
    no_image.images.get.side_effect = RuntimeError("image not found")
    monkeypatch.setattr(tasks_module, "client", no_image)
    assert tasks_module.docker_heartbeat() == "down"
    r.delete("health:docker")


def test_health_endpoint_shows_the_workers_docker_report(client, tasks_module) -> None:
    r = get_redis()
    r.delete("health:docker")
    assert client.get("/api/v1/health").json()["checks"]["docker"] == "unknown"  # no heartbeat yet: not an outage

    r.set("health:docker", "ok", ex=30)
    assert client.get("/api/v1/health").json()["checks"]["docker"] == "ok"

    r.set("health:docker", "down", ex=30)
    resp = client.get("/api/v1/health")
    assert resp.status_code == 503 and resp.json()["status"] == "degraded"
    r.delete("health:docker")


# ------------------------------------------------------------- deadlock retry

def _mysql_error(code: int):
    import pymysql
    from sqlalchemy.exc import OperationalError

    return OperationalError("UPDATE executions ...", {}, pymysql.err.OperationalError(code, "boom"))


class FakeDb:
    def __init__(self):
        self.commits = self.rollbacks = 0

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_a_deadlock_victim_retries_and_succeeds(tasks_module) -> None:
    db, calls = FakeDb(), []

    def apply():
        calls.append(1)
        if len(calls) < 3:
            raise _mysql_error(1213)  # deadlock on the first two attempts

    tasks_module.commit_with_retry(db, apply)
    assert len(calls) == 3 and db.rollbacks == 2 and db.commits == 1


def test_other_database_errors_are_not_retried_and_retries_are_bounded(tasks_module) -> None:
    from sqlalchemy.exc import OperationalError

    db, calls = FakeDb(), []

    def broken():
        calls.append(1)
        raise _mysql_error(1045)  # access denied: retrying cannot help

    with pytest.raises(OperationalError):
        tasks_module.commit_with_retry(db, broken)
    assert len(calls) == 1

    calls.clear()

    def always_deadlocked():
        calls.append(1)
        raise _mysql_error(1213)

    with pytest.raises(OperationalError):
        tasks_module.commit_with_retry(db, always_deadlocked, attempts=3)
    assert len(calls) == 3
