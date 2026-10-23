"""Activity tests against hardcoded answers: a case with input passes only if the program read all of it
(require_input_read), an activity's code requirements fail every case before anything runs, and a submission whose
code holds a hidden case's expected output as a string is flagged for the instructor. The real sandbox is covered in
test_anti_hardcode_e2e.py; here the sandbox is a fake that answers like boot.py."""
import base64
import json

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.test_case import MatchMode
from app.models.user import Role
from app.services import grading_service as g
from tests.conftest import login_as
from tests.test_grading import API, case, clear_cooldowns, execution_of, jobs, run_tests  # noqa: F401
from tests.test_submissions import edit, publish


def C(id=1, name="c", stdin="", expected="", hidden=False, require=True, points=1) -> g.CaseData:
    return g.CaseData(id=id, name=name, stdin=stdin, expected=expected, is_hidden=hidden, points=points,
                      match_mode=MatchMode.TRIM, require_input_read=require)


def got(output="", status="ok", given=None, read=None) -> dict:
    return {"status": status, "exit_code": 0, "duration_ms": 5, "output": output, "lines_given": given,
            "lines_read": read}


# =========================================================================== reading all the input (engine)

def test_a_case_with_input_passes_only_if_all_of_it_was_read() -> None:
    cases = [C(1, "a", "2\n3\n", "5"), C(2, "b", "2\n3\n", "5"), C(3, "c", "2\n3\n", "5")]
    results, summary = g.build_results(cases, {1: got("5", given=2, read=2), 2: got("5", given=2, read=0),
                                               3: got("5", given=2, read=1)})
    assert [(r["passed"], r["status"]) for r in results] == [
        (True, "ok"), (False, "input_not_read"), (False, "input_not_read")]
    assert results[1]["message"] == "Your program did not read all the input (read 0 of 2 values)."
    assert results[2]["message"] == "Your program did not read all the input (read 1 of 2 values)."
    assert (results[0]["lines_read"], results[0]["lines_given"], results[0]["message"]) == (2, 2, None)
    assert (summary.passed, summary.score) == (1, 1)


def test_the_check_is_skipped_without_input_when_off_or_without_counts() -> None:
    results, _ = g.build_results(
        [C(1, stdin="", expected="hi"), C(2, stdin="7\n", expected="7", require=False), C(3, stdin="7\n", expected="7")],
        {1: got("hi", given=0, read=0), 2: got("7", given=1, read=0), 3: got("7")})   # 3: an old sandbox image
    assert [r["passed"] for r in results] == [True, True, True]


def test_a_crash_keeps_its_own_status_and_a_wrong_answer_that_ignored_input_says_so() -> None:
    results, _ = g.build_results([C(1, stdin="1\n", expected="1"), C(2, stdin="1\n", expected="1")],
                                 {1: got("Traceback", status="error", given=1, read=0), 2: got("9", given=1, read=0)})
    assert [r["status"] for r in results] == ["error", "input_not_read"]


def test_the_counts_come_only_from_the_nonce_framed_block() -> None:
    nonce = "n" * 32
    block = json.dumps({"nonce": nonce, "results": [{
        "id": 1, "status": "ok", "exit_code": 0, "duration_ms": 3, "lines_given": 2, "lines_read": 2,
        "output_b64": base64.b64encode(b"5").decode()}]})
    fake = json.dumps({"nonce": "x" * 32, "results": [{"id": 1, "status": "ok", "lines_read": 9, "output_b64": ""}]})
    out = (f"{g.START_MARKER}{'x' * 32}\n{fake}\n{g.END_MARKER}{'x' * 32}\n"          # printed by the program
           f"{g.START_MARKER}{nonce}\n{block}\n{g.END_MARKER}{nonce}\n")
    assert g.parse_block(out, nonce)[1]["lines_read"] == 2
    bad = block.replace('"lines_read": 2', '"lines_read": "2"')
    assert g.parse_block(f"{g.START_MARKER}{nonce}\n{bad}\n{g.END_MARKER}{nonce}\n", nonce)[1]["lines_read"] is None


# =========================================================================== code requirements (engine)

AVERAGE = '''
import math
def average(nums):
    total = 0
    for n in nums:
        total += n
    return total / len(nums)
items = sorted([3, 1, 2])
print(items.index(2), average(items))
'''


