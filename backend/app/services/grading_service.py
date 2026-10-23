"""Automatic grading: comparing outputs, reading the sandbox's result block, and scoring. Pure functions only (no
Docker, no database), so everything here is unit-testable.

How a test job works: the worker sends the sandbox the student's files plus, for each test case, ONLY its id and
stdin. The sandbox runs the program once per case and prints one JSON block framed by a random per-job nonce with each
run's raw output and how many input lines the program took (counted by boot.py outside the program). The expected
outputs never leave the database: the worker compares them here.

Against hardcoded answers: a case with stdin passes only if the program read all of it (require_input_read); an
activity's code requirements (check_requirements) fail every case before anything runs; and a submission whose code
contains a hidden case's expected output as a string is flagged for the instructor (hardcoded_cases).
"""
import ast
import base64
import binascii
import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Optional

from app.models.test_case import MatchMode

START_MARKER = "@@LAB-TESTS-BEGIN:"
END_MARKER = "@@LAB-TESTS-END:"

MAX_TEST_CASES = 20                  # per activity
MAX_TEXT_BYTES = 20 * 1024           # stdin and expected output, each
PER_TEST_TIMEOUT_SEC = 5             # enforced inside the sandbox (boot.py)
PER_TEST_OUTPUT_BYTES = 16 * 1024    # enforced inside the sandbox (boot.py)
ACTUAL_OUTPUT_LIMIT = 4096           # what is stored per case in executions.test_results

CASE_STATUSES = {"ok", "error", "timeout", "memory_exceeded", "output_limit"}   # what the sandbox may report
INPUT_NOT_READ = "input_not_read"           # set here: the program did not read all of its input
REQUIREMENT_FAILED = "requirement_failed"   # set here: the code does not meet the activity's requirements


def overall_timeout(test_count: int) -> int:
    """Seconds allowed for the whole container: min(5 s x tests + 5 s, 60 s)."""
    return min(PER_TEST_TIMEOUT_SEC * test_count + 5, 60)


# ----------------------------------------------------------------- comparing

def normalize_trim(text: str) -> str:
    """\\r\\n -> \\n, strip trailing spaces on every line, strip trailing blank lines."""
    lines = text.replace("\r\n", "\n").split("\n")
    return "\n".join(line.rstrip(" ") for line in lines).rstrip("\n")


def _drop_one_final_newline(text: str) -> str:
    """Exact mode: \\r\\n -> \\n, then ONE trailing line break is not significant (print() always ends with one, and an
    instructor rarely types it). Spaces, capitals and extra blank lines still count."""
    text = text.replace("\r\n", "\n")
    return text[:-1] if text.endswith("\n") else text


def outputs_match(mode: MatchMode, actual: str, expected: str) -> bool:
    if mode == MatchMode.EXACT:
        return _drop_one_final_newline(actual) == _drop_one_final_newline(expected)
    if mode == MatchMode.IGNORE_CASE:
        return normalize_trim(actual).casefold() == normalize_trim(expected).casefold()
    if mode == MatchMode.CONTAINS:
        return normalize_trim(expected) in normalize_trim(actual)
    return normalize_trim(actual) == normalize_trim(expected)  # TRIM (the default)


# ------------------------------------------------------------- the data model

@dataclass(frozen=True)
class CaseData:
    """A test case as the worker needs it. `expected` is only ever used for comparing, in the worker."""

    id: int
    name: str
    stdin: str
    expected: str
    is_hidden: bool
    points: int
    match_mode: MatchMode
    require_input_read: bool = False   # activity cases: on by default (test_cases.require_input_read)


@dataclass(frozen=True)
class Summary:
    passed: int
    total: int
    score: int
    max_score: int


# ------------------------------------------------------ the sandbox's answer

def parse_block(container_output: str, nonce: str) -> Optional[dict[int, dict[str, Any]]]:
    """case id -> {"status", "exit_code", "duration_ms", "output", "lines_given", "lines_read"} from the
    nonce-framed block, or None. The line counts are None when the sandbox did not report them.

    Only a block carrying THIS job's nonce counts. Anything else in the container's output (a program's own
    printing, text it injected into the log) is ignored, and so is a block with any other nonce."""
    begin = container_output.rfind(START_MARKER + nonce)
    if begin < 0:
        return None
    body_start = begin + len(START_MARKER) + len(nonce)
    end = container_output.find(END_MARKER + nonce, body_start)
    if end < 0:
        return None
    try:
        data = json.loads(container_output[body_start:end].strip())
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("nonce") != nonce or not isinstance(data.get("results"), list):
        return None

    parsed: dict[int, dict[str, Any]] = {}
    for item in data["results"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int) or isinstance(item.get("id"), bool):
            continue
        status = item.get("status")
        try:
            raw = base64.b64decode(item.get("output_b64") or "", validate=True)
        except (binascii.Error, ValueError, TypeError):
            raw = b""
            status = "error"
        exit_code = item.get("exit_code")
        duration = item.get("duration_ms")
        parsed[item["id"]] = {
            "status": status if status in CASE_STATUSES else "error",
            "exit_code": _int(exit_code),
            "duration_ms": _int(duration) or 0,
            "output": raw[:PER_TEST_OUTPUT_BYTES].decode("utf-8", errors="replace"),
            "lines_given": _int(item.get("lines_given")),
            "lines_read": _int(item.get("lines_read")),
        }
    return parsed


