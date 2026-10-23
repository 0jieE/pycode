"""Load test: a lab full of students.

Every simulated student signs in, then, while the test runs:
  * autosaves their file every 5 seconds,
  * presses Run every 30 seconds (and waits for the result: that wait is the "run turnaround"),
  * and ONCE, SPIKE_AFTER_SECONDS into the test, ALL students press Run at the same moment (the spike).

Targets (the test exits non-zero if any is missed):
  * normal run turnaround p95 <= 3 s
  * the whole 120-run spike finishes within 20 s
  * 0 errors (any failed request, any run that does not end in status "ok")

Run it (see README) against the api directly, e.g.
  docker compose run --rm --no-deps api locust -f loadtest/locustfile.py --headless \
      -u 120 -r 20 -t 3m --host http://api:8000
It bypasses Nginx on purpose: from one machine every request would share one client IP and hit the per-IP
Run limit, which real lab PCs (one IP each) never do.
"""
import itertools
import os
from datetime import datetime
import random
import time

import gevent
from locust import HttpUser, constant, events

PASSWORD = os.getenv("LOAD_PASSWORD", "LoadTest#2026")
STUDENTS = int(os.getenv("LOAD_STUDENTS", "120"))
SAVE_EVERY = float(os.getenv("SAVE_EVERY_SECONDS", "5"))
RUN_EVERY = float(os.getenv("RUN_EVERY_SECONDS", "30"))
SPIKE_AFTER = float(os.getenv("SPIKE_AFTER_SECONDS", "90"))
# Browsers get run output over WebSocket; Locust cannot, so it polls. One poll per second keeps that artificial
# load small, and turnaround is taken from the server's own finished_at, so it does not depend on the interval.
POLL_EVERY = 1.0

TARGET_RUN_P95_MS = 3000
TARGET_SPIKE_DRAIN_S = 20.0

_next_student = itertools.count(0)
_state = {"spike_at": None, "spike_finished": [], "spike_runs": 0, "normal": []}  # normal: (start, ms)
RECOVERY_SECONDS = 5  # after the spike has drained, the queue needs a moment to settle

NORMAL = "run turnaround"
SPIKE = "run turnaround (spike)"


@events.test_start.add_listener
def _arm_spike(environment, **_):
    _state.update(spike_at=time.time() + SPIKE_AFTER, spike_finished=[], spike_runs=0, normal=[])


class Student(HttpUser):
    wait_time = constant(1)  # one "tick" per second decides what is due

    def on_start(self) -> None:
        n = next(_next_student) % STUDENTS + 1
        self.username = f"load{n:03d}"
        r = self.client.post("/api/v1/auth/login", json={"username": self.username, "password": PASSWORD},
                             name="POST /auth/login")
        if r.status_code != 200:
            raise RuntimeError(f"cannot sign in as {self.username}: {r.status_code} {r.text[:100]}")
        classes = self.client.get("/api/v1/my/classes", name="GET /my/classes").json()["items"]
        self.class_id = classes[0]["class_id"]
        tree = self.client.get(f"/api/v1/workspace/{self.class_id}/tree", name="GET /workspace/[class]/tree").json()
        entry = next(e for e in tree["entries"] if e["path"] == "Load Lab/main.py")
        self.file_id, self.token = entry["id"], entry["updated_at"]
        self.revision = 0
        self.next_save = time.time() + random.uniform(0, SAVE_EVERY)
        self.next_run = time.time() + random.uniform(3, RUN_EVERY)  # staggered, like real students
        self.running = False
        self.spiked = False

    @property
    def _main_py(self) -> str:
        return (f"# revision {self.revision} by {self.username}\n"
                "total = sum(i * i for i in range(200_000))\n"
                "print('sum of squares:', total)\n"
                "for n in range(1, 6):\n"
                "    print('row', n, n * n)\n")

    def tick(self) -> None:
        now = time.time()
        spike_at = _state["spike_at"]
        if spike_at and now >= spike_at and not self.spiked:
            self.spiked = True
            self._start_run(spike=True)
        elif now >= self.next_run:
            self.next_run = now + RUN_EVERY
            self._start_run(spike=False)
        if now >= self.next_save:
            self.next_save = now + SAVE_EVERY
            self._autosave()

    tasks = [tick]

    # ----------------------------------------------------------------- actions

    def _autosave(self) -> None:
        self.revision += 1
        with self.client.put(f"/api/v1/workspace/files/{self.file_id}",
                             json={"content": self._main_py, "last_updated_at": self.token},
                             name="PUT /workspace/files/[id] (autosave)", catch_response=True) as r:
            if r.status_code == 200:
                self.token = r.json()["updated_at"]
                r.success()
            else:
                r.failure(f"{r.status_code} {r.text[:80]}")

    def _start_run(self, spike: bool) -> None:
        # Runs happen in their own greenlet so autosave keeps ticking while a run is in flight.
        gevent.spawn(self._run, spike)

    def _run(self, spike: bool) -> None:
        while self.running:  # a run is still going (only possible around the spike): wait for it
            gevent.sleep(0.2)
        self.running = True
        started, name = time.time(), SPIKE if spike else NORMAL
        status, error, finished_at = "?", None, None
        try:
            for attempt in range(40):  # the 3 s cooldown can reject a spike run right after a normal one
                r = self.client.post(f"/api/v1/workspace/{self.class_id}/run",
                                     json={"mode": "batch", "entry_path": "Load Lab/main.py", "stdin": ""},
                                     name="POST /workspace/[class]/run", catch_response=True)
                with r:
                    if r.status_code == 202:
                        execution_id = r.json()["execution_id"]
                        r.success()
                        break
                    if r.status_code == 429 and spike:
                        r.success()  # cooldown: the student presses Run again a moment later
                        gevent.sleep(0.5)
                        continue
                    r.failure(f"{r.status_code} {r.text[:80]}")
                    error = f"run rejected ({r.status_code})"
                    return
            else:
                error = "run never accepted"
                return
            while time.time() - started < 90:
                gevent.sleep(POLL_EVERY)
                ex = self.client.get(f"/api/v1/executions/{execution_id}", name="GET /executions/[id] (poll)").json()
                if ex["status"] not in ("queued", "running"):
                    status = ex["status"]
                    finished_at = datetime.fromisoformat(ex["finished_at"].replace("Z", "+00:00")).timestamp()
                    break
            else:
                error = "run did not finish within 90 s"
        finally:
            self.running = False
            done_at = finished_at if finished_at and finished_at >= started else time.time()
            elapsed_ms = (done_at - started) * 1000
            if error is None and status != "ok":
                error = f"run ended with status {status}"
            if spike and error is None:
                _state["spike_finished"].append(done_at)
            if not spike and error is None:
                _state["normal"].append((started, elapsed_ms))
            self.environment.events.request.fire(
                request_type="RUN", name=name, response_time=elapsed_ms, response_length=0,
                exception=Exception(error) if error else None, context={})
            if spike:
                _state["spike_runs"] += 1