@pytest.mark.parametrize("requirement, problems", [
    ({"must_define_functions": ["average"]}, []),
    ({"must_define_functions": ["average", "median"]}, ["Define a function named median()."]),
    ({"must_use": ["for", "def"]}, []),
    ({"must_use": ["while"]}, ["Use a while loop."]),
    ({"must_use": ["if", "class"]}, ["Use an if statement.", "Use a class."]),
    ({"must_not_use_calls": [".index"]}, ["Do not use .index()."]),
    ({"must_not_use_calls": ["sorted"]}, ["Do not use sorted()."]),
    ({"must_not_use_calls": [".sort", "max", "index"]}, []),      # index() as a plain function is not called
    ({"must_not_use_imports": ["math"]}, ["Do not import math."]),
    ({"must_not_use_imports": ["statistics", "mat"]}, []),
])
def test_each_requirement_rule(requirement, problems) -> None:
    assert g.check_requirements(requirement, {"Lab 1/main.py": AVERAGE}) == problems


def test_requirement_details() -> None:
    files = {"Lab 1/main.py": "from os.path import join\nimport collections.abc\nx = [i for i in range(3)]\n",
             "Lab 1/helpers.py": "def helper():\n    return 1 if True else 2\n"}
    assert g.check_requirements({"must_not_use_imports": ["os"], "must_use": ["for", "if", "def"],
                                 "must_define_functions": ["helper"]}, files) == ["Do not import os."]
    assert g.check_requirements({"must_not_use_imports": ["collections"]}, files) == ["Do not import collections."]
    assert g.check_requirements({"must_use": ["while"]}, {"m.py": "def broken(:\n"}) == []   # not valid Python
    assert g.check_requirements(None, files) == [] and g.check_requirements({}, files) == []
    # only the activity folder of the entry file is checked
    picked = g.python_files_in([{"path": "Lab 1/main.py", "content": "a"}, {"path": "Lab 1/sub/u.py", "content": "b"},
                                {"path": "Lab 2/main.py", "content": "c"}, {"path": "Lab 1/data.txt", "content": "d"},
                                {"path": "scratch.py", "content": "e"}], "Lab 1/main.py")
    assert sorted(picked) == ["Lab 1/main.py", "Lab 1/sub/u.py"]


# =========================================================================== hardcoded answers (engine)

HIDDEN = [C(1, "secret total", "1 2 3\n", "The total is 6\n6", hidden=True),
          C(2, "secret number", "5\n", "25", hidden=True),
          C(3, "shown", "2\n", "The total is 2", hidden=False)]


def test_the_flag_is_set_when_a_hidden_expected_line_is_a_string_in_the_code() -> None:
    hard = {"Lab 1/main.py": 'input()\nprint("The total is 6")\n'}
    assert g.hardcoded_cases(HIDDEN, hard) == ["secret total"]
    inside = {"Lab 1/main.py": 'MSG = """Results:\nThe total is 6\n"""\nprint(MSG)\n'}
    assert g.hardcoded_cases(HIDDEN, inside) == ["secret total"]


def test_the_flag_is_not_set_otherwise() -> None:
    honest = {"Lab 1/main.py": 'nums = map(int, input().split())\nprint("The total is", sum(nums))\n'}
    assert g.hardcoded_cases(HIDDEN, honest) == []
    number_only = {"Lab 1/main.py": 'print("25")\nprint("6")\n'}                        # numbers never count
    assert g.hardcoded_cases(HIDDEN, number_only) == []
    shown_only = {"Lab 1/main.py": 'print("The total is 2")\n'}                         # a visible case is fine
    assert g.hardcoded_cases(HIDDEN, shown_only) == []
    hard = {"Lab 1/main.py": 'print("The total is 6")\n'}
    assert g.hardcoded_cases(HIDDEN, hard, allowed_text="Print: The total is 6 for the sample") == []  # instructions
    assert g.hardcoded_cases(HIDDEN, hard, allowed_sources={"main.py": 'print("The total is 6")'}) == []  # starter
    assert g.hardcoded_cases(HIDDEN, {"Lab 1/main.py": "print('The total is 6'"}) == []   # not valid Python


# =========================================================================== through the API and the worker