def _int(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def input_not_read_message(read: int, given: int) -> str:
    return f"Your program did not read all the input (read {read} of {given} values)."


# -------------------------------------------------------------------- scoring

def build_results(cases: list[CaseData], parsed: Optional[dict[int, dict[str, Any]]],
                  fallback_status: str = "error") -> tuple[list[dict[str, Any]], Summary]:
    """Compares each case's output with its expected output. A case passes only if its program finished normally
    (status ok) AND the output matches AND, for a case with input that requires it, the program read every input
    line (otherwise status "input_not_read", whatever it printed). If the sandbox gave no usable answer for a case,
    it fails with `fallback_status`."""
    results: list[dict[str, Any]] = []
    passed = score = 0
    for case in cases:
        got = parsed.get(case.id) if parsed else None
        message, lines_given, lines_read = None, None, None
        if got is None:
            status, output, duration, ok = fallback_status, "", 0, False
        else:
            status, output, duration = got["status"], got["output"], got["duration_ms"]
            lines_given, lines_read = got.get("lines_given"), got.get("lines_read")
            ok = status == "ok" and outputs_match(case.match_mode, output, case.expected)
            if status == "ok" and case.require_input_read and lines_given and lines_read is not None \
                    and lines_read < lines_given:
                status, ok, message = INPUT_NOT_READ, False, input_not_read_message(lines_read, lines_given)
        results.append(_row(case, ok, status, duration, output, message, lines_given, lines_read))
        passed += ok
        score += case.points if ok else 0
    return results, Summary(passed=passed, total=len(cases), score=score, max_score=sum(c.points for c in cases))


def _row(case: CaseData, ok: bool, status: str, duration: int, output: str, message: Optional[str] = None,
         lines_given: Optional[int] = None, lines_read: Optional[int] = None) -> dict[str, Any]:
    return {
        "case_id": case.id, "name": case.name, "is_hidden": case.is_hidden, "passed": ok,
        "points": case.points, "points_awarded": case.points if ok else 0, "status": status, "duration_ms": duration,
        "actual_output": output[:ACTUAL_OUTPUT_LIMIT], "message": message,
        "lines_given": lines_given, "lines_read": lines_read,
    }


def failed_results(cases: list[CaseData], status: str, message: str) -> tuple[list[dict[str, Any]], Summary]:
    """Every case failed with the same status and message, without running anything (requirement_failed)."""
    return ([_row(c, False, status, 0, "", message) for c in cases],
            Summary(passed=0, total=len(cases), score=0, max_score=sum(c.points for c in cases)))


def summarize(results: list[dict[str, Any]]) -> Summary:
    """Totals of stored results (pass/fail and points are not secret, only what a hidden case printed is)."""
    return Summary(passed=sum(1 for r in results if r.get("passed")), total=len(results),
                   score=sum(r.get("points_awarded", 0) for r in results),
                   max_score=sum(r.get("points", 0) for r in results))


def redact_for_student(results: Optional[list[dict[str, Any]]]) -> Optional[list[dict[str, Any]]]:
    """A hidden case reveals only whether it passed: never what the program printed (that would leak the
    expected output of a program written to pass it)."""
    if results is None:
        return None
    return [{**r, "actual_output": None} if r.get("is_hidden", True) else dict(r) for r in results]


def progress_events(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The WebSocket {"type": "test_result"} messages: no output for anyone, hidden or not."""
    return [{"type": "test_result", "case_id": r["case_id"], "passed": r["passed"], "status": r["status"],
             "duration_ms": r["duration_ms"]} for r in results]


# ------------------------------------------------------------- code requirements

REQUIREMENT_KEYWORDS = {"for", "while", "if", "def", "class"}
_KEYWORD_NODES = {
    "for": (ast.For, ast.AsyncFor, ast.comprehension),   # a loop or a comprehension
    "while": (ast.While,),
    "if": (ast.If, ast.IfExp),
    "def": (ast.FunctionDef, ast.AsyncFunctionDef),
    "class": (ast.ClassDef,),
}
_KEYWORD_TEXT = {"for": "a for loop", "while": "a while loop", "if": "an if statement", "def": "a function (def)",
                 "class": "a class"}


def python_files_in(files: list[dict[str, Any]], entry: str) -> dict[str, str]:
    """path -> source of every .py file in the entry file's folder (and below): the activity's code."""
    folder = str(PurePosixPath(entry).parent)
    prefix = "" if folder in ("", ".") else folder + "/"
    return {f["path"]: f.get("content") or "" for f in files
            if not f.get("is_folder") and f["path"].endswith(".py") and f["path"].startswith(prefix)}


def _trees(sources: dict[str, str]) -> Optional[list[ast.AST]]:
    """The parsed files, or None if any of them is not valid Python (then the run itself shows the error)."""
    trees = []
    for source in sources.values():
        try:
            trees.append(ast.parse(source))
        except (SyntaxError, ValueError):
            return None
    return trees


def check_requirements(requirements: Optional[dict[str, Any]], sources: dict[str, str]) -> list[str]:
    """What the code fails of the activity's requirements, as sentences for the student (empty = all met).

    {"must_define_functions": ["average"], "must_use": ["for", "while", "if", "def", "class"],
     "must_not_use_calls": [".index", "sorted"], "must_not_use_imports": ["statistics"]}
    ".name" is a method call (anything.name(...)), "name" a call of that function; an import also matches its
    submodules (math matches math.floor imports). Nothing is checked when a file is not valid Python."""
    if not requirements:
        return []
    trees = _trees(sources)
    if trees is None:
        return []
    nodes = [node for tree in trees for node in ast.walk(tree)]
    problems = []

    defined = {n.name for n in nodes if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    for name in requirements.get("must_define_functions") or []:
        if name not in defined:
            problems.append(f"Define a function named {name}().")
    for keyword in requirements.get("must_use") or []:
        kinds = _KEYWORD_NODES.get(keyword)
        if kinds and not any(isinstance(n, kinds) for n in nodes):
            problems.append(f"Use {_KEYWORD_TEXT[keyword]}.")

    methods = {n.func.attr for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    functions = {n.func.id for n in nodes if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    for call in requirements.get("must_not_use_calls") or []:
        if call.startswith(".") and call[1:] in methods:
            problems.append(f"Do not use {call}().")
        elif not call.startswith(".") and call in functions:
            problems.append(f"Do not use {call}().")

    imported = set()
    for n in nodes:
        if isinstance(n, ast.Import):
            imported.update(alias.name for alias in n.names)
        elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
            imported.add(n.module)
    for module in requirements.get("must_not_use_imports") or []:
        if any(name == module or name.startswith(module + ".") for name in imported):
            problems.append(f"Do not import {module}.")
    return problems


def requirement_message(problems: list[str]) -> str:
    return "Your code does not meet the activity's requirements: " + " ".join(problems)


# ------------------------------------------------------------- hardcoded answers

_NUMBER = re.compile(r"^[-+]?\d+(?:[.,]\d+)?$")


def _telling_lines(expected: str) -> list[str]:
    """The lines of an expected output that would give away a hardcoded answer: at least 6 characters, and not
    just a number."""
    lines = (line.strip() for line in expected.replace("\r\n", "\n").split("\n"))
    return [line for line in lines if len(line) >= 6 and not _NUMBER.match(line)]


def _string_constants(trees: list[ast.AST]) -> list[str]:
    return [n.value for tree in trees for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def hardcoded_cases(cases: list[CaseData], sources: dict[str, str], allowed_text: str = "",
                    allowed_sources: Optional[dict[str, str]] = None) -> list[str]:
    """Names of the HIDDEN cases one of whose telling expected-output lines appears inside a string literal of the
    student's code. Lines the activity itself gives away (its instructions, or string literals of its starter
    files) do not count. Only a flag for the instructor: nothing fails because of it."""
    trees = _trees(sources)
    if trees is None:
        return []
    literals = _string_constants(trees)
    starter = _string_constants(_trees(allowed_sources or {}) or [])
    hits = []
    for case in cases:
        if not case.is_hidden:
            continue
        for line in _telling_lines(case.expected):
            if line in allowed_text or any(line in text for text in starter):
                continue
            if any(line in text for text in literals):
                hits.append(case.name)
                break
    return hits
