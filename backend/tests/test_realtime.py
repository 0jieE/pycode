"""Phase 7: the three WebSockets, presence, monitor events and the monitor snapshot."""
import threading
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.api.v1 import ws as ws_module
from app.core.database import utcnow
from app.core.redis import get_redis
from app.models.execution import Execution, ExecutionStatus
from app.models.user import Role, User
from app.services import execution_service, monitor_service
from tests.conftest import Listener, approved_student, login, login_as, new_class, new_code, new_session

API = "/api/v1"


# ---------------------------------------------------------------- helpers

def recv(ws, timeout: float = 5.0):
    """receive_json() with a deadline, so a missing message fails the test instead of hanging it."""
    box: list = []

    def target() -> None:
        try:
            box.append(ws.receive_json())
        except BaseException as exc:  # noqa: BLE001 - handed back to the test thread
            box.append(exc)

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(timeout)
    if not box:
        pytest.fail(f"no WebSocket message within {timeout}s")
    if isinstance(box[0], BaseException):
        raise box[0]
    return box[0]


def recv_until(ws, event_type: str, limit: int = 12, timeout: float = 5.0) -> dict:
    """Skips other events until one of the wanted type arrives."""
    for _ in range(limit):
        event = recv(ws, timeout)
        if event["type"] == event_type:
            return event
    pytest.fail(f"never received a '{event_type}' event")


def closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as exc:
        recv(ws)
    return exc.value.code


def refused(client: TestClient, path: str) -> tuple[dict, int]:
    """Connects to a socket that should refuse us. Returns (the error event, the close code)."""
    with client.websocket_connect(path) as ws:
        event = recv(ws)
        return event, closed_with(ws)


def silent(ws, seconds: float = 0.6) -> bool:
    box: list = []

    def target() -> None:
        try:
            box.append(ws.receive_json())
        except BaseException:  # noqa: BLE001 - the socket closing at the end of the test is fine
            pass

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    return not box


@pytest.fixture(autouse=True)
def clean_presence():
    for key in list(get_redis().scan_iter("online:*")) + list(get_redis().scan_iter("run:cooldown:*")):
        get_redis().delete(key)
    yield


@pytest.fixture()
def queued(monkeypatch) -> list[int]:
    ids: list[int] = []
    monkeypatch.setattr(execution_service, "enqueue", ids.append)
    return ids


def put_file(c: TestClient, cid: int, path: str, content: str = "print('hi')") -> dict:
    r = c.post(f"{API}/workspace/{cid}/files", json={"path": path, "content": content})
    assert r.status_code == 201, r.text
    return r.json()


def start_run(c: TestClient, cid: int, entry: str = "main.py") -> int:
    r = c.post(f"{API}/workspace/{cid}/run", json={"mode": "batch", "entry_path": entry})
    assert r.status_code == 202, r.text
    return r.json()["execution_id"]


def uid(c: TestClient) -> int:
    return c.get(f"{API}/auth/me").json()["id"]


# ================================================================== /ws/run

def test_run_output_streams_live_and_ends_with_done(lab, tasks_module, queued, monkeypatch, db: Session) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = start_run(lab.student, lab.cid)
    monitor_events = Listener(f"monitor:{lab.session_id}")

    def fake_sandbox(files, entry, stdin="", on_output=None):
        on_output("hello ")
        on_output("world\n")
        return tasks_module.RunResult("ok", 0, "hello world\n", 321)

    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake_sandbox)
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            assert recv(ws) == {"type": "status", "status": "queued"}  # subscribed from here on
            tasks_module.run_code(eid)  # what the Celery worker does
            assert [recv(ws) for _ in range(4)] == [
                {"type": "status", "status": "running"},
                {"type": "output", "data": "hello "},
                {"type": "output", "data": "world\n"},
                {"type": "done", "status": "ok", "exit_code": 0, "duration_ms": 321},
            ]
            assert closed_with(ws) == 1000  # the server ends the stream after `done`

        done = [e for e in monitor_events.messages() if e["type"] == "run_done"]
        assert done and done[0]["status"] == "ok" and done[0]["duration_ms"] == 321
        assert done[0]["execution_id"] == eid and done[0]["student"] == "Test User"
    finally:
        monitor_events.close()


@pytest.mark.parametrize("status,code", [("ok", 0), ("error", 1), ("timeout", None), ("output_limit", 137)])
def test_a_finished_run_is_replayed_immediately(lab, tasks_module, queued, monkeypatch, status, code) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = start_run(lab.student, lab.cid)
    monkeypatch.setattr(tasks_module, "run_in_sandbox",
                        lambda *a, **k: tasks_module.RunResult(status, code, "stored output\n", 77))
    tasks_module.run_code(eid)

    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:  # connects AFTER it finished
        assert recv(ws) == {"type": "output", "data": "stored output\n"}
        assert recv(ws) == {"type": "done", "status": status, "exit_code": code, "duration_ms": 77}
        assert closed_with(ws) == 1000


