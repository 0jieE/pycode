"""
One fresh, locked-down container per Run. Called only by the Celery worker.

Lifecycle of every run:
  1. create   – new container from lab-python-runner, all limits applied
  2. attach   – open the container's stdin
  3. start    – boot.py starts and waits for the payload
  4. send     – workspace files + entry + stdin are sent as one JSON payload
  5. stream   – output is read live (and pushed to the student), capped at MAX_OUTPUT
  6. wait     – hard wall-clock timeout; container is killed if it runs too long
  7. inspect  – exit code, OOMKilled flag -> status
  8. remove   – container is deleted no matter what happened (finally block)
"""
import codecs
import json
import socket
import threading
import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Callable, Optional

import docker
from docker.types import Ulimit

from app.services import interactive_service as interactive

IMAGE = "lab-python-runner:1"
TIMEOUT_SEC = 10            # wall-clock limit per run
MAX_OUTPUT = 64 * 1024      # 64 KB of terminal output, then the run is killed
# Test jobs: only boot.py writes to the container's output (the student's program writes into a pipe), and its
# one result block can reach ~430 KB, so they get a bigger allowance and a log file that does not rotate sooner.
TEST_MAX_OUTPUT = 600 * 1024
TEST_LOG_SIZE = "2m"
MEMORY = "128m"
CPUS = 0.5
LABEL = "lab-runner"
TTL_LABEL = "lab-runner-ttl"   # seconds a container may live before the orphan reaper may remove it

client = docker.from_env()


@dataclass
class RunResult:
    status: str        # ok | error | timeout | memory_exceeded | output_limit | system_error
    exit_code: Optional[int]
    output: str
    duration_ms: int


def _container_options(log_max_size: str = "128k", interactive_run: bool = False) -> dict:
    """Every limit of a sandbox container. An interactive run differs in exactly two ways: the program's CPU time is
    capped (RLIMIT_CPU, it replaces the 10 s wall clock because waiting for the student must not count), and the
    container's stdin closes when the worker half-closes the attach socket (that is how "eof" works)."""
    ulimits = [
        Ulimit(name="fsize", soft=1 << 20, hard=1 << 20),   # max 1 MB per written file
        Ulimit(name="nofile", soft=64, hard=64),
    ]
    labels = {LABEL: "1"}
    if interactive_run:
        # soft < hard: at the soft limit Python gets SIGXCPU and ends; the hard limit is a SIGKILL for a program
        # that ignores the signal
        ulimits.append(Ulimit(name="cpu", soft=interactive.CPU_SEC, hard=interactive.CPU_SEC + 1))
        labels[TTL_LABEL] = str(interactive.CONTAINER_TTL_SEC)
    return dict(
        image=IMAGE,
        # detach=False only changes how docker-py fills in the create request (StdinOnce: stdin is closed when the
        # attach socket is half-closed). The container is still started and read exactly like the others.
        detach=not interactive_run,
        stdin_open=True,
        user="1000:1000",
        network_disabled=True,                  # no LAN, no internet
        mem_limit=MEMORY,
        memswap_limit=MEMORY,                   # same as memory = no swap
        nano_cpus=int(CPUS * 1e9),
        pids_limit=64,                          # stops fork bombs
        read_only=True,                         # image filesystem cannot be changed
        tmpfs={
            "/workspace": "rw,size=10m,uid=1000,gid=1000,mode=0700",
            "/tmp": "rw,size=5m,uid=1000,gid=1000,mode=0700",
        },
        ulimits=ulimits,
        cap_drop=["ALL"],
        security_opt=["no-new-privileges"],
        init=True,                              # reaps zombie processes, forwards kill signals
        labels=labels,
        log_config={"type": "json-file", "config": {"max-size": log_max_size, "max-file": "1"}},
    )


def build_payload(files: list, entry: str, stdin: str = "", tests: Optional[list] = None,
                  nonce: Optional[str] = None, ignore_input_prompts: bool = True,
                  budget_sec: Optional[float] = None, interactive_nonce: Optional[str] = None) -> bytes:
    """The JSON sent to boot.py. In test mode `tests` is a list of {"id", "stdin"} and nothing else: expected
    outputs live only in the database and are compared by the worker, never inside the sandbox."""
    job: dict = {"files": files, "entry": entry, "stdin": stdin}
    if tests is not None:
        job["tests"] = [{"id": t["id"], "stdin": t.get("stdin") or ""} for t in tests]  # nothing else is copied
        job["nonce"] = nonce
        job["ignore_input_prompts"] = ignore_input_prompts
        job["budget_sec"] = budget_sec
    if interactive_nonce:
        job["interactive_nonce"] = interactive_nonce
    return json.dumps(job).encode("utf-8")


