"""Automatic grading through the API and the worker task, with the sandbox replaced by a fake that answers exactly
like boot.py (a nonce-framed block). Runs anywhere; the real container path is covered in test_grading_e2e.py."""
import base64
import json

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.redis import get_redis
from app.models.activity_log import ActivityLog
from app.models.execution import Execution, ExecutionKind, ExecutionStatus
from app.models.submission import Submission
from app.models.test_case import TestCase
from app.models.user import Role
from app.services import execution_service
from app.services import grading_service as g
from tests.conftest import Listener, approved_student, login_as, new_class, new_code
from tests.test_submissions import edit, publish, submit

API = "/api/v1"
SECRET = "SECRET-EXPECTED-OUTPUT-xyz"
SECRET_STDIN = "SECRET-HIDDEN-STDIN-abc"


def clear_cooldowns() -> None:
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)


@pytest.fixture(autouse=True)
def fresh_cooldowns():
    clear_cooldowns()
    yield


@pytest.fixture()
def jobs(monkeypatch) -> list[dict]:
    """Replaces the Celery hand-off for test / grade / try jobs; records every job that would have been queued."""
    sent: list[dict] = []
    monkeypatch.setattr(execution_service, "enqueue_job",
                        lambda eid, **kw: sent.append({"execution_id": eid, **kw}))
    return sent


def case(c, activity_id: int, **body):
    body.setdefault("name", "case")
    r = c.post(f"{API}/activities/{activity_id}/test-cases", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def activity_with_cases(lab, **extra):
    a = publish(lab, title="Lab 1", files=[{"path": "main.py", "content": "print(input())"}], **extra)
    shown = case(lab.teacher, a["id"], name="sample", stdin="2\n", expected_output="4", points=2)
    hidden = case(lab.teacher, a["id"], name="secret", stdin=SECRET_STDIN, expected_output=SECRET,
                  is_hidden=True, points=3)
    return a, shown, hidden


def run_tests(c, cid: int, activity_id: int, entry: str = "Lab 1/main.py"):
    return c.post(f"{API}/workspace/{cid}/test", json={"activity_id": activity_id, "entry_path": entry})


def block_for(tests: list[dict], nonce: str, answer) -> str:
    """What boot.py would print. `answer(stdin)` -> (status, output)."""
    results = []
    for t in tests:
        status, output = answer(t["stdin"])
        results.append({"id": t["id"], "status": status, "exit_code": 0, "duration_ms": 12,
                        "output_b64": base64.b64encode(output.encode()).decode()})
    block = json.dumps({"nonce": nonce, "results": results})
    return f"{g.START_MARKER}{nonce}\n{block}\n{g.END_MARKER}{nonce}\n"


class FakeSandbox:
    """Stands in for run_in_sandbox. Remembers what it was given so tests can look at it."""

    def __init__(self, tasks, answer=lambda stdin: ("ok", "")) -> None:
        self.tasks, self.answer, self.calls = tasks, answer, []

    def __call__(self, files, entry, stdin="", on_output=None, *, tests=None, nonce=None,
                 ignore_input_prompts=True, timeout_sec=None):
        self.calls.append({"files": files, "entry": entry, "tests": tests, "nonce": nonce,
                           "ignore": ignore_input_prompts, "timeout": timeout_sec})
        return self.tasks.RunResult("ok", 0, "student noise\n" + block_for(tests, nonce, self.answer), 80)


@pytest.fixture()
def sandbox(tasks_module, monkeypatch):
    fake = FakeSandbox(tasks_module)
    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake)
    return fake


def execution_of(db: Session, eid: int) -> Execution:
    db.rollback()
    return db.get(Execution, eid)


# ================================================================== instructor: CRUD