# ------------------------------------------------------------------------- report

def _percentile(entry, p):
    return entry.get_response_time_percentile(p) if entry and entry.num_requests else None


@events.test_stop.add_listener
def _report(environment, **_):
    stats = environment.stats
    out = ["", "=" * 78, "LOAD TEST RESULT", "=" * 78,
           f"{'request':<46}{'count':>7}{'fail':>6}{'p50 ms':>9}{'p95 ms':>9}"]
    for (name, method), e in sorted(stats.entries.items()):
        if method != "RUN":
            out.append(f"{method + ' ' + name if method not in name else name:<46.46}{e.num_requests:>7}"
                       f"{e.num_failures:>6}{_percentile(e, 0.5) or 0:>9.0f}{_percentile(e, 0.95) or 0:>9.0f}")
    out.append("-" * 78)

    spike = stats.get(SPIKE, "RUN")
    drain = None
    if _state["spike_finished"] and _state["spike_at"]:
        drain = max(_state["spike_finished"]) - _state["spike_at"]

    # "Normal" runs = ordinary traffic. A run that STARTS while the spike is being worked off waits behind 120
    # others by design, so those are reported separately (the spike has its own target).
    def pct(values, p):
        values = sorted(values)
        return values[min(len(values) - 1, int(p * len(values)))] if values else None

    everything = [ms for _, ms in _state["normal"]]
    window_end = (_state["spike_at"] + drain + RECOVERY_SECONDS) if drain is not None else None
    steady = [ms for start, ms in _state["normal"]
              if window_end is None or not (_state["spike_at"] <= start <= window_end)]
    p50n, p95n = pct(steady, 0.5), pct(steady, 0.95)
    out.append(f"normal run turnaround : {len(steady)} steady-state runs, p50 {p50n or 0:.0f} ms, "
               f"p95 {p95n or 0:.0f} ms (target p95 <= {TARGET_RUN_P95_MS} ms)")
    out.append(f"  (all {len(everything)} normal runs, incl. those queued behind the spike: "
               f"p50 {pct(everything, 0.5) or 0:.0f} ms, p95 {pct(everything, 0.95) or 0:.0f} ms)")
    if drain is not None:
        out.append(f"spike                 : {len(_state['spike_finished'])}/{_state['spike_runs']} runs ok, "
                   f"drained in {drain:.1f} s (target <= {TARGET_SPIKE_DRAIN_S:.0f} s), "
                   f"turnaround p50 {_percentile(spike, 0.5) or 0:.0f} ms, p95 {_percentile(spike, 0.95) or 0:.0f} ms")
    else:
        out.append("spike                 : did not happen (test too short? raise -t or lower SPIKE_AFTER_SECONDS)")

    failures = stats.total.num_failures
    out.append(f"errors                : {failures} (target 0)")

    problems = []
    if p95n is None or p95n > TARGET_RUN_P95_MS:
        problems.append(f"normal run p95 {p95n} ms > {TARGET_RUN_P95_MS} ms")
    if drain is None or drain > TARGET_SPIKE_DRAIN_S or len(_state["spike_finished"]) < _state["spike_runs"]:
        problems.append("spike did not drain in time / not all spike runs succeeded")
    if failures:
        problems.append(f"{failures} errors")
    out.append("RESULT: " + ("PASS - all targets met" if not problems else "FAIL - " + "; ".join(problems)))
    out.append("=" * 78)
    print("\n".join(out))
    if problems:
        environment.process_exit_code = 1
