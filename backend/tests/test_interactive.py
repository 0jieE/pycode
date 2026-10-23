"""Interactive runs without Docker: the marker filter, the client-message rules, queue routing and per-student rules,
the WebSocket relay (limits, ownership) and the worker task around a fake sandbox. The real containers are covered in
test_interactive_e2e.py."""
import json
import time

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.redis import get_redis
from app.models.execution import Execution, ExecutionMode, ExecutionStatus
from app.models.user import Role
from app.services import execution_service
from app.services import interactive_service as isvc
from tests.conftest import Listener, approved_student, login_as, new_class, new_code
from tests.test_grading import activity_with_cases, run_tests

API = "/api/v1"
NONCE = "c" * 32


@pytest.fixture(autouse=True)
def fresh_state():
    for pattern in ("run:cooldown:*", "exec_stop:*", "exec_in_count:*"):
        for key in get_redis().scan_iter(pattern):
            get_redis().delete(key)
    yield


@pytest.fixture()
def sent(monkeypatch) -> list[tuple[str, int]]:
    """Replaces the three Celery hand-offs; records (which queue, execution id)."""
    log: list[tuple[str, int]] = []
    monkeypatch.setattr(execution_service, "enqueue", lambda eid: log.append(("lab", eid)))
    monkeypatch.setattr(execution_service, "enqueue_practice", lambda eid: log.append(("practice", eid)))
    monkeypatch.setattr(execution_service, "enqueue_interactive", lambda eid: log.append(("interactive", eid)))
    return log


def put_main(c, cid: int, code: str = "print(input())") -> None:
    r = c.post(f"{API}/workspace/{cid}/files", json={"path": "main.py", "content": code})
    assert r.status_code == 201, r.text


def start(c, cid: int, **body):
    return c.post(f"{API}/workspace/{cid}/run", json={"entry_path": "main.py", **body})


def clear_cooldowns() -> None:
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)


# ====================================================================== the marker filter

def marker() -> str:
    return isvc.marker_for(NONCE)


def test_the_marker_is_removed_and_reported_in_order() -> None:
    f = isvc.InputFilter(NONCE)
    assert f.feed("Name? " + marker()) == [("text", "Name? "), ("input", "")]
    assert f.feed("hello\n" + marker() + "second? " + marker()) == [
        ("text", "hello\n"), ("input", ""), ("text", "second? "), ("input", "")]
    assert f.feed("plain") == [("text", "plain")]


def test_a_marker_split_over_chunks_is_still_found() -> None:
    whole = "A? " + marker() + "after"
    for cut in range(1, len(marker()) + 3):
        f = isvc.InputFilter(NONCE)
        events = f.feed(whole[:cut]) + f.feed(whole[cut:])
        text = "".join(t for kind, t in events if kind == "text") + f.flush()
        assert text == "A? after", cut
        assert [k for k, _ in events].count("input") == 1, cut


def test_something_that_only_looks_like_the_marker_is_plain_text() -> None:
    f = isvc.InputFilter(NONCE)
    other = isvc.marker_for("d" * 32)  # a guessed nonce
    events = f.feed("x" + other + "y")
    assert events == [("text", "x" + other + "y")]
    assert f.feed("\x1e") == []                      # a lone control character is held back ...
    assert f.flush() == "\x1e"                       # ... and released at the end
    assert f.feed("\x1eabc") == [("text", "\x1eabc")]  # until it turns out not to be a marker


# ==================================================================== client messages

@pytest.mark.parametrize("raw,expected", [
    ('{"type":"stdin","data":"hello"}', {"type": "stdin", "data": "hello"}),
    ('{"type":"stdin","data":"hello\\n"}', {"type": "stdin", "data": "hello"}),   # a trailing newline is dropped
    ('{"type":"stdin","data":""}', {"type": "stdin", "data": ""}),                 # an empty line is a valid answer
    ('{"type":"stdin","data":"' + "x" * 1000 + '"}', {"type": "stdin", "data": "x" * 1000}),
    ('{"type":"eof"}', {"type": "eof"}),
    ('{"type":"stop","junk":1}', {"type": "stop"}),
])
def test_valid_client_messages(raw, expected) -> None:
    assert isvc.parse_client_message(raw) == (expected, None)