def run_in_sandbox(files: list, entry: str, stdin: str = "",
                   on_output: Optional[Callable[[str], None]] = None, *, tests: Optional[list] = None,
                   nonce: Optional[str] = None, ignore_input_prompts: bool = True,
                   timeout_sec: Optional[int] = None) -> RunResult:
    """Runs one job in a fresh container. A normal Run uses TIMEOUT_SEC and MAX_OUTPUT. A test job (`tests` given)
    gets `timeout_sec` for the whole container and a larger output allowance, because boot.py's single result
    block can hold up to 20 tests x 16 KB of (base64) output. Every container limit is the same for both."""
    test_mode = tests is not None
    timeout = timeout_sec if (test_mode and timeout_sec) else TIMEOUT_SEC
    max_output = TEST_MAX_OUTPUT if test_mode else MAX_OUTPUT
    payload = build_payload(files, entry, stdin, tests, nonce, ignore_input_prompts,
                            budget_sec=max(timeout - 3, 2) if test_mode else None)
    started = time.monotonic()
    container = None
    chunks: list = []
    total = 0
    output_limited = threading.Event()

    try:
        container = client.containers.create(**_container_options(TEST_LOG_SIZE if test_mode else "128k"))

        sock = container.attach_socket(params={"stdin": 1, "stream": 1})
        container.start()
        sock._sock.sendall(str(len(payload)).encode() + b"\n" + payload)
        sock._sock.close()

        def reader():
            nonlocal total
            for raw in container.logs(stream=True, follow=True, stdout=True, stderr=True):
                text = raw.decode("utf-8", errors="replace")
                total += len(raw)
                if total > max_output:
                    output_limited.set()
                    try:
                        container.kill()
                    except docker.errors.APIError:
                        pass
                    return
                chunks.append(text)
                if on_output:
                    on_output(text)

        t = threading.Thread(target=reader, daemon=True)
        t.start()

        timed_out = False
        try:
            exit_code = container.wait(timeout=timeout)["StatusCode"]
        except Exception:                       # requests ReadTimeout / ConnectionError
            timed_out = True
            container.kill()
            exit_code = None
        t.join(timeout=2)

        container.reload()
        oom = container.attrs["State"].get("OOMKilled", False)

        if output_limited.is_set():
            status, note = "output_limit", f"\n[Stopped: output exceeded {max_output // 1024} KB]"
        elif timed_out:
            status, note = "timeout", f"\n[Stopped: time limit of {timeout}s exceeded]"
        elif oom or exit_code == 137:
            status, note = "memory_exceeded", f"\n[Stopped: memory limit of {MEMORY} exceeded]"
        elif exit_code == 0:
            status, note = "ok", ""
        else:
            status, note = "error", ""

        if note and on_output:
            on_output(note)
        return RunResult(status, exit_code, "".join(chunks) + note,
                         int((time.monotonic() - started) * 1000))

    except docker.errors.DockerException as e:
        return RunResult("system_error", None, f"[Sandbox error: {e}]",
                         int((time.monotonic() - started) * 1000))
    finally:
        if container is not None:
            try:
                container.remove(force=True)    # always delete, even after errors
            except docker.errors.APIError:
                pass


class RunControl:
    """What run_interactive needs from the worker: the student's messages, one at a time."""

    def get(self, timeout: float) -> Optional[dict]:  # {"type": "stdin", "data"} | {"type": "eof"} | {"type": "stop"}
        raise NotImplementedError


