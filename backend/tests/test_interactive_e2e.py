"""Interactive runs through the REAL sandbox: API -> Celery task (run in a thread, like the interactive worker) ->
container -> Redis -> WebSocket, with the test typing like the frontend will. Needs the Docker socket:
`docker compose exec worker pytest tests/test_interactive_e2e.py`. Rebuild the image after changing boot.py."""
import queue
import threading
import time

import pytest

from app.core.redis import get_redis
from app.models.execution import Execution
from app.services import execution_service
from app.services import interactive_service as isvc
from tests.conftest import approved_student
from tests.test_sandbox import DOCKER_READY, leftover
from tests.test_submissions import publish

pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")

if DOCKER_READY:
    from app.worker import sandbox

API = "/api/v1"


@pytest.fixture(autouse=True)
def interactive_worker(monkeypatch, tasks_module):
    """Stands in for the interactive-worker: every interactive run executes in its own thread."""
    threads: list[threading.Thread] = []

    def launch(execution_id: int) -> None:
        def work() -> None:
            time.sleep(0.4)  # the test's WebSocket must be subscribed before the first output is published
            tasks_module.run_interactive(execution_id)

        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        threads.append(thread)

    monkeypatch.setattr(execution_service, "enqueue_interactive", launch)
    monkeypatch.setattr(execution_service, "enqueue", lambda eid: tasks_module.run_code(eid))
    clear()
    yield threads
    for thread in threads:
        thread.join(timeout=90)
    assert leftover() == []


def clear() -> None:
    for pattern in ("run:cooldown:*", "exec_stop:*", "exec_in_count:*"):
        for key in get_redis().scan_iter(pattern):
            get_redis().delete(key)


class Live:
    """A student's WebSocket on a run. Messages are read by a thread, so a test can never hang: every wait times out."""

    def __init__(self, ws) -> None:
        self.ws, self.inbox, self.seen = ws, queue.Queue(), []
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        try:
            while True:
                self.inbox.put(self.ws.receive_json())
        except Exception:
            self.inbox.put(None)

    def next(self, timeout: float = 40.0) -> dict:
        event = self.inbox.get(timeout=timeout)
        assert event is not None, f"the socket closed; events so far: {self.seen}"
        self.seen.append(event)
        return event

    def until(self, kind: str, timeout: float = 40.0) -> dict:
        deadline = time.time() + timeout
        while True:
            event = self.next(max(0.1, deadline - time.time()))
            if event["type"] == kind:
                return event

    def type(self, text: str) -> None:
        self.ws.send_json({"type": "stdin", "data": text})

    def eof(self) -> None:
        self.ws.send_json({"type": "eof"})

    def stop(self) -> None:
        self.ws.send_json({"type": "stop"})

    def text(self) -> str:
        return "".join(e["data"] for e in self.seen if e["type"] == "output")


def put_main(c, cid: int, code: str) -> None:
    r = c.post(f"{API}/workspace/{cid}/files", json={"path": "main.py", "content": code})
    assert r.status_code == 201, r.text


def start(c, cid: int, **body) -> int:
    clear()
    r = c.post(f"{API}/workspace/{cid}/run", json={"entry_path": "main.py", **body})
    assert r.status_code == 202, r.text
    return r.json()["execution_id"]


def run_live(lab, code: str):
    """Starts an interactive run and returns (execution id, context manager of the Live socket)."""
    put_main(lab.student, lab.cid, code)
    eid = start(lab.student, lab.cid)
    return eid, lab.student.websocket_connect(f"{API}/ws/run/{eid}")


# ====================================================================== typing live

