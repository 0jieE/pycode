"""Against hardcoded answers, through the REAL sandbox (boot.py counts the input lines a program takes from its
pipe). Needs the Docker socket: `docker compose exec worker pytest tests/test_anti_hardcode_e2e.py`, and the image
rebuilt after changing sandbox-image/boot.py."""
import pytest

from tests.test_grading import API, case
from tests.test_grading_e2e import grade_now, program_lab, synchronous_worker  # noqa: F401
from tests.test_sandbox import DOCKER_READY
from tests.test_submissions import edit

pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")

SUM_CASES = [("small", "2\n3\n", "5"), ("big", "40\n2\n", "42")]


def sum_lab(lab, code: str, **case_extra) -> dict:
    a = program_lab(lab, code)
    for name, stdin, expected in SUM_CASES:
        case(lab.teacher, a["id"], name=name, stdin=stdin, expected_output=expected, **case_extra)
    return a


def verdicts(body: dict) -> list[tuple]:
    return [(r["name"], r["passed"], r["status"], r["lines_read"], r["lines_given"]) for r in body["test_results"]]


def test_printing_the_expected_answer_without_input_fails(lab) -> None:
    a = sum_lab(lab, "print(5)")
    body = grade_now(lab, a["id"])
    assert verdicts(body) == [("small", False, "input_not_read", 0, 2), ("big", False, "input_not_read", 0, 2)]
    assert body["test_results"][0]["actual_output"].strip() == "5"            # it did print the right answer...
    assert body["test_results"][0]["message"] == "Your program did not read all the input (read 0 of 2 values)."


def test_a_correct_program_passes(lab) -> None:
    a = sum_lab(lab, "a = int(input())\nb = int(input())\nprint(a + b)")
    assert verdicts(grade_now(lab, a["id"])) == [("small", True, "ok", 2, 2), ("big", True, "ok", 2, 2)]


def test_reading_only_part_of_the_input_fails(lab) -> None:
    a = sum_lab(lab, "a = int(input())\nprint(a + 3)")                         # right for "small" by luck
    body = grade_now(lab, a["id"])
    assert verdicts(body) == [("small", False, "input_not_read", 1, 2), ("big", False, "input_not_read", 1, 2)]
    assert body["test_results"][0]["message"] == "Your program did not read all the input (read 1 of 2 values)."


@pytest.mark.parametrize("code", [
    "import sys\nprint(sum(int(x) for x in sys.stdin.read().split()))",
    "import sys\nprint(sum(int(line) for line in sys.stdin))",
    "import sys\nprint(int(sys.stdin.readline()) + int(sys.stdin.readline()))",
    "import sys\nprint(sum(int(x) for x in sys.stdin.readlines()))",
])
def test_every_way_of_reading_counts(lab, code) -> None:
    a = sum_lab(lab, code)
    assert verdicts(grade_now(lab, a["id"])) == [("small", True, "ok", 2, 2), ("big", True, "ok", 2, 2)]


def test_a_trailing_blank_line_in_the_input_is_not_required(lab) -> None:
    a = program_lab(lab, "print(int(input()) * 2)")
    case(lab.teacher, a["id"], name="blank after", stdin="4\n\n\n", expected_output="8")
    assert verdicts(grade_now(lab, a["id"])) == [("blank after", True, "ok", 1, 1)]


def test_the_check_can_be_switched_off_per_case(lab) -> None:
    a = sum_lab(lab, "print(5)", require_input_read=False)
    assert [r["passed"] for r in grade_now(lab, a["id"])["test_results"]] == [True, False]   # 5 is right only once


def test_a_case_without_input_needs_no_reading(lab) -> None:
    a = program_lab(lab, "print('Hello, World!')")
    case(lab.teacher, a["id"], name="hello", stdin="", expected_output="Hello, World!")
    assert verdicts(grade_now(lab, a["id"])) == [("hello", True, "ok", 0, 0)]


def test_requirements_and_the_hardcoding_flag_with_the_real_sandbox(lab) -> None:
    a = sum_lab(lab, "a = int(input())\nb = int(input())\nprint(a + b)")
    case(lab.teacher, a["id"], name="hidden words", stdin="1\n1\n", expected_output="Answer: 2", is_hidden=True)
    lab.teacher.put(f"{API}/activities/{a['id']}/requirements", json={"must_define_functions": ["add"]})
    body = grade_now(lab, a["id"])
    assert {r["status"] for r in body["test_results"]} == {"requirement_failed"}

    edit(lab.student, lab.cid, "Lab 1/main.py",
         'def add(a, b):\n    return a + b\na, b = int(input()), int(input())\n'
         'print("Answer: 2" if (a, b) == (1, 1) else add(a, b))\n')
    sid = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    detail = lab.teacher.get(f"{API}/submissions/{sid}").json()               # graded synchronously here
    assert (detail["tests_passed"], detail["tests_total"]) == (3, 3)
    assert (detail["hardcode_suspected"], detail["hardcode_tests"]) == (True, ["hidden words"])