def test_instructor_creates_lists_edits_and_deletes_cases(lab, db: Session) -> None:
    a = publish(lab)
    first = case(lab.teacher, a["id"], name="one", stdin="1", expected_output="1")
    second = case(lab.teacher, a["id"], name="two")
    assert first["match_mode"] == "trim" and first["points"] == 1 and first["is_hidden"] is False
    assert (first["sort_order"], second["sort_order"]) == (0, 1)

    listed = lab.teacher.get(f"{API}/activities/{a['id']}/test-cases").json()
    assert [c["name"] for c in listed] == ["one", "two"] and listed[0]["expected_output"] == "1"

    # editable at any time, even though the activity is already published
    r = lab.teacher.patch(f"{API}/test-cases/{first['id']}", json={
        "expected_output": "2", "is_hidden": True, "points": 5, "match_mode": "ignore_case"})
    assert r.status_code == 200
    assert r.json()["expected_output"] == "2" and r.json()["is_hidden"] and r.json()["match_mode"] == "ignore_case"
    assert r.json()["name"] == "one" and r.json()["stdin"] == "1"  # untouched fields stay

    assert lab.teacher.delete(f"{API}/test-cases/{second['id']}").status_code == 204
    assert [c["id"] for c in lab.teacher.get(f"{API}/activities/{a['id']}/test-cases").json()] == [first["id"]]
    assert lab.teacher.delete(f"{API}/test-cases/{second['id']}").status_code == 404

    ops = [row.details["op"] for row in db.scalars(select(ActivityLog).where(ActivityLog.action == "test_case_change"))]
    assert ops == ["create", "create", "update", "delete"]


def test_deleting_the_activity_deletes_its_cases(lab, db: Session) -> None:
    a = publish(lab)
    case(lab.teacher, a["id"])
    from sqlalchemy import delete, text
    db.rollback()
    db.execute(text("DELETE FROM activities WHERE id = :id"), {"id": a["id"]})  # no endpoint: the FK cascades
    db.commit()
    assert db.scalar(select(TestCase.id).where(TestCase.activity_id == a["id"])) is None


def test_activity_options_ignore_input_prompts_and_entry_file(lab) -> None:
    a = publish(lab)
    assert a["ignore_input_prompts"] is True and a["entry_file"] == "main.py"
    r = lab.teacher.patch(f"{API}/activities/{a['id']}", json={"ignore_input_prompts": False, "entry_file": "app.py"})
    assert r.status_code == 200 and r.json()["ignore_input_prompts"] is False and r.json()["entry_file"] == "app.py"
    assert lab.teacher.patch(f"{API}/activities/{a['id']}", json={"entry_file": "../x.py"}).status_code == 400
    assert lab.teacher.patch(f"{API}/activities/{a['id']}", json={"entry_file": "notes.txt"}).status_code == 400


# ===================================================================== limits

def test_at_most_20_cases_per_activity(lab) -> None:
    a = publish(lab)
    for i in range(20):
        case(lab.teacher, a["id"], name=f"c{i}")
    r = lab.teacher.post(f"{API}/activities/{a['id']}/test-cases", json={"name": "21st"})
    assert r.status_code == 400 and r.json()["code"] == "TOO_MANY_TEST_CASES"


def test_text_size_limits_are_20_kb_each(lab) -> None:
    a = publish(lab)
    url = f"{API}/activities/{a['id']}/test-cases"
    assert lab.teacher.post(url, json={"name": "ok", "stdin": "x" * 20480, "expected_output": "y" * 20480}).status_code == 201
    for field in ("stdin", "expected_output"):
        r = lab.teacher.post(url, json={"name": "big", field: "x" * 20481})
        assert r.status_code == 413 and r.json()["code"] == "TEST_CASE_TOO_LARGE"
    # measured in bytes, not characters
    assert lab.teacher.post(url, json={"name": "wide", "stdin": "é" * 10241}).status_code == 413
    made = lab.teacher.get(url).json()[0]
    assert lab.teacher.patch(f"{API}/test-cases/{made['id']}", json={"stdin": "x" * 20481}).status_code == 413