def test_two_input_calls_answered_live(lab) -> None:
    eid, connection = run_live(lab, "a = input('First? ')\nb = input('Second? ')\nprint('You said', a, 'and', b)")
    with connection as ws:
        live = Live(ws)
        assert live.until("input_request")["type"] == "input_request"
        assert live.text() == "First? "                    # the prompt arrived, the marker did not
        live.type("Ana")
        live.until("input_request")
        assert live.text() == "First? Ana\nSecond? "        # the typed value is echoed after its prompt
        live.type("Bob")
        done = live.until("done")
    assert done["status"] == "ok" and done["exit_code"] == 0
    assert live.text() == "First? Ana\nSecond? Bob\nYou said Ana and Bob\n"
    assert "\x1e" not in live.text() and isvc.INPUT_REQUEST not in live.text()

    stored = lab.student.get(f"{API}/executions/{eid}").json()
    assert stored["status"] == "ok" and stored["mode"] == "interactive"
    assert stored["output"] == live.text()                  # what was streamed is what was stored
    assert stored["stdin"] == "Ana\nBob"                    # "Run again with the same inputs"


def test_input_inside_a_loop_five_values(lab) -> None:
    eid, connection = run_live(lab, "total = 0\nfor i in range(5):\n    total += int(input(f'#{i + 1}: '))\nprint('total', total)")
    with connection as ws:
        live = Live(ws)
        for value in (10, 20, 30, 40, 50):
            live.until("input_request")
            live.type(str(value))
        done = live.until("done")
    assert done["status"] == "ok"
    assert live.text().endswith("#5: 50\ntotal 150\n")
    assert sum(1 for e in live.seen if e["type"] == "input_request") == 5
    assert lab.student.get(f"{API}/executions/{eid}").json()["stdin"] == "10\n20\n30\n40\n50"


def test_waiting_for_the_student_costs_no_cpu_time(lab) -> None:
    """The 10 s limit is CPU time, not wall clock: a student may think for longer than that."""
    eid, connection = run_live(lab, "name = input('Name? ')\nprint('hello', name)")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        time.sleep(isvc.CPU_SEC + 2)
        live.type("slowpoke")
        done = live.until("done")
    assert done["status"] == "ok" and live.text().endswith("hello slowpoke\n")


def test_the_prompt_text_and_empty_lines_are_handled(lab) -> None:
    eid, connection = run_live(lab, "x = input()\ny = input('é-prompt: ')\nprint(repr(x), repr(y))")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        live.type("")
        live.until("input_request")
        live.type("héllo wörld")
        live.until("done")
    assert live.text().endswith("'' 'héllo wörld'\n")


# ======================================================================= the limits

def test_the_cpu_time_limit_still_kills_an_endless_loop(lab) -> None:
    eid, connection = run_live(lab, "print('spinning', flush=True)\nwhile True:\n    pass")
    with connection as ws:
        live = Live(ws)
        done = live.until("done", timeout=60)
    assert done["status"] == "timeout"
    assert "CPU time limit" in live.text() and "spinning" in live.text()
    assert lab.student.get(f"{API}/executions/{eid}").json()["status"] == "timeout"


def test_no_input_for_120_seconds_stops_the_run(lab, monkeypatch) -> None:
    monkeypatch.setattr(isvc, "INPUT_WAIT_SEC", 3)  # the real value is 120; the rule is the same
    eid, connection = run_live(lab, "input('Anyone there? ')\nprint('never reached')")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        done = live.until("done", timeout=30)
    assert done["status"] == "input_timeout"
    assert "No input received" in live.text() and "never reached" not in live.text()


def test_eof_makes_input_raise_eoferror(lab) -> None:
    eid, connection = run_live(lab, "try:\n    input('value? ')\nexcept EOFError:\n    print('caught EOF')\ninput('again? ')")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        live.eof()
        done = live.until("done")
    assert done["status"] == "error" and done["exit_code"] == 1
    assert "caught EOF" in live.text() and "EOFError: EOF when reading a line" in live.text()
    assert "<frozen runpy>" not in live.text() and '<string>' not in live.text()  # looks like a normal traceback


def test_stop_ends_a_program_that_is_waiting(lab) -> None:
    eid, connection = run_live(lab, "input('wait forever: ')")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        live.stop()
        done = live.until("done")
    assert done["status"] == "stopped" and lab.student.get(f"{API}/executions/{eid}").json()["status"] == "stopped"


def test_stop_ends_a_program_that_is_computing(lab) -> None:
    eid, connection = run_live(lab, "print('busy', flush=True)\nwhile True:\n    pass")
    with connection as ws:
        live = Live(ws)
        live.until("output")
        started = time.time()
        live.stop()
        done = live.until("done", timeout=15)
    assert done["status"] == "stopped" and time.time() - started < 10