def block(tests, nonce, answer) -> str:
    """What boot.py prints. answer(stdin) -> (status, output, lines_read)."""
    results = []
    for t in tests:
        status, output, read = answer(t["stdin"])
        given = len([line for line in t["stdin"].splitlines()])
        results.append({"id": t["id"], "status": status, "exit_code": 0, "duration_ms": 9, "lines_given": given,
                        "lines_read": read, "output_b64": base64.b64encode(output.encode()).decode()})
    return f"{g.START_MARKER}{nonce}\n{json.dumps({'nonce': nonce, 'results': results})}\n{g.END_MARKER}{nonce}\n"


class Sandbox:
    def __init__(self, tasks) -> None:
        self.tasks, self.calls, self.answer = tasks, [], lambda stdin: ("ok", "", 0)

    def __call__(self, files, entry, stdin="", on_output=None, *, tests=None, nonce=None, ignore_input_prompts=True,
                 timeout_sec=None):
        self.calls.append({"files": files, "tests": tests})
        return self.tasks.RunResult("ok", 0, block(tests, nonce, self.answer), 50)


@pytest.fixture()
def sandbox(tasks_module, monkeypatch):
    fake = Sandbox(tasks_module)
    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake)
    return fake


def doubling_activity(lab, **extra):
    a = publish(lab, title="Lab 1", files=[{"path": "main.py", "content": "n = int(input())\nprint(n * 2)\n"}],
                instructions="Read a number and print it doubled.", **extra)
    case(lab.teacher, a["id"], name="sample", stdin="2\n", expected_output="4")
    case(lab.teacher, a["id"], name="secret", stdin="21\n", expected_output="Doubled: 42", is_hidden=True)
    return a


def test_require_input_read_is_on_by_default_and_can_be_switched_off(lab) -> None:
    a = publish(lab, title="Lab 1", files=[{"path": "main.py", "content": "print(1)"}])
    c = case(lab.teacher, a["id"], name="x", stdin="1\n", expected_output="1")
    assert c["require_input_read"] is True
    r = lab.teacher.patch(f"{API}/test-cases/{c['id']}", json={"require_input_read": False})
    assert r.status_code == 200 and r.json()["require_input_read"] is False
    assert case(lab.teacher, a["id"], name="y", require_input_read=False)["require_input_read"] is False


def test_a_hardcoded_answer_fails_the_test_button_with_input_not_read(lab, db: Session, jobs, sandbox,
                                                                      tasks_module) -> None:
    a = doubling_activity(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "Doubled: 42", 0)     # printed without input()
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    body = lab.student.get(f"{API}/executions/{eid}").json()
    assert [(r["name"], r["passed"], r["status"]) for r in body["test_results"]] == [
        ("sample", False, "input_not_read"), ("secret", False, "input_not_read")]
    assert body["test_results"][0]["message"] == "Your program did not read all the input (read 0 of 1 values)."
    assert body["test_results"][1]["actual_output"] is None                  # a hidden case still shows nothing

    clear_cooldowns()
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "Doubled: 42", 1)     # now it reads its input
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    assert [r["passed"] for r in lab.student.get(f"{API}/executions/{eid}").json()["test_results"]] == [True, True]


# ----------------------------------------------------------------------------------------- requirements

def test_requirements_crud(lab, db: Session) -> None:
    a = doubling_activity(lab)
    url = f"{API}/activities/{a['id']}/requirements"
    empty = {"must_define_functions": [], "must_use": [], "must_not_use_calls": [], "must_not_use_imports": []}
    assert lab.teacher.get(url).json() == empty
    body = {"must_define_functions": ["double", " double "], "must_use": ["def", "if"],
            "must_not_use_calls": [".index", "sorted"], "must_not_use_imports": ["math", "os.path"]}
    r = lab.teacher.put(url, json=body)
    assert r.status_code == 200 and r.json()["must_define_functions"] == ["double"]   # trimmed, no duplicates
    assert lab.teacher.get(url).json()["must_not_use_calls"] == [".index", "sorted"]
    # the activity shows them, to its students too (they are part of the instructions)
    assert lab.teacher.get(f"{API}/activities/{a['id']}").json()["requirements"]["must_use"] == ["def", "if"]
    assert lab.student.get(f"{API}/activities/{a['id']}").json()["requirements"]["must_use"] == ["def", "if"]
    for bad in ({"must_use": ["goto"]}, {"must_define_functions": ["2bad"]}, {"must_not_use_calls": ["a.b"]},
                {"must_not_use_imports": ["os path"]}, {"must_avoid": []}):
        assert lab.teacher.put(url, json=bad).status_code == 422, bad
    assert lab.student.put(url, json=body).status_code == 403
    assert lab.student.get(url).status_code == 403
    assert login_as(db, Role.INSTRUCTOR, "teach2").put(url, json=body).status_code in (403, 404)
    assert lab.teacher.delete(url).status_code == 204
    assert lab.teacher.get(url).json() == empty
    assert lab.teacher.get(f"{API}/activities/{a['id']}").json()["requirements"] is None
    assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "activity_update")) is not None


