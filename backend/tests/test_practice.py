"""The personal Practice workspace: /practice/* (files, versions, run)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.redis import get_redis
from app.models.activity_log import ActivityLog
from app.models.execution import Execution, ExecutionStatus
from app.models.user import Role, User
from app.models.workspace import Workspace
from app.services import execution_service
from tests.conftest import Listener, approved_student, login_as, new_class, new_code, new_session
from tests.test_realtime import closed_with, recv

API = "/api/v1"
P = f"{API}/practice"
KB = 1024


# ---------------------------------------------------------------- helpers

def pmk(c: TestClient, path: str, content: str = "", folder: bool = False):
    return c.post(f"{P}/files", json={"path": path, "content": content, "is_folder": folder})


def ptree(c: TestClient) -> dict:
    r = c.get(f"{P}/tree")
    assert r.status_code == 200, r.text
    return r.json()


def ppaths(c: TestClient) -> set[str]:
    return {e["path"] for e in ptree(c)["entries"]}


def pentry(c: TestClient, path: str) -> dict:
    return next(e for e in ptree(c)["entries"] if e["path"] == path)


def psave(c: TestClient, fid: int, content: str, token: str, version: bool = False):
    return c.put(f"{P}/files/{fid}", params={"version": version}, json={"content": content, "last_updated_at": token})


def prun(c: TestClient, entry: str = "main.py", stdin: str = ""):
    return c.post(f"{P}/run", json={"mode": "batch", "entry_path": entry, "stdin": stdin})


def lab_run(c: TestClient, cid: int, entry: str = "main.py"):
    return c.post(f"{API}/workspace/{cid}/run", json={"mode": "batch", "entry_path": entry})


def uid(c: TestClient) -> int:
    return c.get(f"{API}/auth/me").json()["id"]


def reset_cooldown(c: TestClient) -> None:
    get_redis().delete(execution_service.cooldown_key(uid(c)))


@pytest.fixture(autouse=True)
def fresh_cooldowns():
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    yield


@pytest.fixture()
def sent(monkeypatch) -> list[tuple[int, str]]:
    """Records every job handed to Celery as (execution_id, queue) instead of sending it."""
    jobs: list[tuple[int, str]] = []
    monkeypatch.setattr(execution_service, "_send", lambda eid, queue: jobs.append((eid, queue)))
    return jobs


@pytest.fixture()
def solo(db: Session) -> TestClient:
    """A student who is not enrolled in any class."""
    return login_as(db, Role.STUDENT, "solo")


def finish(db: Session, eid: int, status: ExecutionStatus = ExecutionStatus.OK) -> None:
    db.expire_all()
    ex = db.get(Execution, eid)
    ex.status, ex.finished_at = status, utcnow()
    db.commit()


def practice_workspaces(db: Session, username: str) -> list[Workspace]:
    db.expire_all()
    user = db.scalars(select(User).where(User.username == username)).one()
    return list(db.scalars(select(Workspace).where(Workspace.student_id == user.id, Workspace.class_id.is_(None))))


# ================================================== created on first access

def test_workspace_is_created_on_first_access_and_reused(solo: TestClient, db: Session) -> None:
    assert practice_workspaces(db, "solo") == []
    first = ptree(solo)
    assert first["entries"] == [] and first["class_id"] is None
    assert first["usage"]["max_bytes"] == 2 * 1024 * KB and first["usage"]["max_files"] == 100

    ws = practice_workspaces(db, "solo")
    assert len(ws) == 1 and ws[0].class_id is None
    assert ptree(solo)["workspace_id"] == first["workspace_id"] == ws[0].id
    assert len(practice_workspaces(db, "solo")) == 1


def test_any_first_action_creates_it(solo: TestClient, db: Session) -> None:
    assert pmk(solo, "hello.py", "print(1)").status_code == 201  # no tree call before
    assert len(practice_workspaces(db, "solo")) == 1


def test_every_student_gets_their_own(db: Session) -> None:
    a, b = login_as(db, Role.STUDENT, "alice"), login_as(db, Role.STUDENT, "bob")
    pmk(a, "a.py")
    assert ppaths(b) == set() and ptree(a)["workspace_id"] != ptree(b)["workspace_id"]


def test_parallel_first_requests_still_make_exactly_one_workspace(solo: TestClient, db: Session) -> None:
    """MySQL lets a unique key hold many NULLs, so the service has to enforce 'one per student'."""
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda i: solo.get(f"{P}/tree"), range(8)))
    assert all(r.status_code == 200 for r in results)
    assert len(practice_workspaces(db, "solo")) == 1
    assert len({r.json()["workspace_id"] for r in results}) == 1


def test_parallel_first_creates_do_not_duplicate_it_either(solo: TestClient, db: Session) -> None:
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: pmk(solo, f"f{i}.py"), range(6)))
    assert [r.status_code for r in results] == [201] * 6
    assert len(practice_workspaces(db, "solo")) == 1 and len(ppaths(solo)) == 6


def test_it_needs_no_enrolment_and_is_separate_from_class_workspaces(lab) -> None:
    pmk(lab.student, "mine.py", "practice")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "class.py", "content": "class"})
    assert ppaths(lab.student) == {"mine.py"}
    class_tree = lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()
    assert {e["path"] for e in class_tree["entries"]} == {"class.py"}
    assert class_tree["workspace_id"] != ptree(lab.student)["workspace_id"]


# ============================================================ file CRUD

def test_create_read_folder_nested_and_tree(solo: TestClient) -> None:
    r = pmk(solo, "hello.py", "print('hi')")
    assert r.status_code == 201
    body = r.json()
    assert body["content"] == "print('hi')" and body["size_bytes"] == 11 and body["updated_at"].endswith("Z")
    assert solo.get(f"{P}/files/{body['id']}").json()["content"] == "print('hi')"

    assert pmk(solo, "data", folder=True).status_code == 201
    assert pmk(solo, "a/b/c.py", "x").status_code == 201  # missing parents are created
    assert ppaths(solo) == {"hello.py", "data", "a", "a/b", "a/b/c.py"}
    assert all("content" not in e for e in ptree(solo)["entries"])
    assert pmk(solo, "HELLO.PY").json()["code"] == "PATH_EXISTS"


def test_save_conflict_and_versions(solo: TestClient) -> None:
    f = pmk(solo, "a.py", "v0").json()
    t1 = psave(solo, f["id"], "autosave", f["updated_at"]).json()["updated_at"]
    assert solo.get(f"{P}/files/{f['id']}/versions").json()["total"] == 0  # autosave keeps no version

    stale = psave(solo, f["id"], "from another tab", f["updated_at"])
    assert stale.status_code == 409 and stale.json()["code"] == "SAVE_CONFLICT"

    token = t1
    for i in range(25):
        token = psave(solo, f["id"], f"manual {i}", token, version=True).json()["updated_at"]
    page = solo.get(f"{P}/files/{f['id']}/versions", params={"size": 100}).json()
    assert page["total"] == 20  # pruned to the last 20
    newest = solo.get(f"{P}/versions/{page['items'][0]['id']}").json()
    assert newest["content"] == "manual 24" and newest["file_id"] == f["id"]
    assert solo.get(f"{P}/versions/99999").json()["code"] == "VERSION_NOT_FOUND"


def test_rename_and_delete_folders(solo: TestClient) -> None:
    pmk(solo, "lab/a.py", "a")
    pmk(solo, "lab/deep/b.py", "b")
    pmk(solo, "lab2/keep.py", "k")
    child = pentry(solo, "lab/a.py")
    folder = pentry(solo, "lab")

    r = solo.patch(f"{P}/files/{folder['id']}", json={"new_path": "homework"})
    assert r.status_code == 200 and r.json()["path"] == "homework"
    assert ppaths(solo) == {"homework", "homework/a.py", "homework/deep", "homework/deep/b.py", "lab2", "lab2/keep.py"}
    assert pentry(solo, "homework/a.py")["updated_at"] == child["updated_at"]  # the editor's save token survives
    assert solo.patch(f"{P}/files/{folder['id']}", json={"new_path": "homework/inner"}).json()["code"] == "INVALID_MOVE"

    assert solo.delete(f"{P}/files/{pentry(solo, 'homework')['id']}").status_code == 204
    assert ppaths(solo) == {"lab2", "lab2/keep.py"}


# ================================================= same rules and quotas

@pytest.mark.parametrize("path", ["../x.py", "/etc/x.py", "a\\b.py", "a//b.py", ".hidden.py", "./x.py", "a/"])
def test_same_path_rules(solo: TestClient, path: str) -> None:
    r = pmk(solo, path)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATH"
    assert ppaths(solo) == set()
    f = pmk(solo, "ok.py").json()
    assert solo.patch(f"{P}/files/{f['id']}", json={"new_path": path}).json()["code"] == "INVALID_PATH"


@pytest.mark.parametrize("path", ["run.exe", "noext", "a.sh", "x.py.exe"])
def test_same_extension_rules(solo: TestClient, path: str) -> None:
    assert pmk(solo, path).json()["code"] == "INVALID_EXTENSION"
    for ok in ("a.py", "a.txt", "a.csv", "a.json", "a.md"):
        assert pmk(solo, ok).status_code == 201


def test_same_size_limits(solo: TestClient) -> None:
    assert pmk(solo, "ok.py", "x" * (100 * KB)).status_code == 201
    r = pmk(solo, "big.py", "x" * (100 * KB + 1))
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"
    assert pmk(solo, "uni.py", "é" * 60000).json()["code"] == "FILE_TOO_LARGE"  # counted in bytes


def test_same_2mb_quota(solo: TestClient) -> None:
    chunk = "x" * (100 * KB)
    for i in range(20):
        assert pmk(solo, f"f{i:02d}.txt", chunk).status_code == 201
    r = pmk(solo, "more.txt", chunk)
    assert r.status_code == 413 and r.json()["code"] == "QUOTA_EXCEEDED"
    small = pmk(solo, "small.txt", "x" * 40 * KB).json()
    assert psave(solo, small["id"], chunk, small["updated_at"]).json()["code"] == "QUOTA_EXCEEDED"


def test_same_file_and_folder_limits(solo: TestClient) -> None:
    for i in range(100):
        assert pmk(solo, f"f{i:03d}.txt").status_code == 201
    assert pmk(solo, "f100.txt").json()["code"] == "TOO_MANY_FILES"
    for i in range(100):
        assert pmk(solo, f"d{i:03d}", folder=True).status_code == 201
    assert pmk(solo, "d100", folder=True).json()["code"] == "TOO_MANY_FILES"


# =============================== never locked by lab sessions (the key rule)

def test_closed_lab_does_not_block_practice_but_still_blocks_the_class_workspace(lab) -> None:
    f = pmk(lab.student, "p.py", "v1").json()
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")

    # the class workspace is locked ...
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "c.py"})
    assert r.status_code == 403 and r.json()["code"] == "LAB_CLOSED"
    # ... practice is not: create, save (with version), rename, delete all work
    assert pmk(lab.student, "q.py", "x").status_code == 201
    t = psave(lab.student, f["id"], "v2", f["updated_at"], version=True)
    assert t.status_code == 200
    assert lab.student.patch(f"{P}/files/{f['id']}", json={"new_path": "renamed.py"}).status_code == 200
    assert lab.student.delete(f"{P}/files/{f['id']}").status_code == 204
    assert ppaths(lab.student) == {"q.py"}


def test_practice_works_with_no_lab_session_ever(solo: TestClient, sent) -> None:
    assert pmk(solo, "main.py", "print(1)").status_code == 201
    assert prun(solo).status_code == 202


def test_practice_run_is_not_blocked_by_a_closed_lab(lab, sent) -> None:
    pmk(lab.student, "main.py", "print(1)")
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    assert prun(lab.student).status_code == 202
    reset_cooldown(lab.student)
    r = lab_run(lab.student, lab.cid)  # the same student's LAB run is refused
    assert r.status_code == 403 and r.json()["code"] == "LAB_CLOSED"


# ==================== no submit, no monitor events, invisible to instructors

def test_practice_files_are_never_part_of_a_submission(lab) -> None:
    a = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [{"path": "main.py", "content": "CLASS VERSION"}]}).json()
    lab.teacher.post(f"{API}/activities/{a['id']}/publish")
    pmk(lab.student, "Lab 1/main.py", "PRACTICE VERSION")  # same path, in the practice workspace
    pmk(lab.student, "Lab 1/extra.py", "only in practice")

    sub = lab.student.post(f"{API}/activities/{a['id']}/submit").json()
    files = lab.student.get(f"{API}/submissions/{sub['id']}").json()["files"]
    assert files == [{"path": "Lab 1/main.py", "content": "CLASS VERSION"}]


def test_there_is_no_submit_endpoint_for_practice(solo: TestClient) -> None:
    f = pmk(solo, "a.py").json()
    for path in ("/practice/submit", f"/practice/files/{f['id']}/submit"):
        assert solo.post(f"{API}{path}").status_code in (404, 405)


def test_practice_activity_is_invisible_to_the_monitor(lab, sent) -> None:
    events = Listener(f"monitor:{lab.session_id}")
    try:
        f = pmk(lab.student, "p.py", "1").json()
        tok = psave(lab.student, f["id"], "2", f["updated_at"], version=True).json()["updated_at"]
        lab.student.patch(f"{P}/files/{f['id']}", json={"new_path": "q.py"})
        assert prun(lab.student, "q.py").status_code == 202
        lab.student.delete(f"{P}/files/{f['id']}")
        assert events.messages() == []                      # nothing about practice reaches the instructor

        # control: the same kind of action in the CLASS workspace does reach the monitor
        c = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "c.py", "content": "1"}).json()
        lab.student.put(f"{API}/workspace/files/{c['id']}", json={"content": "2", "last_updated_at": c["updated_at"]})
        assert [e["type"] for e in events.messages()] == ["saved"]
    finally:
        events.close()


def test_practice_does_not_show_in_the_monitor_snapshot(lab, db: Session, sent) -> None:
    f = pmk(lab.student, "p.py", "1").json()
    import time
    time.sleep(1.1)
    psave(lab.student, f["id"], "2", f["updated_at"])
    prun(lab.student, "p.py")
    row = lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()["students"][0]
    assert row["last_save"] is None and row["last_run"] is None and row["submitted"] is False


def test_instructors_cannot_see_students_practice_and_admins_have_none(lab, db: Session) -> None:
    f = pmk(lab.student, "secret.py", "my private practice").json()
    sid = uid(lab.student)

    tree = lab.teacher.get(f"{API}/classes/{lab.cid}/students/{sid}/workspace").json()
    assert all(e["path"] != "secret.py" for e in tree["entries"])
    r = lab.teacher.get(f"{API}/classes/{lab.cid}/students/{sid}/workspace/files/{f['id']}")
    assert r.status_code == 404 and r.json()["code"] == "FILE_NOT_FOUND"

    # an instructor has a Practice workspace of their OWN (see test_practice_instructor.py), but a student's file id
    # looks like it does not exist to them
    assert lab.teacher.get(f"{P}/files/{f['id']}").status_code == 404
    assert "secret.py" not in ppaths(lab.teacher)

    admin = login_as(db, Role.ADMIN, "root")  # admins have no Practice workspace
    assert admin.get(f"{P}/tree").status_code == 403
    assert pmk(admin, "x.py").status_code == 403
    assert admin.get(f"{P}/files/{f['id']}").status_code == 403
    assert prun(admin).status_code == 403
    assert TestClient(lab.student.app).get(f"{P}/tree").status_code == 401


# ============================================================ isolation

def test_another_student_cannot_touch_someones_practice_workspace(lab, db: Session) -> None:
    f = pmk(lab.student, "secret.py", "mine").json()
    psave(lab.student, f["id"], "mine v2", f["updated_at"], version=True)
    vid = lab.student.get(f"{P}/files/{f['id']}/versions").json()["items"][0]["id"]
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    stranger = login_as(db, Role.STUDENT, "stranger")

    for c in (other, stranger):
        assert c.get(f"{P}/files/{f['id']}").status_code == 404
        assert psave(c, f["id"], "pwned", f["updated_at"]).status_code == 404
        assert c.patch(f"{P}/files/{f['id']}", json={"new_path": "x.py"}).status_code == 404
        assert c.delete(f"{P}/files/{f['id']}").status_code == 404
        assert c.get(f"{P}/files/{f['id']}/versions").status_code == 404
        assert c.get(f"{P}/versions/{vid}").status_code == 404
        assert ppaths(c) == set()
    assert lab.student.get(f"{P}/files/{f['id']}").json()["content"] == "mine v2"


def test_the_two_kinds_of_workspace_never_mix(lab) -> None:
    p = pmk(lab.student, "p.py", "practice").json()
    c = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "c.py", "content": "class"}).json()

    # a practice file through the class endpoints, and a class file through the practice endpoints: not found
    assert lab.student.get(f"{API}/workspace/files/{p['id']}").status_code == 404
    assert lab.student.put(f"{API}/workspace/files/{p['id']}", json={"content": "x", "last_updated_at": p["updated_at"]}).status_code == 404
    assert lab.student.delete(f"{API}/workspace/files/{p['id']}").status_code == 404
    assert lab.student.get(f"{P}/files/{c['id']}").status_code == 404
    assert psave(lab.student, c["id"], "x", c["updated_at"]).status_code == 404
    assert lab.student.delete(f"{P}/files/{c['id']}").status_code == 404
    assert lab.student.get(f"{API}/workspace/files/{c['id']}").json()["content"] == "class"  # untouched


# ===================================================================== run

def test_practice_run_goes_to_the_practice_queue_and_lab_run_to_the_lab_queue(lab, db: Session, sent) -> None:
    pmk(lab.student, "main.py", "print(1)")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "main.py", "content": "print(2)"})

    p = prun(lab.student)
    assert p.status_code == 202 and p.json()["queue_position"] == 1
    finish(db, p.json()["execution_id"])  # the student is free again ...
    reset_cooldown(lab.student)           # ... and past the 3 s cooldown
    l = lab_run(lab.student, lab.cid)
    assert l.status_code == 202
    assert sent == [(p.json()["execution_id"], "practice"), (l.json()["execution_id"], "celery")]


def test_celery_is_told_which_queue(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(execution_service.celery_app, "send_task",
                        lambda name, args=None, queue=None, retry=None: calls.append((name, args, queue, retry)))
    execution_service.enqueue_practice(7)
    execution_service.enqueue(8)
    assert calls == [("app.worker.tasks.run_code", [7], "practice", False),
                     ("app.worker.tasks.run_code", [8], "celery", False)]


def test_practice_execution_row_and_read_back(lab, db: Session, sent) -> None:
    pmk(lab.student, "main.py", "print(1)")
    r = prun(lab.student, stdin="in\n")
    eid = r.json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, eid)
    assert ex.status == ExecutionStatus.QUEUED and ex.stdin == "in\n" and ex.entry_path == "main.py"
    assert ex.lab_session_id is None and ex.activity_id is None  # tied to no lab and no activity
    assert db.get(Workspace, ex.workspace_id).class_id is None

    body = lab.student.get(f"{API}/executions/{eid}").json()
    assert body["practice"] is True and body["class_id"] is None and body["status"] == "queued"


def test_lab_executions_are_not_marked_practice(lab, sent) -> None:
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "main.py", "content": "1"})
    eid = lab_run(lab.student, lab.cid).json()["execution_id"]
    body = lab.student.get(f"{API}/executions/{eid}").json()
    assert body["practice"] is False and body["class_id"] == lab.cid


@pytest.mark.parametrize("entry,code", [
    ("../main.py", "INVALID_PATH"), ("/etc/x.py", "INVALID_PATH"), ("notes.txt", "INVALID_ENTRY"),
    ("missing.py", "ENTRY_NOT_FOUND"), ("dir.py", "ENTRY_NOT_FOUND"),
])
def test_entry_validation(solo: TestClient, sent, entry: str, code: str) -> None:
    pmk(solo, "main.py")
    pmk(solo, "notes.txt", "x")
    pmk(solo, "dir.py", folder=True)
    assert prun(solo, entry).json()["code"] == code
    assert sent == [] and prun(solo, "main.py").status_code == 202  # failed attempts did not burn the cooldown


def test_a_run_only_sees_its_own_kind_of_workspace(lab, sent) -> None:
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "class_only.py", "content": "1"})
    pmk(lab.student, "practice_only.py", "1")
    assert prun(lab.student, "class_only.py").json()["code"] == "ENTRY_NOT_FOUND"
    assert lab_run(lab.student, lab.cid, "practice_only.py").json()["code"] == "ENTRY_NOT_FOUND"


def test_practice_run_needs_no_class_membership(solo: TestClient, sent) -> None:
    pmk(solo, "main.py")
    assert prun(solo).status_code == 202


def test_stdin_limit_is_the_same(solo: TestClient, db: Session, sent) -> None:
    pmk(solo, "main.py")
    assert prun(solo, stdin="x" * 10_001).status_code == 422
    worst = "\U0001F600" * 10_000
    r = prun(solo, stdin=worst)
    assert r.status_code == 202
    db.expire_all()
    assert db.get(Execution, r.json()["execution_id"]).stdin == worst


# ---------------------------------------------------- per-student limits

def test_one_active_run_at_a_time(solo: TestClient, db: Session, sent) -> None:
    pmk(solo, "main.py")
    first = prun(solo).json()["execution_id"]
    reset_cooldown(solo)
    r = prun(solo)
    assert r.status_code == 429 and r.json()["code"] == "RUN_IN_PROGRESS"
    finish(db, first)
    reset_cooldown(solo)
    assert prun(solo).status_code == 202


def test_three_second_cooldown(solo: TestClient, db: Session, sent) -> None:
    import time
    pmk(solo, "main.py")
    finish(db, prun(solo).json()["execution_id"])
    r = prun(solo)
    assert r.status_code == 429 and r.json()["code"] == "RUN_TOO_FAST"
    assert 0 < get_redis().ttl(execution_service.cooldown_key(uid(solo))) <= 3
    time.sleep(3.2)  # the Redis key expires by itself
    deadline = time.monotonic() + 3  # (a step back of the Docker VM clock delays Redis's expiry)
    while (r := prun(solo)).status_code == 429 and time.monotonic() < deadline:
        time.sleep(0.25)
    assert r.status_code == 202


def test_one_active_run_is_shared_between_practice_and_lab(lab, db: Session, sent) -> None:
    pmk(lab.student, "main.py")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "main.py", "content": "1"})

    first = prun(lab.student).json()["execution_id"]  # a practice run is active ...
    reset_cooldown(lab.student)
    assert lab_run(lab.student, lab.cid).json()["code"] == "RUN_IN_PROGRESS"  # ... so a lab run must wait
    finish(db, first)

    reset_cooldown(lab.student)
    second = lab_run(lab.student, lab.cid).json()["execution_id"]  # and the other way round
    reset_cooldown(lab.student)
    assert prun(lab.student).json()["code"] == "RUN_IN_PROGRESS"
    finish(db, second)


def test_the_three_second_cooldown_is_shared_between_practice_and_lab(lab, db: Session, sent) -> None:
    pmk(lab.student, "main.py")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "main.py", "content": "1"})
    finish(db, lab_run(lab.student, lab.cid).json()["execution_id"])
    r = prun(lab.student)  # nothing is running, but a lab run started less than 3 s ago
    assert r.status_code == 429 and r.json()["code"] == "RUN_TOO_FAST"


def test_lost_practice_runs_stop_blocking_the_student(solo: TestClient, db: Session, sent) -> None:
    pmk(solo, "main.py")
    lost = prun(solo).json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, lost)
    ex.status, ex.queued_at = ExecutionStatus.RUNNING, utcnow() - timedelta(seconds=61)
    db.commit()
    reset_cooldown(solo)
    assert prun(solo).status_code == 202
    db.expire_all()
    assert db.get(Execution, lost).status == ExecutionStatus.SYSTEM_ERROR


def test_each_queue_has_its_own_busy_limit(lab, db: Session, sent, monkeypatch) -> None:
    pmk(lab.student, "main.py")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "main.py", "content": "1"})
    depth = {"celery": 0, "practice": 0}
    monkeypatch.setattr(execution_service, "queue_length", lambda queue=None: depth[queue or "celery"])

    depth["practice"] = 51  # practice backed up: only practice is refused (limit 50)
    r = prun(lab.student)
    assert r.status_code == 503 and r.json() == {"detail": "Server busy, try again", "code": "SERVER_BUSY"}
    reset_cooldown(lab.student)
    assert lab_run(lab.student, lab.cid).status_code == 202  # the lab is unaffected

    finish(db, sent[-1][0])
    depth.update(celery=151, practice=50)  # lab backed up: only the lab is refused (limit 150); 50 is still fine
    reset_cooldown(lab.student)
    assert lab_run(lab.student, lab.cid).status_code == 503
    reset_cooldown(lab.student)
    assert prun(lab.student).status_code == 202


def test_practice_position_counts_only_the_practice_queue(solo: TestClient, sent, monkeypatch) -> None:
    pmk(solo, "main.py")
    monkeypatch.setattr(execution_service, "queue_length", lambda queue=None: 4 if queue == "practice" else 99)
    assert prun(solo).json()["queue_position"] == 5


def test_if_celery_is_down_a_practice_run_fails_cleanly(solo: TestClient, db: Session, monkeypatch) -> None:
    pmk(solo, "main.py")

    def broken(_: int) -> None:
        raise ConnectionError("broker down")

    monkeypatch.setattr(execution_service, "enqueue_practice", broken)
    r = prun(solo)
    assert r.status_code == 503 and r.json()["code"] == "SERVER_BUSY"
    db.expire_all()
    assert db.scalars(select(Execution)).one().status == ExecutionStatus.SYSTEM_ERROR
    monkeypatch.setattr(execution_service, "enqueue_practice", lambda _: None)
    reset_cooldown(solo)
    assert prun(solo).status_code == 202


def test_a_practice_run_is_audited_without_code(solo: TestClient, db: Session, sent) -> None:
    pmk(solo, "main.py", "SECRET_PRACTICE_CODE = 1")
    prun(solo, stdin="private stdin")
    db.expire_all()
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "run")).one()
    assert log.details["practice"] is True and log.details["entry"] == "main.py" and "class_id" not in log.details
    assert "SECRET_PRACTICE_CODE" not in str(log.details) and "private stdin" not in str(log.details)


# ---------------------------------------- the worker side and live output

def test_worker_runs_a_practice_job_without_touching_the_monitor(lab, tasks_module, sent, monkeypatch, db: Session) -> None:
    pmk(lab.student, "main.py", "print('hi')")
    eid = prun(lab.student).json()["execution_id"]
    monkeypatch.setattr(tasks_module, "run_in_sandbox",
                        lambda files, entry, stdin="", on_output=None: tasks_module.RunResult("ok", 0, "hi\n", 55))
    monitor = Listener(f"monitor:{lab.session_id}")
    try:
        tasks_module.run_code(eid)  # what the practice worker does
        assert monitor.messages() == []
    finally:
        monitor.close()
    done = lab.student.get(f"{API}/executions/{eid}").json()
    assert done["status"] == "ok" and done["output"] == "hi\n" and done["practice"] is True


def test_practice_output_streams_over_the_run_websocket(solo: TestClient, tasks_module, sent, monkeypatch) -> None:
    pmk(solo, "main.py", "print('hi')")
    eid = prun(solo).json()["execution_id"]

    def fake(files, entry, stdin="", on_output=None):
        on_output("hello\n")
        return tasks_module.RunResult("ok", 0, "hello\n", 9)

    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake)
    with solo.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        assert recv(ws) == {"type": "status", "status": "queued"}
        tasks_module.run_code(eid)
        assert [recv(ws) for _ in range(3)] == [
            {"type": "status", "status": "running"},
            {"type": "output", "data": "hello\n"},
            {"type": "done", "status": "ok", "exit_code": 0, "duration_ms": 9}]
        assert closed_with(ws) == 1000


def test_nobody_else_can_watch_a_practice_run(lab, db: Session, sent) -> None:
    pmk(lab.student, "main.py")
    eid = prun(lab.student).json()["execution_id"]
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    assert other.get(f"{API}/executions/{eid}").status_code == 404
    assert lab.teacher.get(f"{API}/executions/{eid}").status_code == 404  # not theirs: looks nonexistent
    with other.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        assert recv(ws)["code"] == "EXECUTION_NOT_FOUND"
