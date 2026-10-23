"""
Runs INSIDE the sandbox container, before the student's code.

Protocol (sent by the worker over the container's stdin):
    line 1      : payload size in bytes, e.g. b"1834\n"
    next N bytes: JSON {"files": [{"path", "content", "is_folder"}], "entry": "...", "stdin": "..."}
                  and, for automatic grading, also
                  "tests": [{"id": 7, "stdin": "..."}], "nonce": "<random per job>",
                  "ignore_input_prompts": true, "budget_sec": 55
                  or, for an interactive run, "interactive_nonce": "<random per run>"

boot.py reads EXACTLY those bytes from stdin and nothing more (os.read on the file descriptor, no buffering), so
whatever the student types later is still in the pipe for the program.

NORMAL MODE (no "tests"): boot.py writes the files into /workspace (a tmpfs, RAM only), changes into the entry
file's folder, then runs the student's program as a child process with the student's stdin. The exit code is
passed through.

INTERACTIVE MODE ("interactive_nonce" present): the program inherits stdin, stdout and stderr (the container's).
It is started through a small wrapper that replaces input(): it prints the prompt, flushes, then prints a marker line
("\x1e<nonce>:INPUT_REQUEST") and reads one line from stdin. The worker removes the marker from the output and tells
the student that the program is waiting. End of input (the worker closing stdin) raises EOFError, as usual.

TEST MODE ("tests" present): for each test, boot.py runs the entry file as a child process with that test's stdin.
The child's stdout+stderr go into a PIPE read by boot.py, never to boot.py's own stdout, so the student's program
cannot write what the worker reads. When every test is done, boot.py prints exactly ONE JSON block framed by the
per-job nonce, which only boot.py knows (it is not in any environment variable, argument or file, and boot.py
makes itself non-dumpable so the child cannot read its memory or its file descriptors through /proc).
Expected outputs are never sent here: comparing is done by the worker.

INPUT CONSUMPTION (test mode): a test's stdin is handed to the program ONE LINE AT A TIME through the pipe, and the
next line is written only once the pipe is empty again (FIONREAD on our end of it), i.e. once the program has taken
the line. So boot.py, outside the program's process, knows how many lines the program read: input(), readline(),
read(), iteration and os.read all have to pull from that pipe, and nothing the program does can change the count.
Each result carries "lines_given" (the test's lines up to its last non-blank one) and "lines_read".
"""
import base64
import ctypes
import fcntl
import json
import os
import shutil
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
from pathlib import PurePosixPath

ROOT = "/workspace"
PER_TEST_TIMEOUT = 5.0           # seconds per test
PER_TEST_OUTPUT = 16 * 1024      # bytes of combined stdout+stderr kept per test; more kills the child
START_MARKER = "@@LAB-TESTS-BEGIN:"
END_MARKER = "@@LAB-TESTS-END:"
CHILD_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp",
             "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"}

# Replaces input() by a version that reads a line WITHOUT printing the prompt, then runs the student's file.
WRAPPER = (
    "import builtins, runpy, sys\n"
    "def _input(prompt=''):\n"
    "    line = sys.stdin.readline()\n"
    "    if not line:\n"
    "        raise EOFError('EOF when reading a line')\n"
    "    return line[:-1] if line.endswith('\\n') else line\n"
    "builtins.input = _input\n"
    "sys.argv = sys.argv[1:]\n"
    "runpy.run_path(sys.argv[0], run_name='__main__')\n"
)


# Interactive: prints the prompt, then the marker the worker is looking for, then reads one line. Its own frames are
# cut out of tracebacks, so an error looks exactly like it does in a normal run.
INTERACTIVE_WRAPPER = r"""
import builtins, runpy, sys, types
_marker = '\x1e' + sys.argv[1] + ':INPUT_REQUEST\n'
def _input(prompt=''):
    sys.stdout.write(str(prompt))
    sys.stdout.flush()
    sys.stdout.write(_marker)
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise EOFError('EOF when reading a line')
    return line[:-1] if line.endswith('\n') else line
def _hook(kind, value, tb):
    keep = []
    while tb is not None:
        if tb.tb_frame.f_code.co_filename not in ('<string>', '<frozen runpy>'):
            keep.append(tb)
        tb = tb.tb_next
    trimmed = None
    for item in reversed(keep):
        trimmed = types.TracebackType(trimmed, item.tb_frame, item.tb_lasti, item.tb_lineno)
    sys.__excepthook__(kind, value.with_traceback(trimmed), trimmed)
builtins.input = _input
sys.excepthook = _hook
sys.argv = sys.argv[2:]
runpy.run_path(sys.argv[0], run_name='__main__')
"""


