"""Whole path: API -> task -> real sandbox container -> MySQL + Redis events. The Celery broker hop is the only
thing replaced (the task function is called directly). Needs the Docker socket:
`docker compose exec worker pytest tests/test_run_e2e.py`."""
import time

import pytest

from app.core.redis import get_redis
from app.services import execution_service
from tests.conftest import Listener, approved_student
from tests.test_sandbox import DOCKER_READY, leftover

pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")


@pytest.fixture(autouse=True)
def synchronous_worker(monkeypatch, tasks_module):
    monkeypatch.setattr(execution_service, "enqueue", lambda eid: tasks_module.run_code(eid))
    monkeypatch.setattr(execution_service, "enqueue_practice", lambda eid: tasks_module.run_code(eid))
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    yield
    assert leftover() == []


def put(c, cid, path, content):
    r = c.post(f"/api/v1/workspace/{cid}/files", json={"path": path, "content": content})
    assert r.status_code == 201, r.text


def run(c, cid, entry, stdin=""):
    r = c.post(f"/api/v1/workspace/{cid}/run", json={"mode": "batch", "entry_path": entry, "stdin": stdin})
    assert r.status_code == 202, r.text
    return r.json()["execution_id"]


def result(c, eid):
    return c.get(f"/api/v1/executions/{eid}").json()


def test_student_runs_a_multifile_activity_end_to_end(lab) -> None:
    lab.teacher.post(f"/api/v1/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [
            {"path": "main.py", "content": "import helpers\nprint(helpers.greet(input()))\nprint(open('data.csv').read())"},
            {"path": "helpers.py", "content": "def greet(n): return 'Hello ' + n"},
            {"path": "data.csv", "content": "a,b\n1,2"}]})
    activity_id = lab.teacher.get(f"/api/v1/classes/{lab.cid}/activities").json()["items"][0]["id"]
    lab.teacher.post(f"/api/v1/activities/{activity_id}/publish")
    # the student joined before publishing, so the folder arrived by publish; edit one file like a real student would
    tree = {e["path"]: e for e in lab.student.get(f"/api/v1/workspace/{lab.cid}/tree").json()["entries"]}
    helper = tree["Lab 1/helpers.py"]
    lab.student.put(f"/api/v1/workspace/files/{helper['id']}", json={
        "content": "def greet(n): return 'Hi there, ' + n", "last_updated_at": helper["updated_at"]})

    r = lab.student.post(f"/api/v1/workspace/{lab.cid}/run", json={"mode": "batch", "entry_path": "Lab 1/main.py", "stdin": "Nicole\n"})
    assert r.status_code == 202
    eid = r.json()["execution_id"]

    done = result(lab.student, eid)
    assert done["status"] == "ok" and done["exit_code"] == 0
    assert done["output"] == "Hi there, Nicole\na,b\n1,2\n"  # the student's EDITED helper was used
    assert done["started_at"] and done["finished_at"] and 0 < done["duration_ms"] < 5000


def test_output_events_arrive_in_order_for_a_live_run(lab, monkeypatch, tasks_module) -> None:
    put(lab.student, lab.cid, "slow.py", "import time\nfor i in range(3):\n    print('tick', i, flush=True)\n    time.sleep(0.3)")
    captured = {}

    def run_and_listen(eid: int) -> None:
        listener = Listener(f"exec:{eid}")
        try:
            tasks_module.run_code(eid)
            captured["events"] = listener.messages()
        finally:
            listener.close()

    monkeypatch.setattr(execution_service, "enqueue", run_and_listen)
    eid = run(lab.student, lab.cid, "slow.py")

    events = captured["events"]
    assert events[0] == {"type": "status", "status": "running"}
    assert events[-1]["type"] == "done" and events[-1]["status"] == "ok" and events[-1]["exit_code"] == 0
    streamed = "".join(e["data"] for e in events if e["type"] == "output")
    assert streamed == "tick 0\ntick 1\ntick 2\n" == result(lab.student, eid)["output"]