@pytest.mark.parametrize("raw,code", [
    ('{"type":"stdin","data":"' + "x" * 1001 + '"}', "INPUT_TOO_LONG"),
    ('{"type":"stdin","data":"a\\nb"}', "INVALID_INPUT"),
    ('{"type":"stdin","data":"a\\rb"}', "INVALID_INPUT"),
    ('{"type":"stdin","data":5}', "INVALID_MESSAGE"),
    ('{"type":"stdin"}', "INVALID_MESSAGE"),
    ('{"type":"run"}', "UNKNOWN_MESSAGE"),
    ('[1,2]', "INVALID_MESSAGE"),
    ('not json', "INVALID_MESSAGE"),
])
def test_invalid_client_messages(raw, code) -> None:
    message, error = isvc.parse_client_message(raw)
    assert message is None and error[0] == code


def test_the_documented_limits() -> None:
    assert (isvc.MAX_INPUT_CHARS, isvc.MAX_INPUTS, isvc.INPUT_WAIT_SEC, isvc.TOTAL_SEC, isvc.CPU_SEC) == (
        1000, 200, 120, 300, 10)


# ================================================================ modes, queues, rules

def test_the_default_mode_is_interactive_and_goes_to_the_interactive_queue(lab, db: Session, sent) -> None:
    put_main(lab.student, lab.cid)
    r = start(lab.student, lab.cid, stdin="ignored\n")
    assert r.status_code == 202 and sent == [("interactive", r.json()["execution_id"])]
    db.expire_all()
    ex = db.get(Execution, r.json()["execution_id"])
    assert ex.mode == ExecutionMode.INTERACTIVE and ex.stdin is None  # a typed run has no up-front input


def test_batch_mode_keeps_the_old_queue_and_stdin(lab, db: Session, sent) -> None:
    put_main(lab.student, lab.cid)
    r = start(lab.student, lab.cid, mode="batch", stdin="Nicole\n")
    assert sent == [("lab", r.json()["execution_id"])]
    db.expire_all()
    ex = db.get(Execution, r.json()["execution_id"])
    assert ex.mode == ExecutionMode.BATCH and ex.stdin == "Nicole\n"


def test_an_unknown_mode_is_rejected(lab, sent) -> None:
    put_main(lab.student, lab.cid)
    assert start(lab.student, lab.cid, mode="turbo").status_code == 422
    assert sent == []


def test_practice_runs_are_interactive_by_default_too(lab, sent) -> None:
    lab.student.post(f"{API}/practice/files", json={"path": "main.py", "content": "print(input())"})
    a = lab.student.post(f"{API}/practice/run", json={"entry_path": "main.py"})
    assert a.status_code == 202 and sent == [("interactive", a.json()["execution_id"])]


def test_practice_batch_runs_keep_the_practice_queue(lab, db: Session, sent) -> None:
    lab.student.post(f"{API}/practice/files", json={"path": "main.py", "content": "print(1)"})
    r = lab.student.post(f"{API}/practice/run", json={"entry_path": "main.py", "mode": "batch"})
    assert r.status_code == 202 and sent == [("practice", r.json()["execution_id"])]


