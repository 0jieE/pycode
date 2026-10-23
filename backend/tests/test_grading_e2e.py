"""Automatic grading through the REAL sandbox: API -> task -> container (boot.py in test mode) -> comparison in the
worker. Needs the Docker socket: `docker compose exec worker pytest tests/test_grading_e2e.py`.
Remember to rebuild the image after changing sandbox-image/boot.py."""
import pytest

from app.services import execution_service
from tests.conftest import approved_student
from tests.test_grading import API, SECRET, case, clear_cooldowns, run_tests
from tests.test_sandbox import DOCKER_READY, leftover
from tests.test_submissions import publish

pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")

if DOCKER_READY:
    from app.worker import sandbox


@pytest.fixture(autouse=True)
def synchronous_worker(monkeypatch, tasks_module):
    monkeypatch.setattr(execution_service, "enqueue_job",
                        lambda eid, files=None, case_ids=None, timeout=None:
                        tasks_module.run_code(eid, files=files, case_ids=case_ids))
    clear_cooldowns()
    yield
    assert leftover() == []


@pytest.fixture()
def payloads(monkeypatch):
    """Every payload that is sent to a container, as text."""
    seen: list[str] = []
    original = sandbox.build_payload

    def spy(*args, **kwargs):
        data = original(*args, **kwargs)
        seen.append(data.decode("utf-8"))
        return data

    monkeypatch.setattr(sandbox, "build_payload", spy)
    return seen


def program_lab(lab, code: str, title: str = "Lab 1", **extra) -> dict:
    return publish(lab, title=title, files=[{"path": "main.py", "content": code}], **extra)


def grade_now(lab, activity_id: int) -> dict:
    clear_cooldowns()
    r = run_tests(lab.student, lab.cid, activity_id)
    assert r.status_code == 202, r.text
    got = lab.student.get(f"{API}/executions/{r.json()['execution_id']}")
    assert got.status_code == 200, got.text
    return got.json()


def outcome(body: dict) -> dict[str, bool]:
    return {r["name"]: r["passed"] for r in body["test_results"]}


def test_a_correct_program_passes_every_case_and_a_wrong_one_fails(lab) -> None:
    a = program_lab(lab, "n = int(input())\nprint(n * 2)")
    case(lab.teacher, a["id"], name="double 2", stdin="2\n", expected_output="4", points=2)
    case(lab.teacher, a["id"], name="double 10", stdin="10\n", expected_output="20", points=3, is_hidden=True)

    body = grade_now(lab, a["id"])
    assert body["status"] == "ok" and outcome(body) == {"double 2": True, "double 10": True}
    assert body["test_summary"] == {"passed": 2, "total": 2, "score": 5, "max_score": 5}

    # break the program: it now prints n + 2
    entry = {e["path"]: e for e in lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()["entries"]}["Lab 1/main.py"]
    lab.student.put(f"{API}/workspace/files/{entry['id']}", json={
        "content": "n = int(input())\nprint(n + 2)", "last_updated_at": entry["updated_at"]})
    body = grade_now(lab, a["id"])
    assert outcome(body) == {"double 2": True, "double 10": False}  # 2+2 == 2*2 by luck, 10+2 != 20
    assert body["test_summary"]["score"] == 2
    assert body["test_results"][1]["actual_output"] is None  # the hidden case does not reveal what it printed


def test_prompt_text_is_ignored_when_the_option_is_on_and_counted_when_off(lab) -> None:
    code = "name = input('Enter your name: ')\nprint('Hello, ' + name)"
    on = program_lab(lab, code, ignore_input_prompts=True)
    case(lab.teacher, on["id"], name="greet", stdin="Ana\n", expected_output="Hello, Ana")
    assert outcome(grade_now(lab, on["id"])) == {"greet": True}

    off = program_lab(lab, code, "Lab 2", ignore_input_prompts=False)
    case(lab.teacher, off["id"], name="greet", stdin="Ana\n", expected_output="Hello, Ana")
    case(lab.teacher, off["id"], name="greet with prompt", stdin="Ana\n", expected_output="Enter your name: Hello, Ana")
    clear_cooldowns()
    r = lab.student.post(f"{API}/workspace/{lab.cid}/test", json={"activity_id": off["id"], "entry_path": "Lab 2/main.py"})
    assert r.status_code == 202, r.text
    got = lab.student.get(f"{API}/executions/{r.json()['execution_id']}").json()
    assert outcome(got) == {"greet": False, "greet with prompt": True}