def test_finished_run_with_no_output_sends_only_done(lab, tasks_module, queued, monkeypatch) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = start_run(lab.student, lab.cid)
    monkeypatch.setattr(tasks_module, "run_in_sandbox", lambda *a, **k: tasks_module.RunResult("ok", 0, "", 5))
    tasks_module.run_code(eid)
    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        assert recv(ws)["type"] == "done"


def test_a_missed_done_event_is_recovered_from_the_database(lab, db: Session, queued, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "RUN_POLL_SECONDS", 0.3)
    put_file(lab.student, lab.cid, "main.py")
    eid = start_run(lab.student, lab.cid)
    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        assert recv(ws)["status"] == "queued"
        db.expire_all()  # the worker finishes but its events never reach us
        ex = db.get(Execution, eid)
        ex.status, ex.output, ex.exit_code, ex.duration_ms = ExecutionStatus.OK, "full output\n", 0, 9
        ex.finished_at = utcnow()
        db.commit()
        assert recv(ws, timeout=6) == {"type": "done", "status": "ok", "exit_code": 0, "duration_ms": 9,
                                       "output": "full output\n"}


def test_only_the_owner_may_watch_a_run(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    eid = start_run(lab.student, lab.cid)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")

    for client in (other, lab.teacher):
        event, code = refused(client, f"{API}/ws/run/{eid}")
        assert event["code"] == "EXECUTION_NOT_FOUND" and code == 4404
    assert refused(lab.student, f"{API}/ws/run/99999")[1] == 4404
    event, code = refused(TestClient(lab.student.app), f"{API}/ws/run/{eid}")
    assert event["code"] == "NOT_AUTHENTICATED" and code == 4401


# ================================================================ /ws/class

def test_students_receive_class_events(lab, db: Session) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as a, \
            other.websocket_connect(f"{API}/ws/class/{lab.cid}") as b, \
            lab.teacher.websocket_connect(f"{API}/ws/class/{lab.cid}") as t:
        for ws in (a, b, t):
            assert recv(ws) == {"type": "connected"}

        lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
        for ws in (a, b, t):
            assert recv_until(ws, "session_closed") == {"type": "session_closed"}

        lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open")
        for ws in (a, b):
            assert recv_until(ws, "session_opened") == {"type": "session_opened"}

        activity = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={"title": "Lab 7"}).json()
        lab.teacher.post(f"{API}/activities/{activity['id']}/publish")
        for ws in (a, b):
            event = recv_until(ws, "activity_published")
            assert event == {"type": "activity_published", "activity_id": activity["id"], "title": "Lab 7"}


def test_events_stay_inside_their_class(lab, db: Session) -> None:
    other_cid = new_class(lab.teacher, "Other class")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")
    with outsider.websocket_connect(f"{API}/ws/class/{other_cid}") as ws:
        assert recv(ws)["type"] == "connected"
        lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")  # closes the OTHER class's lab
        assert silent(ws)


def test_class_socket_access_rules(lab, db: Session) -> None:
    pending = login_as(db, Role.STUDENT, "waiting")
    pending.post(f"{API}/enroll", json={"code": lab.code})
    other_cid = new_class(lab.teacher, "Other class")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    admin = login_as(db, Role.ADMIN, "root")

    for client in (pending, outsider, other_teacher, admin):
        event, code = refused(client, f"{API}/ws/class/{lab.cid}")
        assert event["code"] == "NOT_CLASS_MEMBER" and code == 4403
    assert refused(lab.student, f"{API}/ws/class/99999")[1] == 4404
    assert refused(TestClient(lab.student.app), f"{API}/ws/class/{lab.cid}")[1] == 4401


def test_heartbeat_is_answered_and_marks_the_student_online(lab) -> None:
    sid = uid(lab.student)
    assert monitor_service.online_ids(lab.cid) == set()
    with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as ws:
        recv(ws)
        assert monitor_service.online_ids(lab.cid) == {sid}

        get_redis().zadd(monitor_service.presence_key(lab.cid), {str(sid): time.time() - 25})  # nearly stale
        ws.send_json({"type": "ping"})
        assert recv(ws) == {"type": "pong"}
        score = get_redis().zscore(monitor_service.presence_key(lab.cid), str(sid))
        assert time.time() - score < 3  # the heartbeat refreshed it
    assert monitor_service.online_ids(lab.cid) == set()  # leaving removes the student at once