def run_interactive(files: list, entry: str, *, nonce: str, control: RunControl,
                    on_output: Callable[[str], None], on_input_request: Callable[[], None],
                    on_input_done: Callable[[], None] = lambda: None) -> tuple[RunResult, list]:
    """Runs one interactive run in a fresh container: the program pauses at input() and the student types live.
    Returns (result, the lines the student typed). Container limits are those of every run, except that the 10 s wall
    clock is replaced by 10 s of CPU time (RLIMIT_CPU), plus: 120 s to answer one input request, 5 minutes in total.

    The worker keeps the container's stdin open after the payload: boot.py reads exactly the payload bytes, so every
    later line reaches the program. Output is cut at MAX_OUTPUT as usual (the typed lines echoed after their prompts
    count too). The typed text is echoed into the output, because a pipe has no terminal to do it."""
    payload = build_payload(files, entry, interactive_nonce=nonce)
    started = time.monotonic()
    container = None
    chunks: list = []
    typed: list = []
    lock = threading.Lock()
    state = {"total": 0, "waiting_since": None, "reason": None}
    output_limited = threading.Event()
    finished = threading.Event()
    outcome: dict = {}
    sock = None

    def emit(text: str) -> None:
        if not text:
            return
        with lock:
            chunks.append(text)
        on_output(text)

    try:
        container = client.containers.create(**_container_options(interactive_run=True))
        sock = container.attach_socket(params={"stdin": 1, "stream": 1})
        container.start()
        sock._sock.sendall(str(len(payload)).encode() + b"\n" + payload)  # the socket stays open: stdin is live

        def reader() -> None:
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            marker_filter = interactive.InputFilter(nonce)
            for raw in container.logs(stream=True, follow=True, stdout=True, stderr=True):
                state["total"] += len(raw)
                if state["total"] > MAX_OUTPUT:
                    output_limited.set()
                    try:
                        container.kill()
                    except docker.errors.APIError:
                        pass
                    return
                for kind, text in marker_filter.feed(decoder.decode(raw)):
                    if kind == "input":
                        state["waiting_since"] = time.monotonic()
                        on_input_request()
                    elif text:
                        # anything printed after a request proves the program was not really waiting
                        state["waiting_since"] = None
                        emit(text)
            emit(marker_filter.flush() + decoder.decode(b"", final=True))

        def waiter() -> None:
            try:
                outcome["code"] = container.wait(timeout=interactive.TOTAL_SEC)["StatusCode"]
            except Exception:                   # requests ReadTimeout / ConnectionError: the 5 minutes are over
                outcome["timed_out"] = True
                try:
                    container.kill()
                except docker.errors.APIError:
                    pass
            finished.set()

        threading.Thread(target=reader, daemon=True).start()
        waiter_thread = threading.Thread(target=waiter, daemon=True)
        waiter_thread.start()

        def kill(reason: str) -> None:
            state["reason"] = reason
            try:
                container.kill()
            except docker.errors.APIError:
                pass

        while not finished.is_set():
            message = control.get(0.2)
            if message is None:
                since = state["waiting_since"]
                if since is not None and time.monotonic() - since > interactive.INPUT_WAIT_SEC:
                    kill("input_timeout")
                continue
            kind = message.get("type")
            if kind == "stop":
                kill("stopped")
            elif kind == "eof":
                try:
                    sock._sock.shutdown(socket.SHUT_WR)    # container stdin closes: input() raises EOFError
                except OSError:
                    pass
            elif kind == "stdin":
                line = message.get("data")
                if (not isinstance(line, str) or len(typed) >= interactive.MAX_INPUTS
                        or len(line) > interactive.MAX_INPUT_CHARS or "\n" in line or "\r" in line):
                    continue
                state["waiting_since"] = None
                typed.append(line)
                try:
                    sock._sock.sendall(line.encode("utf-8") + b"\n")
                except OSError:
                    pass                                   # the program has already ended
                emit(line + "\n")
                on_input_done()
        waiter_thread.join(timeout=2)
        time.sleep(0.2)                                    # let the reader take the last lines of output

        container.reload()
        oom = container.attrs["State"].get("OOMKilled", False)
        exit_code = outcome.get("code")
        reason = state["reason"]

        if output_limited.is_set():
            status, note = "output_limit", f"\n[Stopped: output exceeded {MAX_OUTPUT // 1024} KB]"
        elif reason == "stopped":
            status, note = "stopped", "\n[Stopped]"
        elif reason == "input_timeout":
            status, note = "input_timeout", f"\n[Stopped: No input received for {interactive.INPUT_WAIT_SEC} seconds]"
        elif outcome.get("timed_out"):
            status, note = "timeout", f"\n[Stopped: time limit of {interactive.TOTAL_SEC // 60} minutes exceeded]"
        elif oom:
            status, note = "memory_exceeded", f"\n[Stopped: memory limit of {MEMORY} exceeded]"
        elif exit_code in (152, 137):                      # SIGXCPU (soft limit) / SIGKILL (hard limit) of RLIMIT_CPU
            status, note = "timeout", f"\n[Stopped: CPU time limit of {interactive.CPU_SEC} seconds exceeded]"
        elif exit_code == 0:
            status, note = "ok", ""
        else:
            status, note = "error", ""

        if note:
            emit(note)
        with lock:
            output = "".join(chunks)
        return RunResult(status, exit_code, output, int((time.monotonic() - started) * 1000)), list(typed)

    except docker.errors.DockerException as e:
        return RunResult("system_error", None, f"[Sandbox error: {e}]",
                         int((time.monotonic() - started) * 1000)), list(typed)
    finally:
        if sock is not None:
            try:
                sock._sock.close()
            except OSError:
                pass
        if container is not None:
            try:
                container.remove(force=True)
            except docker.errors.APIError:
                pass


def reap_orphans(max_age_sec: int = 30) -> int:
    """Celery beat job (every minute): remove runner containers left behind by a crashed worker."""
    removed = 0
    now = datetime.now(timezone.utc)
    # ignore_removed: a run finishing right now deletes its own container between list and inspect
    for c in client.containers.list(all=True, filters={"label": LABEL}, ignore_removed=True):
        created = datetime.strptime(c.attrs["Created"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        # an interactive run legitimately lives for minutes: its container says how long (the label)
        allowed = max(max_age_sec, int(c.labels.get(TTL_LABEL, 0) or 0)) if max_age_sec >= 0 else max_age_sec
        if (now - created).total_seconds() > allowed:
            try:
                c.remove(force=True)
                removed += 1
            except docker.errors.NotFound:
                pass
    return removed
