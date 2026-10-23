"""The sandbox abuse tests (ported from test_sandbox_abuse_reference.py). They start real containers, so they
only run where the Docker socket is mounted: `docker compose exec worker pytest tests/test_sandbox.py`.
After EVERY test, no runner container may be left behind."""
import time
from concurrent.futures import ThreadPoolExecutor

import pytest


def _docker_ready() -> bool:
    try:
        import docker

        c = docker.from_env()
        c.ping()
        c.images.get("lab-python-runner:1")
        return True
    except Exception:
        return False


DOCKER_READY = _docker_ready()
pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")

if DOCKER_READY:
    from app.worker import sandbox
    from app.worker.sandbox import MAX_OUTPUT, client, reap_orphans, run_in_sandbox


def leftover() -> list:
    return client.containers.list(all=True, filters={"label": sandbox.LABEL})


@pytest.fixture(autouse=True)
def no_leftover_containers():
    yield
    assert leftover() == [], "a runner container was left behind"


def py(code: str, path: str = "m.py") -> list[dict]:
    return [{"path": path, "content": code, "is_folder": False}]


# ------------------------------------------------------------------ normal runs

def test_normal_multifile_run_with_import_csv_and_input() -> None:
    files = [
        {"path": "Act2", "content": "", "is_folder": True},
        {"path": "Act2/main.py", "is_folder": False, "content":
            "import helpers\nname = input()\nprint(helpers.greet(name))\nprint(open('data.csv').read().strip())"},
        {"path": "Act2/helpers.py", "is_folder": False, "content": "def greet(n): return 'Hello ' + n"},
        {"path": "Act2/data.csv", "is_folder": False, "content": "a,b\n1,2"},
    ]
    r = run_in_sandbox(files, "Act2/main.py", "Nicole\n")
    assert (r.status, r.exit_code) == ("ok", 0)
    assert r.output == "Hello Nicole\na,b\n1,2\n"


def test_stdin_with_several_lines_and_unicode() -> None:
    code = "a = input(); b = input(); print(a.upper(), b[::-1]); print('héllo ✓')"
    r = run_in_sandbox(py(code), "m.py", "abc\nñandú\n")
    assert r.status == "ok" and r.output == "ABC údnañ\nhéllo ✓\n"


def test_nonzero_exit_code_is_reported_as_error() -> None:
    r = run_in_sandbox(py("import sys; sys.exit(3)"), "m.py")
    assert (r.status, r.exit_code) == ("error", 3)


def test_missing_entry_file() -> None:
    r = run_in_sandbox(py("print(1)"), "nope.py")
    assert r.status == "error" and r.exit_code == 2 and "File not found" in r.output


def test_output_is_streamed_in_chunks_that_add_up_to_the_result() -> None:
    chunks: list[str] = []
    code = "import time\nfor i in range(3):\n    print('line', i, flush=True)\n    time.sleep(0.3)"
    r = run_in_sandbox(py(code), "m.py", on_output=chunks.append)
    assert r.status == "ok" and "".join(chunks) == r.output == "line 0\nline 1\nline 2\n"
    assert len(chunks) >= 2  # arrived live, not as one block at the end


# ----------------------------------------------------------------- abuse cases

def test_syntax_error() -> None:
    r = run_in_sandbox(py("print('x'"), "m.py")
    assert (r.status, r.exit_code) == ("error", 1) and "SyntaxError" in r.output


def test_infinite_loop_times_out_within_the_celery_soft_limit() -> None:
    r = run_in_sandbox(py("while True: pass"), "m.py")
    assert r.status == "timeout" and r.exit_code is None
    assert "time limit of 10s" in r.output
    # Celery's soft limit is 12 s for the whole task; leave headroom for start-up and clean-up.
    assert 10_000 <= r.duration_ms < 11_500, r.duration_ms


def test_print_flood_is_cut_at_64kb() -> None:
    r = run_in_sandbox(py("while True: print('spam' * 20)"), "m.py")
    assert r.status == "output_limit"
    assert len(r.output) <= MAX_OUTPUT + 100 and "exceeded 64 KB" in r.output
    assert r.duration_ms < 8_000


def test_memory_bomb() -> None:
    r = run_in_sandbox(py("a = []\nwhile True: a.append(' ' * 10_000_000)"), "m.py")
    assert r.status == "memory_exceeded" and "memory limit" in r.output


def test_fork_bomb_is_contained() -> None:
    code = "import os\nwhile True:\n    try: os.fork()\n    except OSError: pass"
    r = run_in_sandbox(py(code), "m.py")
    assert r.status == "timeout"  # pids_limit=64 stops the explosion; the loop is then killed at 10 s
    time.sleep(0.5)  # the autouse fixture then proves nothing survived