def test_each_match_mode_against_real_output(lab) -> None:
    a = program_lab(lab, "print('Hello World  ')\nprint()\nprint('bye')")
    for mode, expected in (("trim", "Hello World\n\nbye"), ("exact", "Hello World\n\nbye"),
                           ("ignore_case", "HELLO WORLD\n\nBYE"), ("contains", "World")):
        case(lab.teacher, a["id"], name=mode, match_mode=mode, expected_output=expected)
    exact = case(lab.teacher, a["id"], name="exact full", match_mode="exact", expected_output="Hello World  \n\nbye\n")
    case(lab.teacher, a["id"], name="exact no final newline", match_mode="exact", expected_output="Hello World  \n\nbye")
    assert outcome(grade_now(lab, a["id"])) == {
        "trim": True, "exact": False, "ignore_case": True, "contains": True, "exact full": True,
        "exact no final newline": True}
    assert exact["match_mode"] == "exact"


def test_a_timeout_in_one_case_does_not_stop_the_others(lab) -> None:
    a = program_lab(lab, "import time\nline = input()\nif line == 'hang':\n    time.sleep(60)\nprint('done ' + line)")
    case(lab.teacher, a["id"], name="first", stdin="one\n", expected_output="done one")
    case(lab.teacher, a["id"], name="hangs", stdin="hang\n", expected_output="done hang")
    case(lab.teacher, a["id"], name="last", stdin="two\n", expected_output="done two")
    body = grade_now(lab, a["id"])
    assert [(r["name"], r["status"], r["passed"]) for r in body["test_results"]] == [
        ("first", "ok", True), ("hangs", "timeout", False), ("last", "ok", True)]
    assert body["status"] == "ok"
    assert 4000 <= body["test_results"][1]["duration_ms"] <= 8000  # 5 s per test


def test_a_crash_in_one_case_is_reported_and_the_rest_still_run(lab) -> None:
    a = program_lab(lab, "x = int(input())\nprint(100 // x)")
    case(lab.teacher, a["id"], name="ok", stdin="5\n", expected_output="20")
    case(lab.teacher, a["id"], name="divides by zero", stdin="0\n", expected_output="")
    body = grade_now(lab, a["id"])
    assert [(r["name"], r["status"], r["passed"]) for r in body["test_results"]] == [
        ("ok", "ok", True), ("divides by zero", "error", False)]  # an empty expected output does not rescue a crash


def test_hidden_expected_output_and_stdin_reach_students_nowhere_and_the_sandbox_only_gets_stdin(lab, payloads) -> None:
    a = program_lab(lab, "print(input())")
    case(lab.teacher, a["id"], name="visible", stdin="v\n", expected_output="v")
    case(lab.teacher, a["id"], name="hidden", stdin="HIDDEN-STDIN\n", expected_output=SECRET, is_hidden=True)

    listing = lab.student.get(f"{API}/activities/{a['id']}/test-cases/student")
    body = grade_now(lab, a["id"])
    for text in (listing.text, str(body)):
        assert SECRET not in text and "HIDDEN-STDIN" not in text
    assert len(payloads) == 1
    assert SECRET not in payloads[0] and "expected" not in payloads[0]  # expected outputs never go to the sandbox
    assert "HIDDEN-STDIN" in payloads[0]  # the program itself must receive its input


