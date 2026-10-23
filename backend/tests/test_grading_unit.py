"""Automatic grading, pure logic: match modes, the sandbox's result block, scoring and redaction (no DB, no Docker)."""
import base64
import json

import pytest

from app.models.test_case import MatchMode
from app.services import grading_service as g
from app.services.grading_service import CaseData

NONCE = "a" * 32


def framed(nonce: str, results: list[dict], inner_nonce: str | None = None) -> str:
    block = json.dumps({"nonce": inner_nonce or nonce, "results": results})
    return f"noise\n{g.START_MARKER}{nonce}\n{block}\n{g.END_MARKER}{nonce}\n"


def item(case_id: int, output: str = "", status: str = "ok", ms: int = 10) -> dict:
    return {"id": case_id, "status": status, "exit_code": 0, "duration_ms": ms,
            "output_b64": base64.b64encode(output.encode()).decode()}


def case(case_id: int = 1, expected: str = "42", mode: MatchMode = MatchMode.TRIM, points: int = 1,
         hidden: bool = False) -> CaseData:
    return CaseData(id=case_id, name=f"case {case_id}", stdin="", expected=expected, is_hidden=hidden,
                    points=points, match_mode=mode)


# ------------------------------------------------------------------ match modes

@pytest.mark.parametrize("actual,expected,ok", [
    ("42", "42", True),
    ("42\n", "42", True),                       # trailing newline
    ("42\r\n", "42\n", True),                   # CRLF
    ("a  \nb \n\n\n", "a\nb", True),            # trailing spaces per line + trailing blank lines
    ("42", "42\n\n", True),
    (" 42", "42", False),                       # leading space still counts
    ("a  b", "a b", False),                     # inner spacing still counts
    ("Hello", "hello", False),                  # case matters in trim mode
    ("a\n\nb", "a\nb", False),                  # inner blank lines still count
])
def test_trim_mode(actual: str, expected: str, ok: bool) -> None:
    assert g.outputs_match(MatchMode.TRIM, actual, expected) is ok


@pytest.mark.parametrize("actual,expected,ok", [
    ("42", "42", True),
    ("Hello World\n", "Hello World", True),     # print() adds one final newline: not significant
    ("Hello World", "Hello World\n", True),
    ("Hello World\r\n", "Hello World", True),   # CRLF is converted first
    ("42\r\n", "42\n", True),
    ("42\n\n", "42", False),                    # a second line break is an extra blank line: still counts
    ("42\n\n", "42\n", False),
    ("42 \n", "42", False),                     # spaces still count
    ("42 ", "42", False),
    ("Hello", "hello", False),                  # capitals still count
    ("a\n\nb", "a\nb", False),
])
def test_exact_mode(actual: str, expected: str, ok: bool) -> None:
    assert g.outputs_match(MatchMode.EXACT, actual, expected) is ok


@pytest.mark.parametrize("actual,expected,ok", [
    ("HELLO World\n", "hello world", True),     # trim + casefold
    ("Straße", "STRASSE", True),                # casefold, not just lower()
    ("hello  \r\n\n", "HELLO", True),
    ("hello world", "hello", False),            # not a substring match
])
def test_ignore_case_mode(actual: str, expected: str, ok: bool) -> None:
    assert g.outputs_match(MatchMode.IGNORE_CASE, actual, expected) is ok


@pytest.mark.parametrize("actual,expected,ok", [
    ("The answer is 42.\n", "42", True),
    ("x\r\nResult: 7  \nend", "Result: 7\nend", True),   # both sides are trimmed first
    ("The answer is 43", "42", False),
    ("The Answer", "answer", False),            # contains is case sensitive
])
def test_contains_mode(actual: str, expected: str, ok: bool) -> None:
    assert g.outputs_match(MatchMode.CONTAINS, actual, expected) is ok


def test_overall_timeout_formula() -> None:
    assert [g.overall_timeout(n) for n in (1, 2, 10, 11, 20)] == [10, 15, 55, 60, 60]


# ------------------------------------------------------------ the sandbox's block

def test_parse_block_reads_a_correct_block() -> None:
    parsed = g.parse_block(framed(NONCE, [item(1, "42\n"), item(2, "", "timeout")]), NONCE)
    assert parsed[1]["output"] == "42\n" and parsed[1]["status"] == "ok" and parsed[1]["duration_ms"] == 10
    assert parsed[2]["status"] == "timeout"


def test_a_block_with_another_nonce_is_ignored() -> None:
    assert g.parse_block(framed("b" * 32, [item(1, "42")]), NONCE) is None


def test_a_block_whose_inner_nonce_differs_is_ignored() -> None:
    assert g.parse_block(framed(NONCE, [item(1, "42")], inner_nonce="c" * 32), NONCE) is None


def test_output_without_a_block_is_ignored() -> None:
    assert g.parse_block("42\nall tests passed\n", NONCE) is None
    assert g.parse_block("", NONCE) is None