def test_error_in_student_code_is_reported(lab) -> None:
    put(lab.student, lab.cid, "bad.py", "print('before')\nraise ValueError('boom')")
    done = result(lab.student, run(lab.student, lab.cid, "bad.py"))
    assert done["status"] == "error" and done["exit_code"] == 1
    assert "before" in done["output"] and "ValueError: boom" in done["output"]


def test_infinite_loop_is_stopped_and_the_student_can_run_again(lab) -> None:
    put(lab.student, lab.cid, "loop.py", "while True: pass")
    put(lab.student, lab.cid, "ok.py", "print('fine')")
    started = time.monotonic()
    done = result(lab.student, run(lab.student, lab.cid, "loop.py"))
    assert done["status"] == "timeout" and "time limit" in done["output"]
    assert 10 <= time.monotonic() - started < 12  # inside Celery's 12 s soft limit

    time.sleep(3.1)  # the cooldown, not the finished run, is the only thing in the way now
    assert result(lab.student, run(lab.student, lab.cid, "ok.py"))["output"] == "fine\n"


def test_two_students_run_the_same_path_with_different_code(lab, db) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    put(lab.student, lab.cid, "main.py", "print('I am student one')")
    put(other, lab.cid, "main.py", "print('I am student two')")
    a = result(lab.student, run(lab.student, lab.cid, "main.py"))
    b = result(other, run(other, lab.cid, "main.py"))
    assert a["output"] == "I am student one\n" and b["output"] == "I am student two\n"


def test_unsaved_or_deleted_files_are_not_run(lab) -> None:
    put(lab.student, lab.cid, "main.py", "import gone\nprint(gone.x)")
    put(lab.student, lab.cid, "gone.py", "x = 1")
    tree = {e["path"]: e for e in lab.student.get(f"/api/v1/workspace/{lab.cid}/tree").json()["entries"]}
    lab.student.delete(f"/api/v1/workspace/files/{tree['gone.py']['id']}")
    done = result(lab.student, run(lab.student, lab.cid, "main.py"))
    assert done["status"] == "error" and "ModuleNotFoundError" in done["output"]


# ------------------------------------------------------------- practice runs

def test_a_practice_run_executes_in_the_real_sandbox(db) -> None:
    from app.models.user import Role
    from tests.conftest import login_as

    solo = login_as(db, Role.STUDENT, "solo")  # not enrolled anywhere, no lab session exists
    solo.post("/api/v1/practice/files", json={"path": "main.py", "content": "import helper\nprint(helper.hi(input()))"})
    solo.post("/api/v1/practice/files", json={"path": "helper.py", "content": "def hi(n): return 'Hi ' + n"})

    r = solo.post("/api/v1/practice/run", json={"mode": "batch", "entry_path": "main.py", "stdin": "Nicole\n"})
    assert r.status_code == 202, r.text
    done = solo.get(f"/api/v1/executions/{r.json()['execution_id']}").json()
    assert done["status"] == "ok" and done["output"] == "Hi Nicole\n" and done["practice"] is True
    assert done["class_id"] is None and done["started_at"] and done["finished_at"]


def test_practice_runs_have_exactly_the_same_sandbox_limits(db) -> None:
    from app.models.user import Role
    from tests.conftest import login_as

    solo = login_as(db, Role.STUDENT, "solo")
    cases = {
        "mem.py": ("a = []\nwhile True: a.append(' ' * 10_000_000)", "memory_exceeded"),
        "flood.py": ("while True: print('spam' * 20)", "output_limit"),
        "net.py": ("import socket\nsocket.create_connection(('8.8.8.8', 53), timeout=2)", "error"),
        "ro.py": ("open('/opt/runner/boot.py', 'w').write('x')", "error"),
    }
    for name, (code, _) in cases.items():
        solo.post("/api/v1/practice/files", json={"path": name, "content": code})
    for name, (_, expected) in cases.items():
        time.sleep(3.1)  # the per-student 3 s cooldown applies to practice too
        r = solo.post("/api/v1/practice/run", json={"mode": "batch", "entry_path": name})
        assert r.status_code == 202, r.text
        assert solo.get(f"/api/v1/executions/{r.json()['execution_id']}").json()["status"] == expected, name