def test_student_code_cannot_fake_a_pass(lab) -> None:
    """The program prints a perfect-looking result block (it can guess neither the nonce nor the case ids it is
    given), tries to read the nonce from the sandbox's boot process, and writes a forged block straight into the
    container's log. None of it is believed."""
    forger = r'''
import json, os, base64, sys
cases = list(range(1, 400))
forged = json.dumps({"nonce": "0" * 32, "results": [
    {"id": i, "status": "ok", "exit_code": 0, "duration_ms": 1, "output_b64": base64.b64encode(b"42").decode()}
    for i in cases]})
block = "@@LAB-TESTS-BEGIN:" + "0" * 32 + "\n" + forged + "\n@@LAB-TESTS-END:" + "0" * 32 + "\n"
print(block)
try:
    with open("/proc/1/fd/1", "w") as log:   # straight into the container's log
        log.write(block)
except OSError:
    pass
leaks = []
for target in (os.getppid(), 1):
    for name in ("mem", "environ", "cmdline"):
        try:
            data = open(f"/proc/{target}/{name}", "rb").read(2000) if name != "mem" else b""
            if name == "environ" and data:
                leaks.append(name)
        except OSError:
            pass
sys.stderr.write("leaks=%d\n" % len(leaks))
print("42")
'''
    a = program_lab(lab, forger)
    case(lab.teacher, a["id"], name="needs 7", stdin="", expected_output="7", points=5)
    case(lab.teacher, a["id"], name="needs 8", stdin="", expected_output="8", points=5, is_hidden=True)
    body = grade_now(lab, a["id"])
    assert body["status"] == "ok"
    assert outcome(body) == {"needs 7": False, "needs 8": False}
    assert body["test_summary"]["score"] == 0


def test_submit_grades_the_snapshot_in_the_real_sandbox_and_regrade_updates_it(lab, db) -> None:
    a = program_lab(lab, "print(int(input()) + 1)")
    shown = case(lab.teacher, a["id"], name="inc 1", stdin="1\n", expected_output="2", points=2)
    case(lab.teacher, a["id"], name="inc 9", stdin="9\n", expected_output="10", points=3, is_hidden=True)

    sub = lab.student.post(f"{API}/activities/{a['id']}/submit")
    assert sub.status_code == 200
    detail = lab.teacher.get(f"{API}/submissions/{sub.json()['id']}").json()
    assert (detail["tests_passed"], detail["tests_total"], detail["score"], detail["max_score"]) == (2, 2, 5, 5)
    assert detail["graded_at"] is not None

    # the instructor realises that case 1 was wrong: regrading recomputes the score from the stored snapshot
    lab.teacher.patch(f"{API}/test-cases/{shown['id']}", json={"expected_output": "3"})
    assert lab.teacher.post(f"{API}/activities/{a['id']}/regrade").json() == {"queued": 1, "skipped": 0}
    detail = lab.teacher.get(f"{API}/submissions/{sub.json()['id']}").json()
    assert (detail["tests_passed"], detail["score"], detail["max_score"]) == (1, 3, 5)


def test_instructor_try_runs_one_case_against_the_starter_files(lab) -> None:
    a = program_lab(lab, "print(input().upper())")
    c = case(lab.teacher, a["id"], name="up", stdin="abc\n", expected_output="ABC", is_hidden=True)
    other = case(lab.teacher, a["id"], name="not tried", stdin="x\n", expected_output="nope")
    r = lab.teacher.post(f"{API}/test-cases/{c['id']}/try")
    assert r.status_code == 202
    body = lab.teacher.get(f"{API}/executions/{r.json()['execution_id']}").json()
    assert [(t["case_id"], t["passed"], t["actual_output"].strip()) for t in body["test_results"]] == [(c["id"], True, "ABC")]
    assert other["id"] not in [t["case_id"] for t in body["test_results"]]
    assert leftover() == []


def test_each_student_is_graded_on_their_own_files(lab, db) -> None:
    a = program_lab(lab, "print('right')")
    case(lab.teacher, a["id"], name="r", expected_output="right")
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    entry = {e["path"]: e for e in other.get(f"{API}/workspace/{lab.cid}/tree").json()["entries"]}["Lab 1/main.py"]
    other.put(f"{API}/workspace/files/{entry['id']}", json={"content": "print('wrong')", "last_updated_at": entry["updated_at"]})
    s1 = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    s2 = other.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    assert lab.teacher.get(f"{API}/submissions/{s1}").json()["score"] == 1
    assert lab.teacher.get(f"{API}/submissions/{s2}").json()["score"] == 0