def read_exactly_the_payload() -> dict:
    """The size line, then exactly that many bytes, straight from file descriptor 0. A buffered reader could swallow
    extra bytes, and those would be missing for the program when the student types its first input."""
    header = b""
    while not header.endswith(b"\n"):
        byte = os.read(0, 1)
        if not byte:
            raise EOFError("no payload")
        header += byte
    size = int(header)
    data = bytearray()
    while len(data) < size:
        chunk = os.read(0, size - len(data))
        if not chunk:
            raise EOFError("short payload")
        data.extend(chunk)
    return json.loads(bytes(data))


def safe_path(rel: str) -> str:
    p = PurePosixPath(rel)
    if p.is_absolute() or ".." in p.parts or not p.parts:
        raise ValueError(f"bad path: {rel}")
    return os.path.join(ROOT, *p.parts)


def make_undumpable() -> None:
    """PR_SET_DUMPABLE = 0: other processes (even with our uid) can no longer open /proc/<boot pid>/mem, /fd,
    /environ. Best effort: it is one layer among several (the nonce is also never put anywhere readable)."""
    try:
        ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)
    except Exception:
        pass


def write_files(files: list) -> None:
    for f in files:
        dest = safe_path(f["path"])
        if f.get("is_folder"):
            os.makedirs(dest, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(f["content"])


def wipe_workspace() -> None:
    """Every test starts from the same files: nothing a previous test wrote can reach the next one."""
    for name in os.listdir(ROOT):
        path = os.path.join(ROOT, name)
        try:
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
        except OSError:
            pass


def kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # the child leads its own process group (start_new_session)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.kill()
    except OSError:
        pass


def lines_given(stdin_text: str) -> int:
    """The lines a program must read: every line up to the last one that is not blank (an instructor's trailing
    empty line is not a value)."""
    lines = stdin_text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    return len(lines)


def pending_bytes(fd: int) -> int:
    """Bytes still sitting in the pipe (FIONREAD works on either end of a Linux pipe); -1 if unknown."""
    try:
        return struct.unpack("i", fcntl.ioctl(fd, termios.FIONREAD, bytes(4)))[0]
    except OSError:
        return -1


def run_one(entry_abs: str, stdin_text: str, wrap: bool, timeout: float) -> dict:
    name = os.path.basename(entry_abs)
    cmd = [sys.executable, "-u", "-c", WRAPPER, name] if wrap else [sys.executable, "-u", name]
    started = time.monotonic()
    proc = subprocess.Popen(
        cmd, cwd=os.path.dirname(entry_abs), env=CHILD_ENV, start_new_session=True,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    kept = bytearray()
    seen = 0
    capped = threading.Event()

    def pump() -> None:
        nonlocal seen
        fd = proc.stdout.fileno()
        while True:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            room = PER_TEST_OUTPUT - len(kept)
            if room > 0:
                kept.extend(data[:room])
            seen += len(data)
            if seen > PER_TEST_OUTPUT:
                capped.set()
                kill_group(proc)
                return

    lines = stdin_text.splitlines(keepends=True)
    consumed = 0                 # lines the program took out of the pipe
    finished = threading.Event()

    def feed() -> None:
        """One line at a time: write it, wait until the program has taken all of it, then the next. A line the
        program never takes (it exited, or never reads) stops the feeding; the count is what was taken. When every
        line is taken the pipe is closed, so a read to the end (sys.stdin.read()) sees end of file."""
        nonlocal consumed
        fd = proc.stdin.fileno()
        try:
            for line in lines:
                data = line.encode("utf-8")
                while data:
                    data = data[os.write(fd, data):]
                delay = 0.0002
                while True:
                    left = pending_bytes(fd)
                    if left == 0:
                        consumed += 1
                        break
                    if left < 0 or finished.is_set() or proc.poll() is not None:
                        return
                    time.sleep(delay)
                    delay = min(delay * 2, 0.005)
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()
            except OSError:
                pass

    reader = threading.Thread(target=pump, daemon=True)
    feeder = threading.Thread(target=feed, daemon=True)
    reader.start()
    feeder.start()

    timed_out = False
    try:
        rc = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_group(proc)
        rc = proc.wait()
    finished.set()
    feeder.join(timeout=1)
    reader.join(timeout=2)
    kill_group(proc)  # also reaps anything the program left running

    if capped.is_set():
        status = "output_limit"
    elif timed_out:
        status = "timeout"
    elif rc == -signal.SIGKILL:
        status = "memory_exceeded"  # killed by the kernel (the container's memory limit), not by us
    elif rc == 0:
        status = "ok"
    else:
        status = "error"
    return {
        "status": status,
        "exit_code": None if timed_out else (128 - rc if rc < 0 else rc),
        "duration_ms": int((time.monotonic() - started) * 1000),
        "output_b64": base64.b64encode(bytes(kept)).decode("ascii"),
        "lines_given": lines_given(stdin_text),
        "lines_read": consumed,
    }


def synthetic(status: str, exit_code, text: str, stdin_text: str = "") -> dict:
    return {"status": status, "exit_code": exit_code, "duration_ms": 0,
            "output_b64": base64.b64encode(text.encode("utf-8")).decode("ascii"),
            "lines_given": lines_given(stdin_text), "lines_read": 0}


def run_tests(job: dict) -> int:
    nonce = job["nonce"]
    wrap = bool(job.get("ignore_input_prompts", True))
    budget = float(job.get("budget_sec", 55))
    began = time.monotonic()
    entry_rel = job["entry"]
    entry_abs = safe_path(entry_rel)

    results = []
    for test in job["tests"]:
        remaining = budget - (time.monotonic() - began)
        if remaining < 0.5:  # out of overall time: report instead of being killed with every result lost
            result = synthetic("timeout", None, "[not run: the time budget for all tests was used up]",
                               test.get("stdin", ""))
        else:
            os.chdir(ROOT)
            wipe_workspace()
            write_files(job["files"])
            if not os.path.isfile(entry_abs):
                result = synthetic("error", 2, f"File not found: {entry_rel}\n", test.get("stdin", ""))
            else:
                result = run_one(entry_abs, test.get("stdin", ""), wrap, min(PER_TEST_TIMEOUT, remaining))
        result["id"] = test["id"]
        results.append(result)

    block = json.dumps({"nonce": nonce, "results": results})
    sys.stdout.write("\n" + START_MARKER + nonce + "\n" + block + "\n" + END_MARKER + nonce + "\n")
    sys.stdout.flush()
    return 0


def main() -> int:
    job = read_exactly_the_payload()
    make_undumpable()

    if "tests" in job:
        return run_tests(job)

    write_files(job["files"])
    entry = safe_path(job["entry"])
    if not os.path.isfile(entry):
        print(f"File not found: {job['entry']}", file=sys.stderr)
        return 2

    os.chdir(os.path.dirname(entry))          # so `import helpers` and open("data.csv") work
    sys.stdout.flush()
    if job.get("interactive_nonce"):
        # stdin/stdout/stderr are inherited: the worker's typed lines reach the program directly
        result = subprocess.run(
            [sys.executable, "-u", "-c", INTERACTIVE_WRAPPER, job["interactive_nonce"], os.path.basename(entry)],
            env=CHILD_ENV,
        )
    else:
        result = subprocess.run(
            [sys.executable, "-u", os.path.basename(entry)],
            input=job.get("stdin", "").encode("utf-8"),
            env=CHILD_ENV,
        )
    rc = result.returncode
    return 128 - rc if rc < 0 else rc         # killed by signal N -> 128+N (e.g. 137 = SIGKILL)


if __name__ == "__main__":
    sys.exit(main())