def test_stop_pressed_while_queued_never_runs_the_program(lab) -> None:
    put_main(lab.student, lab.cid, "print('should not run')")
    clear()
    original = execution_service.enqueue_interactive
    execution_service.enqueue_interactive = lambda eid: None   # still "queued": no worker has picked it up
    try:
        eid = start(lab.student, lab.cid)
    finally:
        execution_service.enqueue_interactive = original
    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        ws.receive_json()
        ws.send_json({"type": "stop"})
        time.sleep(0.5)
    from app.worker import tasks
    tasks.run_interactive(eid)                                  # the worker finally gets to it
    stored = lab.student.get(f"{API}/executions/{eid}").json()
    assert stored["status"] == "stopped" and "should not run" not in (stored["output"] or "")


def test_output_is_still_capped(lab) -> None:
    eid, connection = run_live(lab, "while True:\n    print('x' * 1000)")
    with connection as ws:
        live = Live(ws)
        done = live.until("done", timeout=60)
    assert done["status"] == "output_limit" and len(live.text()) < 70 * 1024


# ==================================================================== hostile programs

def test_a_spoofed_marker_only_causes_a_harmless_input_request(lab) -> None:
    """A program can read the marker's nonce from its own command line and print the marker. The worker then tells
    the student that the program is waiting; nothing else happens, and the program is not affected or blocked."""
    code = (
        "args = open('/proc/self/cmdline', 'rb').read().split(b'\\0')\n"
        "nonce = args[-3].decode()\n"
        "print('before')\n"
        "print('\\x1e' + nonce + ':INPUT_REQUEST')\n"
        "print('\\x1e' + 'f' * 32 + ':INPUT_REQUEST')\n"
        "print('after')\n"
    )
    eid, connection = run_live(lab, code)
    with connection as ws:
        live = Live(ws)
        done = live.until("done")
    assert done["status"] == "ok" and done["exit_code"] == 0
    assert sum(1 for e in live.seen if e["type"] == "input_request") == 1   # the one with the right nonce
    assert live.text().startswith("before\n") and live.text().endswith("after\n")
    assert "\x1e" + "f" * 32 + ":INPUT_REQUEST" in live.text()                # a wrong guess is just output
    stored = lab.student.get(f"{API}/executions/{eid}").json()
    assert stored["stdin"] == "" and stored["status"] == "ok"


def test_a_spoofed_request_does_not_make_the_run_time_out_while_it_keeps_working(lab, monkeypatch) -> None:
    monkeypatch.setattr(isvc, "INPUT_WAIT_SEC", 2)
    code = (
        "import time\n"
        "nonce = open('/proc/self/cmdline', 'rb').read().split(b'\\0')[-3].decode()\n"
        "print('\\x1e' + nonce + ':INPUT_REQUEST', flush=True)\n"
        "for i in range(5):\n    time.sleep(1)\n    print('tick', i, flush=True)\n"
    )
    eid, connection = run_live(lab, code)
    with connection as ws:
        live = Live(ws)
        done = live.until("done")
    assert done["status"] == "ok" and live.text().count("tick") == 5   # output after the marker proves it was not waiting


def test_typed_input_cannot_run_commands_or_escape(lab) -> None:
    eid, connection = run_live(lab, "import os\nline = input('cmd? ')\nprint(repr(line), os.getuid())")
    with connection as ws:
        live = Live(ws)
        live.until("input_request")
        live.type("__import__('os').system('id'); $(id) `id`")
        live.until("done")
    assert "__import__('os').system('id'); $(id) `id`" in live.text() and "uid=" not in live.text()  # just text
    assert live.text().rstrip().endswith("1000")


# ================================================================ capacity and options