def test_network_is_unreachable() -> None:
    code = ("import socket\n"
            "try: socket.create_connection(('8.8.8.8', 53), timeout=2)\n"
            "except OSError as e: print('blocked:', e.errno)\n"
            "try: socket.gethostbyname('example.com')\n"
            "except OSError: print('dns blocked')\n")
    r = run_in_sandbox(py(code), "m.py")
    assert r.status == "ok" and "blocked: 101" in r.output and "dns blocked" in r.output


def test_cannot_write_to_the_read_only_image() -> None:
    r = run_in_sandbox(py("open('/opt/runner/boot.py', 'w').write('x')"), "m.py")
    assert r.status == "error" and "Read-only file system" in r.output


def test_five_megabyte_file_hits_the_1mb_file_limit() -> None:
    r = run_in_sandbox(py("open('/workspace/big', 'w').write('x' * 5_000_000)"), "m.py")
    assert r.status == "error" and "File too large" in r.output


# ----------------------------------------------------------- isolation checks

def test_runs_unprivileged_without_secrets_docker_socket_or_network_interfaces() -> None:
    code = (
        "import os\n"
        "print('uid', os.getuid(), os.getgid())\n"
        "print('env', sorted(os.environ))\n"
        "print('sock', os.path.exists('/var/run/docker.sock'))\n"
        "print('app', os.path.exists('/app'))\n"
        "print('ifaces', [l.split(':')[0].strip() for l in open('/proc/net/dev').read().splitlines()[2:]])\n"
        "try: os.setuid(0)\n"
        "except OSError: print('cannot become root')\n"
    )
    r = run_in_sandbox(py(code), "m.py")
    assert r.status == "ok", r.output
    assert "uid 1000 1000" in r.output
    env_line = next(l for l in r.output.splitlines() if l.startswith("env "))
    env_names = set(eval(env_line[4:]))
    # only what boot.py sets (+ LC_CTYPE, which Python adds itself): no SECRET_KEY, MYSQL_*, REDIS_URL...
    assert {"HOME", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONIOENCODING"} <= env_names <= {
        "HOME", "PATH", "PYTHONDONTWRITEBYTECODE", "PYTHONIOENCODING", "LC_CTYPE"}
    assert "sock False" in r.output and "app False" in r.output
    assert "ifaces ['lo']" in r.output
    assert "cannot become root" in r.output


def test_runs_do_not_share_state() -> None:
    first = run_in_sandbox(py("open('/workspace/left_behind.txt', 'w').write('x')\nopen('/tmp/t', 'w').write('x')"), "m.py")
    second = run_in_sandbox(py("import os; print(os.path.exists('/workspace/left_behind.txt'), os.path.exists('/tmp/t'))"), "m.py")
    assert first.status == second.status == "ok" and second.output.strip() == "False False"


def test_container_options_keep_every_limit() -> None:
    o = sandbox._container_options()
    assert o["image"] == "lab-python-runner:1" and o["user"] == "1000:1000"
    assert o["network_disabled"] is True
    assert o["mem_limit"] == "128m" and o["memswap_limit"] == "128m"
    assert o["nano_cpus"] == int(0.5e9)
    assert o["pids_limit"] == 64
    assert o["read_only"] is True and o["init"] is True
    assert o["cap_drop"] == ["ALL"] and o["security_opt"] == ["no-new-privileges"]
    assert o["tmpfs"]["/workspace"].split(",")[1] == "size=10m" and o["tmpfs"]["/tmp"].split(",")[1] == "size=5m"
    limits = {u["Name"]: (u["Soft"], u["Hard"]) for u in o["ulimits"]}
    assert limits == {"fsize": (1 << 20, 1 << 20), "nofile": (64, 64)}
    assert sandbox.TIMEOUT_SEC == 10 and sandbox.MAX_OUTPUT == 64 * 1024


# ----------------------------------------------------------------- concurrency

def test_six_parallel_runs_do_not_interfere() -> None:
    def one(i: int):
        return run_in_sandbox(py(f"import time; time.sleep(0.5); print('run-{i}')"), "m.py")

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(one, range(6)))
    assert [r.status for r in results] == ["ok"] * 6
    assert [r.output.strip() for r in results] == [f"run-{i}" for i in range(6)]


# ------------------------------------------------------------------ the reaper

def test_reaper_removes_stale_runner_containers_and_nothing_else() -> None:
    runner = client.containers.create("lab-python-runner:1", labels={sandbox.LABEL: "1"})
    other = client.containers.create("lab-python-runner:1", command="true")  # no label: not ours
    try:
        assert reap_orphans(max_age_sec=3600) == 0  # too young to be an orphan
        assert reap_orphans(max_age_sec=-60) >= 1
        runner_ids = {c.id for c in leftover()}
        assert runner.id not in runner_ids
        client.containers.get(other.id)  # still there
    finally:
        for c in (runner, other):
            try:
                c.remove(force=True)
            except Exception:
                pass