def test_a_forged_block_printed_without_the_nonce_cannot_pass() -> None:
    """The student does not know the nonce, so the best they can do is guess one."""
    forged = framed("0" * 32, [item(1, "42")])
    assert g.parse_block(forged, NONCE) is None


def test_the_last_genuine_block_wins_over_an_earlier_copy() -> None:
    """Even if the nonce somehow leaked into text printed EARLIER, the sandbox's own block is the last thing printed."""
    fake_first = framed(NONCE, [item(1, "WRONG")])
    real_last = framed(NONCE, [item(1, "42")])
    assert g.parse_block(fake_first + real_last, NONCE)[1]["output"] == "42"


def test_garbage_and_odd_values_are_handled() -> None:
    assert g.parse_block(f"{g.START_MARKER}{NONCE}\nnot json\n{g.END_MARKER}{NONCE}", NONCE) is None
    assert g.parse_block(f"{g.START_MARKER}{NONCE}\n[1,2]\n{g.END_MARKER}{NONCE}", NONCE) is None
    assert g.parse_block(f"{g.START_MARKER}{NONCE}\n{{}}", NONCE) is None  # no end marker
    odd = framed(NONCE, [{"id": "1", "status": "ok"}, {"id": True, "status": "ok"}, "x",
                         {"id": 3, "status": "weird", "output_b64": "!!notbase64"},
                         {"id": 4, "status": "ok", "exit_code": "0", "duration_ms": None, "output_b64": ""}])
    parsed = g.parse_block(odd, NONCE)
    assert set(parsed) == {3, 4}
    assert parsed[3]["status"] == "error" and parsed[3]["output"] == ""
    assert parsed[4]["exit_code"] is None and parsed[4]["duration_ms"] == 0


# ---------------------------------------------------------------------- scoring

def test_a_case_passes_only_when_the_run_was_ok_and_the_output_matches() -> None:
    cases = [case(1, "42", points=3), case(2, "42", points=2), case(3, "42", points=5), case(4, "42", points=1)]
    parsed = g.parse_block(framed(NONCE, [
        item(1, "42\n"),                    # pass
        item(2, "41"),                      # wrong output
        item(3, "42", status="error"),      # right output but the program crashed afterwards
        item(4, "42", status="timeout"),    # right output but it never finished
    ]), NONCE)
    results, summary = g.build_results(cases, parsed)
    assert [r["passed"] for r in results] == [True, False, False, False]
    assert [r["points_awarded"] for r in results] == [3, 0, 0, 0]
    assert summary == g.Summary(passed=1, total=4, score=3, max_score=11)
    assert [r["status"] for r in results] == ["ok", "ok", "error", "timeout"]


def test_zero_point_cases_can_pass_without_scoring() -> None:
    parsed = g.parse_block(framed(NONCE, [item(1, "42")]), NONCE)
    results, summary = g.build_results([case(1, "42", points=0)], parsed)
    assert results[0]["passed"] and summary == g.Summary(passed=1, total=1, score=0, max_score=0)


def test_missing_cases_fail_with_the_fallback_status() -> None:
    parsed = g.parse_block(framed(NONCE, [item(1, "42")]), NONCE)
    results, summary = g.build_results([case(1), case(2)], parsed, fallback_status="timeout")
    assert [r["status"] for r in results] == ["ok", "timeout"] and summary.passed == 1
    results, summary = g.build_results([case(1)], None, fallback_status="timeout")
    assert results[0]["status"] == "timeout" and summary.score == 0


def test_stored_output_is_cut_to_4_kb() -> None:
    parsed = g.parse_block(framed(NONCE, [item(1, "x" * 10_000)]), NONCE)
    results, _ = g.build_results([case(1, "x")], parsed)
    assert len(results[0]["actual_output"]) == g.ACTUAL_OUTPUT_LIMIT


def test_results_never_contain_the_expected_output() -> None:
    results, _ = g.build_results([case(1, "TOP-SECRET-EXPECTED")], g.parse_block(framed(NONCE, [item(1, "x")]), NONCE))
    assert "TOP-SECRET-EXPECTED" not in json.dumps(results)


# --------------------------------------------------------------------- redaction

def test_redaction_hides_what_a_hidden_case_printed() -> None:
    results = [{"case_id": 1, "is_hidden": False, "passed": False, "actual_output": "visible"},
               {"case_id": 2, "is_hidden": True, "passed": False, "actual_output": "secret"},
               {"case_id": 3, "passed": False, "actual_output": "no flag: treated as hidden"}]
    out = g.redact_for_student(results)
    assert [r["actual_output"] for r in out] == ["visible", None, None]
    assert results[1]["actual_output"] == "secret"  # the stored data is not modified
    assert g.redact_for_student(None) is None


def test_progress_events_carry_no_output() -> None:
    results, _ = g.build_results([case(1, "42", hidden=True)], g.parse_block(framed(NONCE, [item(1, "42")]), NONCE))
    assert g.progress_events(results) == [
        {"type": "test_result", "case_id": 1, "passed": True, "status": "ok", "duration_ms": 10}]