def test_instructor_watching_the_class_socket_is_not_counted_as_a_student(lab) -> None:
    with lab.teacher.websocket_connect(f"{API}/ws/class/{lab.cid}") as ws:
        recv(ws)
        assert monitor_service.online_ids(lab.cid) == set()


def test_a_silent_student_connection_is_closed(lab, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "STUDENT_IDLE_SECONDS", 0.4)
    with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as ws:
        recv(ws)
        assert closed_with(ws) == 4408
    assert monitor_service.online_ids(lab.cid) == set()


def test_socket_closes_when_the_student_signs_in_on_another_pc(lab, db: Session, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "REVALIDATE_SECONDS", 0.2)
    with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as ws:
        recv(ws)
        assert login(TestClient(lab.student.app), "stu1").status_code == 200  # second device
        event = recv(ws, timeout=6)
        assert event["code"] == "SESSION_REPLACED"
        assert closed_with(ws) == 4401


def test_socket_closes_when_the_student_is_removed_from_the_class(lab, monkeypatch) -> None:
    monkeypatch.setattr(ws_module, "REVALIDATE_SECONDS", 0.2)
    with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as ws:
        recv(ws)
        enrollment = lab.teacher.get(f"{API}/classes/{lab.cid}/enrollments").json()["items"][0]
        lab.teacher.patch(f"{API}/enrollments/{enrollment['id']}", json={"action": "remove"})
        assert recv(ws, timeout=6)["code"] == "NOT_CLASS_MEMBER"
        assert closed_with(ws) == 4403


# ============================================================== /ws/monitor

def test_monitor_receives_everything_students_do(lab, db: Session, queued) -> None:
    activity = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [{"path": "main.py", "content": "print(1)"}]}).json()
    lab.teacher.post(f"{API}/activities/{activity['id']}/publish")
    entries = {e["path"]: e for e in lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()["entries"]}
    main = entries["Lab 1/main.py"]

    with lab.teacher.websocket_connect(f"{API}/ws/monitor/{lab.session_id}") as monitor:
        assert recv(monitor) == {"type": "connected"}

        with lab.student.websocket_connect(f"{API}/ws/class/{lab.cid}") as student_ws:  # comes online
            recv(student_ws)
            online = recv_until(monitor, "online")
            assert online["student"] == "Test User" and online["student_id"] == uid(lab.student)

            lab.student.put(f"{API}/workspace/files/{main['id']}",
                            json={"content": "print(2)", "last_updated_at": main["updated_at"]})
            saved = recv_until(monitor, "saved")
            assert saved["path"] == "Lab 1/main.py" and saved["file_id"] == main["id"] and saved["manual"] is False
            assert "print(2)" not in str(saved)  # events never carry student code

            eid = start_run(lab.student, lab.cid, "Lab 1/main.py")
            run = recv_until(monitor, "run")
            assert run["execution_id"] == eid and run["entry"] == "Lab 1/main.py" and run["status"] == "queued"

            assert lab.student.post(f"{API}/activities/{activity['id']}/submit").status_code == 200
            submitted = recv_until(monitor, "submitted")
            assert submitted["activity_id"] == activity["id"] and submitted["status"] == "submitted"

        offline = recv_until(monitor, "offline")  # the class socket closed
        assert offline["student_id"] == uid(lab.student)
        assert offline["ts"].endswith("Z")


def test_monitor_access_rules(lab, db: Session) -> None:
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    for client in (other_teacher, lab.student, login_as(db, Role.ADMIN, "root")):
        event, code = refused(client, f"{API}/ws/monitor/{lab.session_id}")
        assert code == 4403
    assert refused(lab.teacher, f"{API}/ws/monitor/99999") == (
        {"type": "error", "code": "SESSION_NOT_FOUND", "detail": "Lab session not found"}, 4404)
    assert refused(TestClient(lab.student.app), f"{API}/ws/monitor/{lab.session_id}")[1] == 4401


def test_monitor_only_hears_its_own_session(lab, db: Session, queued) -> None:
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    later = new_session(lab.teacher, lab.cid, "Batch B")
    lab.teacher.patch(f"{API}/sessions/{later['id']}/open")
    put_file(lab.student, lab.cid, "main.py")
    with lab.teacher.websocket_connect(f"{API}/ws/monitor/{lab.session_id}") as old_session:  # the closed one
        recv(old_session)
        start_run(lab.student, lab.cid)  # happens during Batch B
        assert silent(old_session)