def test_validation_of_points_and_modes(lab) -> None:
    a = publish(lab)
    url = f"{API}/activities/{a['id']}/test-cases"
    assert lab.teacher.post(url, json={"name": "neg", "points": -1}).status_code == 422
    assert lab.teacher.post(url, json={"name": "zero", "points": 0}).status_code == 201
    assert lab.teacher.post(url, json={"name": "mode", "match_mode": "regex"}).status_code == 422
    assert lab.teacher.post(url, json={"name": "   "}).status_code == 422
    r = lab.teacher.post(url, json={"name": "c", "match_mode": "contains", "expected_output": "  \n"})
    assert r.status_code == 400 and r.json()["code"] == "EMPTY_EXPECTED_OUTPUT"
    made = case(lab.teacher, a["id"], name="trim one", expected_output="")
    r = lab.teacher.patch(f"{API}/test-cases/{made['id']}", json={"match_mode": "contains"})
    assert r.status_code == 400 and r.json()["code"] == "EMPTY_EXPECTED_OUTPUT"


# ===================================================================== ordering

def test_cases_can_be_reordered(lab) -> None:
    a = publish(lab)
    ids = [case(lab.teacher, a["id"], name=n)["id"] for n in "abc"]
    r = lab.teacher.patch(f"{API}/activities/{a['id']}/test-cases/order", json={"order": [ids[2], ids[0], ids[1]]})
    assert r.status_code == 200 and [c["name"] for c in r.json()] == ["c", "a", "b"]
    assert [c["name"] for c in lab.teacher.get(f"{API}/activities/{a['id']}/test-cases").json()] == ["c", "a", "b"]
    for bad in ([ids[0]], [ids[0], ids[0], ids[1]], [*ids, 99999]):
        r = lab.teacher.patch(f"{API}/activities/{a['id']}/test-cases/order", json={"order": bad})
        assert r.status_code == 400 and r.json()["code"] == "INVALID_ORDER"
    new = case(lab.teacher, a["id"], name="d")
    assert new["sort_order"] == 3  # a new case goes to the end


# ================================================================== permissions

def test_permissions(lab, db: Session) -> None:
    a = publish(lab)
    c = case(lab.teacher, a["id"])
    stranger = login_as(db, Role.INSTRUCTOR, "teach2")
    for call in (
        lambda x: x.get(f"{API}/activities/{a['id']}/test-cases"),
        lambda x: x.post(f"{API}/activities/{a['id']}/test-cases", json={"name": "n"}),
        lambda x: x.patch(f"{API}/test-cases/{c['id']}", json={"name": "n"}),
        lambda x: x.delete(f"{API}/test-cases/{c['id']}"),
        lambda x: x.patch(f"{API}/activities/{a['id']}/test-cases/order", json={"order": [c["id"]]}),
        lambda x: x.post(f"{API}/test-cases/{c['id']}/try"),
        lambda x: x.post(f"{API}/activities/{a['id']}/regrade"),
    ):
        assert call(lab.student).status_code == 403                 # a student: never
        assert call(stranger).status_code in (403, 404)             # another instructor: not their class
        assert call(login_as_anon()).status_code == 401             # nobody signed in
    assert lab.teacher.get(f"{API}/activities/{a['id']}/test-cases").status_code == 200
    # nothing changed by all that
    assert lab.teacher.get(f"{API}/activities/{a['id']}/test-cases").json()[0]["name"] == "case"


def login_as_anon():
    from tests.conftest import new_device
    return new_device()


def test_student_endpoints_are_for_students_in_the_class(lab, db: Session) -> None:
    a, _, _ = activity_with_cases(lab)
    assert lab.teacher.get(f"{API}/activities/{a['id']}/test-cases/student").status_code == 403
    outsider = login_as(db, Role.STUDENT, "outsider")
    assert outsider.get(f"{API}/activities/{a['id']}/test-cases/student").status_code in (403, 404)
    assert run_tests(outsider, lab.cid, a["id"]).status_code in (403, 404)


# ============================================================ hidden cases stay hidden

def test_students_never_see_hidden_stdin_or_expected_output(lab) -> None:
    a, shown, hidden = activity_with_cases(lab)
    r = lab.student.get(f"{API}/activities/{a['id']}/test-cases/student")
    assert r.status_code == 200
    by_name = {c["name"]: c for c in r.json()}
    assert by_name["sample"] == {"id": shown["id"], "name": "sample", "points": 2, "is_hidden": False,
                                 "stdin": "2\n", "expected_output": "4", "match_mode": "trim"}
    assert by_name["secret"] == {"id": hidden["id"], "name": "secret", "points": 3, "is_hidden": True}
    assert SECRET not in r.text and SECRET_STDIN not in r.text