def test_a_violation_fails_every_case_without_running_anything(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a = doubling_activity(lab)
    lab.teacher.put(f"{API}/activities/{a['id']}/requirements",
                    json={"must_define_functions": ["double"], "must_not_use_calls": ["int"]})
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    body = lab.student.get(f"{API}/executions/{eid}").json()
    message = ("Your code does not meet the activity's requirements: Define a function named double(). "
               "Do not use int().")
    assert [(r["status"], r["passed"], r["message"]) for r in body["test_results"]] == [
        ("requirement_failed", False, message)] * 2
    assert body["test_summary"]["passed"] == 0 and sandbox.calls == []       # the sandbox was never used

    clear_cooldowns()
    lab.teacher.put(f"{API}/activities/{a['id']}/requirements", json={"must_define_functions": ["double"]})
    edit(lab.student, lab.cid, "Lab 1/main.py", "def double(n):\n    return n * 2\nprint(double(int(input())))\n")
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "Doubled: 42", 1)
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    assert [r["status"] for r in lab.student.get(f"{API}/executions/{eid}").json()["test_results"]] == ["ok", "ok"]
    assert len(sandbox.calls) == 1


def test_a_violation_scores_a_submission_zero(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a = doubling_activity(lab)
    lab.teacher.put(f"{API}/activities/{a['id']}/requirements", json={"must_use": ["while"]})
    sid = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    tasks_module.run_code(jobs[-1]["execution_id"])
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()
    assert (detail["tests_passed"], detail["score"], detail["max_score"]) == (0, 0, 2)
    assert detail["hardcode_suspected"] is False


# ----------------------------------------------------------------------------------------- hardcoding flag

def submit_code(lab, a, code: str) -> int:
    edit(lab.student, lab.cid, "Lab 1/main.py", code)
    return lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]


def test_the_grade_flags_a_hidden_answer_written_into_the_code(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a = doubling_activity(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "Doubled: 42", 1)
    sid = submit_code(lab, a, 'n = int(input())\nprint("Doubled: 42" if n == 21 else n * 2)\n')
    tasks_module.run_code(jobs[-1]["execution_id"])
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()
    assert detail["score"] == 2                                       # no automatic fail: only a flag
    assert (detail["hardcode_suspected"], detail["hardcode_tests"]) == (True, ["secret"])
    row = lab.teacher.get(f"{API}/activities/{a['id']}/submissions").json()["items"][0]
    assert (row["hardcode_suspected"], row["hardcode_tests"]) == (True, ["secret"])
    mine = lab.student.get(f"{API}/submissions/{sid}").json()
    assert mine["hardcode_suspected"] is None and mine["hardcode_tests"] is None    # never shown to the student

    # an honest resubmission clears it
    sid = submit_code(lab, a, 'n = int(input())\nprint("Doubled:", n * 2) if n > 9 else print(n * 2)\n')
    assert lab.teacher.get(f"{API}/submissions/{sid}").json()["hardcode_suspected"] is False   # cleared at once
    tasks_module.run_code(jobs[-1]["execution_id"])
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()
    assert (detail["hardcode_suspected"], detail["hardcode_tests"]) == (False, None)


def test_the_test_button_never_sets_the_flag(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    from app.models.submission import Submission

    a = doubling_activity(lab)
    edit(lab.student, lab.cid, "Lab 1/main.py", 'print("Doubled: 42")\n')
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)
    assert db.scalar(select(Submission.id)) is None