def test_saves_after_the_lab_closes_publish_nothing_because_they_are_refused(lab) -> None:
    f = put_file(lab.student, lab.cid, "a.py")
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    with lab.teacher.websocket_connect(f"{API}/ws/monitor/{lab.session_id}") as monitor:
        recv(monitor)
        r = lab.student.put(f"{API}/workspace/files/{f['id']}", json={"content": "x", "last_updated_at": f["updated_at"]})
        assert r.status_code == 403 and silent(monitor)


# ===================================================== presence sweep + snapshot

def test_sweeper_drops_stale_students_and_announces_them(lab, db: Session) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    stale, fresh = uid(lab.student), uid(other)
    key = monitor_service.presence_key(lab.cid)
    get_redis().zadd(key, {str(stale): time.time() - 120, str(fresh): time.time()})

    events = Listener(f"monitor:{lab.session_id}")
    try:
        assert monitor_service.sweep_presence(db) == 1
        got = events.messages()
    finally:
        events.close()
    assert [(e["type"], e["student_id"], e["reason"]) for e in got] == [("offline", stale, "timeout")]
    assert monitor_service.online_ids(lab.cid) == {fresh}
    assert monitor_service.sweep_presence(db) == 0  # nothing left to do (and no repeat announcements)


def test_snapshot_reports_each_students_state(lab, db: Session, queued) -> None:
    quiet = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    pending = login_as(db, Role.STUDENT, "waiting")  # not approved: must not be listed
    pending.post(f"{API}/enroll", json={"code": lab.code})

    activity = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [{"path": "main.py", "content": "print(1)"}]}).json()
    lab.teacher.post(f"{API}/activities/{activity['id']}/publish")

    url = f"{API}/sessions/{lab.session_id}/monitor"
    before = lab.teacher.get(url).json()
    assert before["session_id"] == lab.session_id and before["is_open"] is True
    assert [s["student"]["username"] for s in before["students"]] == ["stu1", "stu2"]
    for s in before["students"]:  # nothing has happened yet; installed starter files are not "saves"
        assert (s["online"], s["last_run"], s["last_save"], s["submitted"]) == (False, None, None, False)

    main = {e["path"]: e for e in lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()["entries"]}["Lab 1/main.py"]
    time.sleep(1.1)  # a "save" is recognised once updated_at is a full second past created_at
    lab.student.put(f"{API}/workspace/files/{main['id']}", json={"content": "x = 1", "last_updated_at": main["updated_at"]})
    eid = start_run(lab.student, lab.cid, "Lab 1/main.py")
    db.expire_all()
    ex = db.get(Execution, eid)
    ex.status, ex.duration_ms, ex.finished_at = ExecutionStatus.ERROR, 250, utcnow()
    db.commit()
    lab.student.post(f"{API}/activities/{activity['id']}/submit")
    get_redis().zadd(monitor_service.presence_key(lab.cid), {str(uid(lab.student)): time.time()})

    after = lab.teacher.get(url).json()
    busy, idle = after["students"]
    assert busy["online"] is True and after["online_count"] == 1
    assert busy["last_run"]["execution_id"] == eid and busy["last_run"]["status"] == "error"
    assert busy["last_run"]["duration_ms"] == 250 and busy["last_run"]["entry_path"] == "Lab 1/main.py"
    assert busy["last_save"].endswith("Z") and busy["submitted"] is True and busy["last_submitted_at"].endswith("Z")
    assert (idle["online"], idle["last_run"], idle["last_save"], idle["submitted"]) == (False, None, None, False)


def test_snapshot_online_flag_expires_with_the_heartbeat(lab) -> None:
    key = monitor_service.presence_key(lab.cid)
    get_redis().zadd(key, {str(uid(lab.student)): time.time() - 29})
    assert lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()["students"][0]["online"] is True
    get_redis().zadd(key, {str(uid(lab.student)): time.time() - 31})
    assert lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()["students"][0]["online"] is False


def test_snapshot_last_run_is_per_session(lab, db: Session, queued) -> None:
    put_file(lab.student, lab.cid, "main.py")
    start_run(lab.student, lab.cid)
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    later = new_session(lab.teacher, lab.cid, "Batch B")
    assert lab.teacher.get(f"{API}/sessions/{later['id']}/monitor").json()["students"][0]["last_run"] is None
    assert lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()["students"][0]["last_run"] is not None


def test_snapshot_access_rules(lab, db: Session) -> None:
    url = f"{API}/sessions/{lab.session_id}/monitor"
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    assert other_teacher.get(url).json()["code"] == "NOT_CLASS_OWNER"
    assert lab.student.get(url).status_code == 403
    assert login_as(db, Role.ADMIN, "root").get(url).status_code == 403
    assert lab.teacher.get(f"{API}/sessions/99999/monitor").json()["code"] == "SESSION_NOT_FOUND"
    assert TestClient(lab.student.app).get(url).status_code == 401