def test_the_student_view_follows_edits(lab) -> None:
    a, shown, hidden = activity_with_cases(lab)
    lab.teacher.patch(f"{API}/test-cases/{shown['id']}", json={"is_hidden": True})
    lab.teacher.patch(f"{API}/test-cases/{hidden['id']}", json={"is_hidden": False})
    got = {c["name"]: c for c in lab.student.get(f"{API}/activities/{a['id']}/test-cases/student").json()}
    assert got["sample"] == {"id": shown["id"], "name": "sample", "points": 2, "is_hidden": True}
    assert got["secret"]["stdin"] == SECRET_STDIN and got["secret"]["expected_output"] == SECRET


def test_an_unpublished_activity_is_invisible_to_students(lab) -> None:
    a = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": "Draft", "starter_files": [{"path": "main.py", "content": "print(1)"}]}).json()  # not published
    case(lab.teacher, a["id"])
    assert lab.student.get(f"{API}/activities/{a['id']}/test-cases/student").status_code == 404


# ============================================================ student "Test" button

def test_test_button_queues_a_test_job(lab, db: Session, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    r = run_tests(lab.student, lab.cid, a["id"])
    assert r.status_code == 202 and r.json()["queue_position"] == 1
    ex = execution_of(db, r.json()["execution_id"])
    assert ex.kind == ExecutionKind.TEST and ex.status == ExecutionStatus.QUEUED
    assert ex.entry_path == "Lab 1/main.py" and ex.activity_id == a["id"] and ex.lab_session_id == lab.session_id
    # two cases: 5 s x 2 + 5 s overall; celery gets a little more than the sandbox
    assert jobs == [{"execution_id": ex.id, "timeout": 15}]


def test_test_button_has_the_same_guards_as_run(lab, db: Session, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    assert run_tests(lab.student, lab.cid, a["id"]).status_code == 202
    r = run_tests(lab.student, lab.cid, a["id"])  # still in progress (and too fast)
    assert r.status_code == 429 and r.json()["code"] in ("RUN_IN_PROGRESS", "RUN_TOO_FAST")
    # a plain Run is blocked by the active test job too: one job per student
    r = lab.student.post(f"{API}/workspace/{lab.cid}/run", json={"entry_path": "Lab 1/main.py"})
    assert r.status_code == 429

    # finished, but within 3 s of the last job: rate limited
    db.rollback()
    for ex in db.scalars(select(Execution)):
        ex.status = ExecutionStatus.OK
    db.commit()
    assert run_tests(lab.student, lab.cid, a["id"]).json()["code"] == "RUN_TOO_FAST"
    clear_cooldowns()
    assert run_tests(lab.student, lab.cid, a["id"]).status_code == 202


def test_test_button_queue_cap(lab, monkeypatch, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    monkeypatch.setattr(execution_service, "queue_length", lambda: execution_service.MAX_QUEUE_LENGTH + 1)
    r = run_tests(lab.student, lab.cid, a["id"])
    assert r.status_code == 503 and r.json()["code"] == "SERVER_BUSY"


def test_test_button_needs_an_open_lab(lab, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    r = run_tests(lab.student, lab.cid, a["id"])
    assert r.status_code in (403, 409) and r.json()["code"] != "RUN_TOO_FAST"


def test_test_button_validation(lab, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    assert run_tests(lab.student, lab.cid, a["id"], "Lab 1/missing.py").status_code == 404
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "elsewhere.py", "content": "print(1)"})
    r = run_tests(lab.student, lab.cid, a["id"], "elsewhere.py")
    assert r.status_code == 400 and r.json()["code"] == "ENTRY_OUTSIDE_ACTIVITY"
    assert run_tests(lab.student, lab.cid, 999999).status_code == 404

    empty = publish(lab, title="Lab 2")
    r = run_tests(lab.student, lab.cid, empty["id"], "Lab 2/main.py")
    assert r.status_code == 400 and r.json()["code"] == "NO_TEST_CASES"
    assert jobs == []


# ================================================= the worker: grading a test job

def test_correct_program_passes_all_and_a_wrong_one_fails(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", {"2\n": "4\n", SECRET_STDIN: SECRET + "\n"}[stdin])
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert ex.status == ExecutionStatus.OK and ex.output == "2/2 tests passed"
    assert [r["passed"] for r in ex.test_results] == [True, True]
    assert [r["points_awarded"] for r in ex.test_results] == [2, 3]

    clear_cooldowns()
    sandbox.answer = lambda stdin: ("ok", "wrong\n")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert [r["passed"] for r in ex.test_results] == [False, False] and ex.output == "0/2 tests passed"
    assert [r["points_awarded"] for r in ex.test_results] == [0, 0]


def test_the_sandbox_gets_ids_and_stdin_only_never_expected_output(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    call = sandbox.calls[0]
    assert call["tests"] == [{"id": shown["id"], "stdin": "2\n"}, {"id": hidden["id"], "stdin": SECRET_STDIN}]
    assert len(call["nonce"]) == 32 and call["ignore"] is True and call["timeout"] == 15
    everything = json.dumps(call, default=str)
    assert SECRET not in everything and "expected" not in everything and '"4"' not in everything
    # and nothing about the expected output is in the real payload builder either
    assert all(set(t) == {"id", "stdin"} for t in call["tests"])


def test_every_job_gets_its_own_nonce(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    for _ in range(2):
        clear_cooldowns()
        tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
    assert sandbox.calls[0]["nonce"] != sandbox.calls[1]["nonce"]


def test_the_test_job_runs_the_live_workspace_and_the_activity_option(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab, ignore_input_prompts=False)
    edit(lab.student, lab.cid, "Lab 1/main.py", "print('my edit')")
    tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
    call = sandbox.calls[0]
    assert call["ignore"] is False and call["entry"] == "Lab 1/main.py"
    assert {f["path"]: f["content"] for f in call["files"]}["Lab 1/main.py"] == "print('my edit')"


def test_a_spoofed_block_printed_by_student_code_cannot_fake_a_pass(lab, db: Session, jobs, tasks_module, monkeypatch) -> None:
    """The student's program prints a perfect-looking result block, with a guessed nonce and with the real markers.
    Only a block carrying this job's own nonce counts, so the forged one is ignored."""
    a, shown, hidden = activity_with_cases(lab)
    seen = {}

    def forging_sandbox(files, entry, stdin="", on_output=None, *, tests=None, nonce=None, **kw):
        seen["nonce"] = nonce
        fake = block_for(tests, "f" * 32, lambda s: ("ok", {"2\n": "4", SECRET_STDIN: SECRET}[s]))
        # the container's log: the forged block, then boot.py's genuine one (the program really printed 'nope')
        return tasks_module.RunResult("ok", 0, fake + block_for(tests, nonce, lambda s: ("ok", "nope")), 50)

    monkeypatch.setattr(tasks_module, "run_in_sandbox", forging_sandbox)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    assert [r["passed"] for r in execution_of(db, eid).test_results] == [False, False]

    # and when the genuine block is missing entirely, the forged one still scores nothing
    clear_cooldowns()
    monkeypatch.setattr(tasks_module, "run_in_sandbox", lambda files, entry, stdin="", on_output=None, *, tests=None, nonce=None, **kw:
                        tasks_module.RunResult("ok", 0, block_for(tests, "f" * 32, lambda s: ("ok", "4")), 50))
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert [r["passed"] for r in ex.test_results] == [False, False] and {r["status"] for r in ex.test_results} == {"error"}


def test_one_timeout_does_not_stop_the_other_cases(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("timeout", "") if stdin == "2\n" else ("ok", SECRET)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert [(r["status"], r["passed"]) for r in ex.test_results] == [("timeout", False), ("ok", True)]
    assert sum(r["points_awarded"] for r in ex.test_results) == 3


def test_each_match_mode_is_applied_from_the_database(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a = publish(lab, title="Lab 1", files=[{"path": "main.py", "content": "print(1)"}])
    modes = {"trim": "Hello", "exact": "Hello", "ignore_case": "hello", "contains": "ell"}
    for mode, expected in modes.items():
        case(lab.teacher, a["id"], name=mode, match_mode=mode, expected_output=expected, stdin=mode)
    # every case gets the output "Hello \n" (a trailing space: only exact mode counts it)
    sandbox.answer = lambda stdin: ("ok", "Hello \n")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    got = {r["name"]: r["passed"] for r in execution_of(db, eid).test_results}
    assert got == {"trim": True, "exact": False, "ignore_case": True, "contains": True}


def test_results_are_ordered_like_the_cases(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a = publish(lab, title="Lab 1", files=[{"path": "main.py", "content": "print(1)"}])
    ids = [case(lab.teacher, a["id"], name=n, stdin=n)["id"] for n in "abc"]
    lab.teacher.patch(f"{API}/activities/{a['id']}/test-cases/order", json={"order": [ids[2], ids[0], ids[1]]})
    tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
    assert [t["stdin"] for t in sandbox.calls[0]["tests"]] == ["c", "a", "b"]


def test_students_read_results_with_hidden_output_redacted(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "printed:" + stdin.strip())
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)

    r = lab.student.get(f"{API}/executions/{eid}")
    body = r.json()
    assert body["kind"] == "test" and body["status"] == "ok"
    by_name = {t["name"]: t for t in body["test_results"]}
    assert by_name["sample"]["actual_output"] == "printed:2" and by_name["sample"]["passed"] is False
    assert by_name["secret"]["actual_output"] is None  # what a hidden case printed stays secret
    assert SECRET not in r.text and SECRET_STDIN not in r.text
    assert body["test_summary"] == {"passed": 0, "total": 2, "score": 0, "max_score": 5}
    # the stored row keeps the full data for the instructor's own use
    assert execution_of(db, eid).test_results[1]["actual_output"] == "printed:" + SECRET_STDIN


def test_websocket_streams_test_results_without_output(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "no")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    events = Listener(f"exec:{eid}")
    try:
        tasks_module.run_code(eid)
        got = events.messages()
    finally:
        events.close()
    assert got[0] == {"type": "status", "status": "running"}
    assert got[1:3] == [
        {"type": "test_result", "case_id": shown["id"], "passed": True, "status": "ok", "duration_ms": 12},
        {"type": "test_result", "case_id": hidden["id"], "passed": False, "status": "ok", "duration_ms": 12}]
    assert got[3] == {"type": "done", "kind": "test", "status": "ok", "exit_code": 0, "duration_ms": 80,
                      "passed": 1, "total": 2, "score": 2, "max_score": 5}
    assert all("output" not in e and "data" not in e for e in got[1:3])

    # a student who connects AFTER the job finished gets the same results replayed, still without any output
    with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
        replay = [ws.receive_json() for _ in range(3)]
    assert [e["type"] for e in replay] == ["test_result", "test_result", "done"]
    assert replay[2]["kind"] == "test" and (replay[2]["passed"], replay[2]["total"], replay[2]["score"]) == (1, 2, 2)
    assert all("output" not in e for e in replay)


def test_monitor_gets_a_tested_event(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "no")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    events = Listener(f"monitor:{lab.session_id}")
    try:
        tasks_module.run_code(eid)
        tested = [e for e in events.messages() if e["type"] == "tested"]
    finally:
        events.close()
    assert len(tested) == 1 and tested[0]["passed"] == 1 and tested[0]["total"] == 2
    assert tested[0]["student"] and tested[0]["activity_id"] == a["id"]


def test_infrastructure_failure_is_a_system_error_not_a_zero(lab, db: Session, jobs, tasks_module, monkeypatch) -> None:
    a, _, _ = activity_with_cases(lab)

    def boom(*args, **kwargs):
        raise RuntimeError("docker exploded /var/run/docker.sock")

    monkeypatch.setattr(tasks_module, "run_in_sandbox", boom)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert ex.status == ExecutionStatus.SYSTEM_ERROR and ex.test_results is None
    assert "docker" not in (ex.output or "").lower()


def test_a_container_timeout_without_a_block_fails_every_case_as_timeout(lab, db: Session, jobs, tasks_module, monkeypatch) -> None:
    a, _, _ = activity_with_cases(lab)
    monkeypatch.setattr(tasks_module, "run_in_sandbox", lambda *a, **k: tasks_module.RunResult("timeout", None, "", 15000))
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    ex = execution_of(db, eid)
    assert ex.status == ExecutionStatus.TIMEOUT
    assert [(r["status"], r["passed"]) for r in ex.test_results] == [("timeout", False)] * 2


# ===================================================== submit triggers grading

def test_submit_queues_grading_of_the_snapshot_and_fills_the_score(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    edit(lab.student, lab.cid, "Lab 1/main.py", "print('submitted version')")
    sub = lab.student.post(f"{API}/activities/{a['id']}/submit")
    assert sub.status_code == 200
    assert len(jobs) == 1
    ex = execution_of(db, jobs[0]["execution_id"])
    assert ex.kind == ExecutionKind.GRADE and ex.status == ExecutionStatus.QUEUED
    assert ex.entry_path == "Lab 1/main.py" and ex.activity_id == a["id"]

    # the student changes the file AFTER submitting: grading still uses the frozen snapshot
    edit(lab.student, lab.cid, "Lab 1/main.py", "print('edited after submitting')")
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "wrong")
    tasks_module.run_code(ex.id)
    assert {f["path"]: f["content"] for f in sandbox.calls[0]["files"]}["Lab 1/main.py"] == "print('submitted version')"

    detail = lab.teacher.get(f"{API}/submissions/{sub.json()['id']}").json()
    assert (detail["tests_passed"], detail["tests_total"], detail["score"], detail["max_score"]) == (1, 2, 2, 5)
    assert detail["graded_at"] is not None
    listed = lab.teacher.get(f"{API}/activities/{a['id']}/submissions").json()
    row = (listed["items"] if isinstance(listed, dict) else listed)[0]
    assert (row["score"], row["max_score"], row["tests_passed"], row["tests_total"]) == (2, 5, 1, 2)


def test_grading_does_not_count_as_the_students_active_run(lab, db: Session, jobs) -> None:
    a, _, _ = activity_with_cases(lab)
    assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200
    assert db.scalar(select(Execution.kind)) == ExecutionKind.GRADE  # a grade job is waiting in the queue...
    r = run_tests(lab.student, lab.cid, a["id"])  # not blocked by the queued grade job
    assert r.status_code == 202


def test_submit_without_test_cases_queues_nothing(lab, jobs) -> None:
    a = publish(lab)
    assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200
    assert jobs == []
    assert lab.teacher.get(f"{API}/submissions/1").json().get("score") is None


def test_a_queueing_failure_never_breaks_the_submit(lab, db: Session, monkeypatch) -> None:
    a, _, _ = activity_with_cases(lab)

    def broken(*args, **kwargs):
        raise ConnectionError("broker down")

    monkeypatch.setattr(execution_service, "enqueue_job", broken)
    sub = lab.student.post(f"{API}/activities/{a['id']}/submit")
    assert sub.status_code == 200
    assert lab.teacher.get(f"{API}/submissions/{sub.json()['id']}").json()["score"] is None


def test_resubmitting_clears_the_old_score_and_regrades(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else SECRET)
    sid = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    tasks_module.run_code(jobs[-1]["execution_id"])
    assert lab.teacher.get(f"{API}/submissions/{sid}").json()["score"] == 5

    again = lab.student.post(f"{API}/activities/{a['id']}/submit").json()
    assert again["id"] == sid
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()
    assert detail["score"] is None and detail["graded_at"] is None and detail["tests_total"] is None
    assert len(jobs) == 2
    tasks_module.run_code(jobs[-1]["execution_id"])
    assert lab.teacher.get(f"{API}/submissions/{sid}").json()["score"] == 5


def test_a_stale_grade_does_not_overwrite_a_newer_submission(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    """Submit, then resubmit before the first grading finishes: the first job's result must not be written."""
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else SECRET)
    sid = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    first_job = jobs[-1]["execution_id"]

    def resubmit_while_grading(*args, **kwargs):
        edit(lab.student, lab.cid, "Lab 1/main.py", "print('second')")
        assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200
        return FakeSandbox.__call__(sandbox, *args, **kwargs)

    tasks_module.run_in_sandbox = resubmit_while_grading
    try:
        tasks_module.run_code(first_job)
    finally:
        tasks_module.run_in_sandbox = sandbox
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()
    assert detail["score"] is None  # the first (stale) result was dropped; the second job will set it
    assert len(jobs) == 2


# ============================================================== regrade

def test_regrade_queues_every_submission_and_updates_scores(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    sandbox.answer = lambda stdin: ("ok", "wrong")
    ids = {}
    for name, c in (("stu1", lab.student), ("stu2", other)):
        ids[name] = c.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    for job in list(jobs):
        tasks_module.run_code(job["execution_id"])
    assert {lab.teacher.get(f"{API}/submissions/{i}").json()["score"] for i in ids.values()} == {0}

    # the instructor fixes a wrong expected output, then regrades everyone
    lab.teacher.patch(f"{API}/test-cases/{shown['id']}", json={"expected_output": "wrong"})
    jobs.clear()
    r = lab.teacher.post(f"{API}/activities/{a['id']}/regrade")
    assert r.status_code == 200 and r.json() == {"queued": 2, "skipped": 0}
    assert len(jobs) == 2
    assert lab.teacher.post(f"{API}/activities/{a['id']}/regrade").json() == {"queued": 0, "skipped": 2}  # already waiting
    for job in list(jobs):
        tasks_module.run_code(job["execution_id"])
    assert {lab.teacher.get(f"{API}/submissions/{i}").json()["score"] for i in ids.values()} == {2}
    assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "regrade")) is not None


def test_regrade_needs_test_cases(lab, jobs) -> None:
    a = publish(lab)
    r = lab.teacher.post(f"{API}/activities/{a['id']}/regrade")
    assert r.status_code == 400 and r.json()["code"] == "NO_TEST_CASES"


# =================================================================== try

def test_instructor_can_try_a_case_against_starter_files_or_given_files(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4\n")
    r = lab.teacher.post(f"{API}/test-cases/{shown['id']}/try")
    assert r.status_code == 202
    eid = r.json()["execution_id"]
    assert jobs[-1]["case_ids"] == [shown["id"]] and jobs[-1]["timeout"] == 10
    assert {f["path"] for f in jobs[-1]["files"]} == {"Lab 1/main.py"}

    tasks_module.run_code(eid, files=jobs[-1]["files"], case_ids=jobs[-1]["case_ids"])
    # the instructor sees the full result of their own try (hidden or not), nobody else can read it
    body = lab.teacher.get(f"{API}/executions/{eid}").json()
    assert body["kind"] == "test" and body["test_results"][0]["passed"] is True
    assert body["test_results"][0]["actual_output"] == "4\n"
    assert lab.student.get(f"{API}/executions/{eid}").status_code == 404
    assert [t["id"] for t in sandbox.calls[0]["tests"]] == [shown["id"]]  # only the tried case ran

    # with files given in the request
    clear_cooldowns()
    execution_of(db, eid)
    r = lab.teacher.post(f"{API}/test-cases/{hidden['id']}/try", json={
        "files": [{"path": "main.py", "content": "print('mine')"}]})
    assert r.status_code == 202 and jobs[-1]["files"] == [
        {"path": "Lab 1/main.py", "content": "print('mine')", "is_folder": False}]


def test_try_validates_its_files(lab, jobs) -> None:
    a, shown, _ = activity_with_cases(lab)
    r = lab.teacher.post(f"{API}/test-cases/{shown['id']}/try", json={"files": [{"path": "other.py", "content": "x"}]})
    assert r.status_code == 400 and r.json()["code"] == "ENTRY_NOT_FOUND"
    r = lab.teacher.post(f"{API}/test-cases/{shown['id']}/try", json={"files": [{"path": "../evil.py", "content": "x"}]})
    assert r.status_code == 400
    assert jobs == []