def test_twenty_waiting_interactive_runs_do_not_delay_a_batch_run(lab, db, tasks_module) -> None:
    cid, code = lab.cid, "name = input('waiting... ')\nprint(name)"
    students = [approved_student(db, lab.teacher, cid, lab.code, f"wait{i:02d}") for i in range(20)]
    ids = []
    for student in students:
        put_main(student, cid, code)
        ids.append(start(student, cid))

    deadline = time.time() + 60
    while time.time() < deadline:     # until every one of them is open and waiting for its student
        running = sum(1 for _ in sandbox.client.containers.list(filters={"label": sandbox.LABEL}))
        if running >= 20:
            break
        time.sleep(0.5)
    assert running >= 20
    time.sleep(1.0)

    put_main(lab.student, cid, "print('batch ok')")
    clear()
    began = time.time()
    r = lab.student.post(f"{API}/workspace/{cid}/run", json={"entry_path": "main.py", "mode": "batch"})
    took = time.time() - began
    assert r.status_code == 202
    done = lab.student.get(f"{API}/executions/{r.json()['execution_id']}").json()   # ran synchronously in this test
    assert done["status"] == "ok" and done["output"] == "batch ok\n" and done["mode"] == "batch"
    assert took < 6, f"the batch run took {took:.1f}s while 20 interactive runs were open"

    for eid in ids:                    # stop all twenty
        get_redis().set(isvc.stop_key(eid), "1", ex=60)
        get_redis().publish(isvc.control_channel(eid), '{"type":"stop"}')


def test_interactive_containers_keep_every_limit_except_the_cpu_cap() -> None:
    batch, inter = sandbox._container_options(), sandbox._container_options(interactive_run=True)
    for key in ("image", "user", "network_disabled", "mem_limit", "memswap_limit", "nano_cpus", "pids_limit",
                "read_only", "tmpfs", "cap_drop", "security_opt", "init", "log_config", "stdin_open"):
        assert inter[key] == batch[key], key
    limits = {u["Name"]: (u["Soft"], u["Hard"]) for u in inter["ulimits"]}
    assert limits == {"fsize": (1 << 20, 1 << 20), "nofile": (64, 64), "cpu": (10, 11)}
    assert inter["labels"][sandbox.TTL_LABEL] == str(isvc.CONTAINER_TTL_SEC) and sandbox.LABEL in inter["labels"]
    assert inter["detach"] is False and batch["detach"] is True   # only so that EOF can close the container's stdin
    assert "cpu" not in {u["Name"] for u in batch["ulimits"]}


def test_the_reaper_leaves_a_long_interactive_container_alone() -> None:
    plain = sandbox.client.containers.create("lab-python-runner:1", labels={sandbox.LABEL: "1"})
    long_lived = sandbox.client.containers.create(
        "lab-python-runner:1", labels={sandbox.LABEL: "1", sandbox.TTL_LABEL: str(isvc.CONTAINER_TTL_SEC)})
    try:
        time.sleep(1.5)
        assert sandbox.reap_orphans(max_age_sec=0) >= 1
        remaining = {c.id for c in sandbox.client.containers.list(all=True, filters={"label": sandbox.LABEL})}
        assert plain.id not in remaining and long_lived.id in remaining
    finally:
        long_lived.remove(force=True)
        try:
            plain.remove(force=True)
        except Exception:
            pass


def test_batch_runs_still_work_exactly_as_before(lab) -> None:
    put_main(lab.student, lab.cid, "name = input('Name? ')\nprint('Hello,', name)")
    eid = start(lab.student, lab.cid, mode="batch", stdin="Nicole\n")
    done = lab.student.get(f"{API}/executions/{eid}").json()
    assert done["status"] == "ok" and done["output"] == "Name? Hello, Nicole\n"
    assert done["mode"] == "batch" and done["stdin"] == "Nicole\n"


def test_practice_interactive_runs_work_too(lab) -> None:
    lab.student.post(f"{API}/practice/files", json={"path": "main.py", "content": "print(input('Say: ').upper())"})
    clear()
    r = lab.student.post(f"{API}/practice/run", json={"entry_path": "main.py"})
    assert r.status_code == 202
    with lab.student.websocket_connect(f"{API}/ws/run/{r.json()['execution_id']}") as ws:
        live = Live(ws)
        live.until("input_request")
        live.type("practice")
        done = live.until("done")
    assert done["status"] == "ok" and live.text() == "Say: practice\nPRACTICE\n"