def test_celery_gets_the_right_queue_and_task(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(execution_service.celery_app, "send_task",
                        lambda name, args=None, queue=None, **kw: calls.append((name, args, queue)))
    execution_service.enqueue_interactive(7)
    execution_service.enqueue(8)
    execution_service.enqueue_practice(9)
    assert calls == [("app.worker.tasks.run_interactive", [7], "interactive"),
                     ("app.worker.tasks.run_code", [8], "celery"),
                     ("app.worker.tasks.run_code", [9], "practice")]


def test_one_active_run_per_student_counts_both_modes(lab, sent) -> None:
    put_main(lab.student, lab.cid)
    assert start(lab.student, lab.cid).status_code == 202
    clear_cooldowns()
    for mode in ("interactive", "batch"):
        r = start(lab.student, lab.cid, mode=mode)
        assert r.status_code == 429 and r.json()["code"] == "RUN_IN_PROGRESS"
    assert len(sent) == 1


def test_the_interactive_queue_has_its_own_cap(lab, monkeypatch, sent) -> None:
    put_main(lab.student, lab.cid)
    lengths = {"celery": 0, "practice": 0, "interactive": execution_service.MAX_QUEUE_LENGTH + 1}
    monkeypatch.setattr(execution_service, "queue_length", lambda queue=None: lengths[queue or "celery"])
    r = start(lab.student, lab.cid)
    assert r.status_code == 503 and r.json()["code"] == "SERVER_BUSY"
    clear_cooldowns()
    assert start(lab.student, lab.cid, mode="batch").status_code == 202  # the batch queue is not full


def test_test_cases_and_grading_always_run_in_batch_mode(lab, db: Session, monkeypatch) -> None:
    jobs = []
    monkeypatch.setattr(execution_service, "enqueue_job", lambda eid, **kw: jobs.append(eid))
    a, _, _ = activity_with_cases(lab)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    lab.student.post(f"{API}/activities/{a['id']}/submit")
    db.expire_all()
    modes = {db.get(Execution, i).mode for i in jobs}
    assert jobs and modes == {ExecutionMode.BATCH} and eid in jobs


def test_a_long_interactive_run_is_not_expired_like_a_batch_run(lab, db: Session, sent) -> None:
    put_main(lab.student, lab.cid)
    first = start(lab.student, lab.cid).json()["execution_id"]
    db.expire_all()
    ex = db.get(Execution, first)
    ex.status, ex.queued_at = ExecutionStatus.RUNNING, utcnow() - execution_service.timedelta(minutes=3)
    db.commit()
    clear_cooldowns()
    assert start(lab.student, lab.cid).status_code == 429  # 3 minutes old, but an interactive run may last 5

    db.expire_all()
    db.get(Execution, first).queued_at = utcnow() - execution_service.timedelta(minutes=9)
    db.commit()
    clear_cooldowns()
    assert start(lab.student, lab.cid).status_code == 202   # older than 5 minutes + queue wait: it was lost
    db.expire_all()
    assert db.get(Execution, first).status == ExecutionStatus.SYSTEM_ERROR


def test_executions_report_their_mode_and_typed_input(lab, db: Session, sent) -> None:
    put_main(lab.student, lab.cid)
    eid = start(lab.student, lab.cid).json()["execution_id"]
    body = lab.student.get(f"{API}/executions/{eid}").json()
    assert body["mode"] == "interactive" and body["stdin"] is None
    db.expire_all()
    ex = db.get(Execution, eid)
    ex.stdin, ex.status = "Ana\nBob", ExecutionStatus.OK
    db.commit()
    assert lab.student.get(f"{API}/executions/{eid}").json()["stdin"] == "Ana\nBob"  # for "Run again with same inputs"


# ====================================================================== WebSocket relay

def interactive_run(lab, student=None) -> int:
    put_main(student or lab.student, lab.cid)
    r = start(student or lab.student, lab.cid)
    assert r.status_code == 202, r.text
    return r.json()["execution_id"]


def relayed(listener: Listener) -> list[dict]:
    return listener.messages(wait=0.4)


def test_the_owner_can_send_input_eof_and_stop(lab, sent) -> None:
    eid = interactive_run(lab)
    listener = Listener(isvc.control_channel(eid))
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            assert ws.receive_json() == {"type": "status", "status": "queued"}
            ws.send_json({"type": "stdin", "data": "hello"})
            ws.send_json({"type": "stdin", "data": "world\n"})
            ws.send_json({"type": "eof"})
            ws.send_json({"type": "stop"})
            got = relayed(listener)
    finally:
        listener.close()
    assert got == [{"type": "stdin", "data": "hello"}, {"type": "stdin", "data": "world"},
                   {"type": "eof"}, {"type": "stop"}]
    assert get_redis().get(isvc.stop_key(eid)) == "1"  # a Stop sent while queued is not lost


def test_invalid_messages_get_an_error_event_and_are_not_relayed(lab, sent) -> None:
    eid = interactive_run(lab)
    listener = Listener(isvc.control_channel(eid))
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            ws.receive_json()
            for bad, code in (({"type": "stdin", "data": "x" * 1001}, "INPUT_TOO_LONG"),
                              ({"type": "stdin", "data": "a\nb"}, "INVALID_INPUT"),
                              ({"type": "stdin", "data": 7}, "INVALID_MESSAGE"),
                              ({"type": "fly"}, "UNKNOWN_MESSAGE")):
                ws.send_json(bad)
                event = ws.receive_json()
                assert event["type"] == "error" and event["code"] == code
            ws.send_text("not json")
            assert ws.receive_json()["code"] == "INVALID_MESSAGE"
            ws.send_json({"type": "stdin", "data": "still works"})  # the socket was not closed
            got = relayed(listener)
    finally:
        listener.close()
    assert got == [{"type": "stdin", "data": "still works"}]


def test_at_most_200_inputs_per_run_even_across_reconnects(lab, sent) -> None:
    eid = interactive_run(lab)
    listener = Listener(isvc.control_channel(eid))
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            ws.receive_json()
            for i in range(150):
                ws.send_json({"type": "stdin", "data": str(i)})
            time.sleep(1.0)
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:  # a new socket does not reset the count
            ws.receive_json()
            for i in range(51):
                ws.send_json({"type": "stdin", "data": f"b{i}"})
            event = None
            while event is None or event.get("type") != "error":
                event = ws.receive_json()
            assert event["code"] == "INPUT_LIMIT"
            ws.send_json({"type": "stop"})  # stop is never counted against the limit
        got = listener.messages(wait=1.0)
    finally:
        listener.close()
    assert sum(1 for m in got if m["type"] == "stdin") == 200
    assert got[-1] == {"type": "stop"}


def test_nobody_else_can_send_input_to_my_run(lab, db: Session, sent) -> None:
    eid = interactive_run(lab)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    stranger = login_as(db, Role.STUDENT, "stranger")
    listener = Listener(isvc.control_channel(eid))
    try:
        for who in (other, stranger, lab.teacher):  # another student, a student outside the class, the instructor
            with who.websocket_connect(f"{API}/ws/run/{eid}") as ws:
                event = ws.receive_json()
                assert event["type"] == "error" and event["code"] == "EXECUTION_NOT_FOUND"
        from tests.conftest import new_device
        with new_device().websocket_connect(f"{API}/ws/run/{eid}") as ws:
            assert ws.receive_json()["code"] == "NOT_AUTHENTICATED"
        assert relayed(listener) == []
    finally:
        listener.close()
    assert get_redis().get(isvc.stop_key(eid)) is None


def test_messages_to_a_batch_run_go_nowhere(lab, sent) -> None:
    put_main(lab.student, lab.cid)
    eid = start(lab.student, lab.cid, mode="batch").json()["execution_id"]
    listener = Listener(isvc.control_channel(eid))
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            ws.receive_json()
            ws.send_json({"type": "stdin", "data": "hello"})
            ws.send_json({"type": "stop"})
            assert relayed(listener) == []
    finally:
        listener.close()


def test_a_finished_interactive_run_is_replayed_with_the_typed_values(lab, db: Session, sent) -> None:
    eid = interactive_run(lab)
    db.expire_all()
    ex = db.get(Execution, eid)
    ex.status, ex.output, ex.exit_code, ex.duration_ms = ExecutionStatus.OK, "Name? Ana\nHi Ana\n", 0, 120
    db.commit()
    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        assert ws.receive_json() == {"type": "output", "data": "Name? Ana\nHi Ana\n"}
        assert ws.receive_json()["status"] == "ok"


# ============================================================ the worker task, fake sandbox

@pytest.fixture()
def queued_interactive(lab, db: Session, sent) -> int:
    put_main(lab.student, lab.cid, "name = input('Name? ')\nprint('Hi ' + name)")
    return start(lab.student, lab.cid).json()["execution_id"]


def fake_sandbox(tasks, outcome, script=()):
    """What run_interactive does for the worker: stream, ask for input, return (RunResult, typed)."""
    seen = {}

    def run(files, entry, *, nonce, control, on_output, on_input_request):
        seen.update(files=files, entry=entry, nonce=nonce, control=control)
        for kind, value in script:
            if kind == "out":
                on_output(value)
            else:
                on_input_request()
        return outcome

    return run, seen


def load(db: Session, eid: int) -> Execution:
    db.expire_all()
    return db.get(Execution, eid)


def test_the_task_streams_saves_and_reports(lab, db: Session, tasks_module, queued_interactive, monkeypatch) -> None:
    eid = queued_interactive
    result = tasks_module.RunResult("ok", 0, "Name? Ana\nHi Ana\n", 321)
    run, seen = fake_sandbox(tasks_module, (result, ["Ana"]),
                             [("out", "Name? "), ("req", None), ("out", "Ana\n"), ("out", "Hi Ana\n")])
    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", run)
    events, monitor = Listener(f"exec:{eid}"), Listener(f"monitor:{lab.session_id}")
    try:
        tasks_module.run_interactive(eid)
        got, watched = events.messages(), [m for m in monitor.messages() if m["type"] == "run_done"]
    finally:
        events.close()
        monitor.close()
    assert got == [{"type": "status", "status": "running"}, {"type": "output", "data": "Name? "},
                   {"type": "input_request"}, {"type": "output", "data": "Ana\n"},
                   {"type": "output", "data": "Hi Ana\n"},
                   {"type": "done", "status": "ok", "exit_code": 0, "duration_ms": 321}]
    ex = load(db, eid)
    assert ex.status == ExecutionStatus.OK and ex.output == "Name? Ana\nHi Ana\n" and ex.stdin == "Ana"
    assert ex.started_at is not None and ex.finished_at is not None
    assert len(watched) == 1 and watched[0]["status"] == "ok"
    assert seen["entry"] == "main.py" and len(seen["nonce"]) == 32  # a random nonce per run
    assert {f["path"] for f in seen["files"]} >= {"main.py"}


def test_every_typed_line_is_recorded_joined_with_newlines(lab, db: Session, tasks_module, queued_interactive, monkeypatch) -> None:
    run, _ = fake_sandbox(tasks_module, (tasks_module.RunResult("ok", 0, "x", 5), ["1", "", "three words"]))
    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", run)
    tasks_module.run_interactive(queued_interactive)
    assert load(db, queued_interactive).stdin == "1\n\nthree words"


@pytest.mark.parametrize("status", ["stopped", "input_timeout", "timeout", "output_limit", "memory_exceeded", "error"])
def test_the_new_and_old_statuses_are_stored(lab, db: Session, tasks_module, queued_interactive, monkeypatch, status) -> None:
    run, _ = fake_sandbox(tasks_module, (tasks_module.RunResult(status, 1, "out", 5), []))
    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", run)
    tasks_module.run_interactive(queued_interactive)
    ex = load(db, queued_interactive)
    assert ex.status.value == status and ex.stdin == ""
    assert lab.student.get(f"{API}/executions/{queued_interactive}").json()["status"] == status


def test_a_stop_pressed_while_queued_never_starts_a_container(lab, db: Session, tasks_module, queued_interactive, monkeypatch) -> None:
    called = []
    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", lambda **kw: called.append(1))
    get_redis().set(isvc.stop_key(queued_interactive), "1", ex=60)
    tasks_module.run_interactive(queued_interactive)
    ex = load(db, queued_interactive)
    assert called == [] and ex.status == ExecutionStatus.STOPPED and ex.finished_at is not None


def test_a_crashing_sandbox_becomes_system_error(lab, db: Session, tasks_module, queued_interactive, monkeypatch) -> None:
    def boom(**kw):
        raise RuntimeError("secret detail /var/run/docker.sock")

    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", boom)
    tasks_module.run_interactive(queued_interactive)
    ex = load(db, queued_interactive)
    assert ex.status == ExecutionStatus.SYSTEM_ERROR and "docker.sock" not in (ex.output or "")


def test_a_redelivered_job_is_not_run_twice(lab, db: Session, tasks_module, queued_interactive, monkeypatch) -> None:
    calls = []
    run, _ = fake_sandbox(tasks_module, (tasks_module.RunResult("ok", 0, "x", 5), []))
    monkeypatch.setattr(tasks_module, "sandbox_run_interactive", lambda **kw: calls.append(1) or run(**kw))
    tasks_module.run_interactive(queued_interactive)
    tasks_module.run_interactive(queued_interactive)  # e.g. Celery redelivers it after the visibility timeout
    assert calls == [1]


def test_the_control_reads_the_students_messages_from_redis(tasks_module) -> None:
    control = tasks_module._RedisControl(987654)
    try:
        assert control.get(0.1) is None
        get_redis().publish(isvc.control_channel(987654), json.dumps({"type": "stdin", "data": "hi"}))
        assert control.get(1.0) == {"type": "stdin", "data": "hi"}
        get_redis().publish(isvc.control_channel(987654), "garbage")             # ignored
        get_redis().publish(isvc.control_channel(987654), json.dumps({"type": "fly"}))  # ignored
        assert control.get(0.3) is None and control.get(0.3) is None
        get_redis().set(isvc.stop_key(987654), "1", ex=30)
        deadline, got = time.time() + 3, None
        while got is None and time.time() < deadline:
            got = control.get(0.2)
        assert got == {"type": "stop"}
    finally:
        control.close()
        get_redis().delete(isvc.stop_key(987654))


def test_the_interactive_worker_is_configured() -> None:
    from pathlib import Path
    compose = Path("docker-compose.yml").read_text()
    block = compose[compose.index("  interactive-worker:"):]
    block = block[:block.index("\n  beat:")]
    assert "-Q interactive" in block and "--pool=threads" in block
    assert "-c ${INTERACTIVE_CONCURRENCY:-40}" in block and "/var/run/docker.sock" in block
    from app.core.config import Settings
    assert Settings.model_fields["INTERACTIVE_CONCURRENCY"].default == 40
    assert "INTERACTIVE_CONCURRENCY=" in Path(".env.example").read_text()
    assert "interactive-worker" in Path("docker-compose.prod.yml").read_text()
