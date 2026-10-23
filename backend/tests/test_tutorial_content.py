"""Every default lesson through the REAL sandbox: its reference solution passes ALL its tests, its starter code does
NOT, and its examples run without an error. So no lesson can ship with broken tests. Needs the Docker socket:
`docker compose exec worker pytest tests/test_tutorial_content.py`."""
import secrets

import pytest

from app import tutorial_content
from app.services import grading_service
from tests.test_sandbox import DOCKER_READY, leftover

pytestmark = pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")

if DOCKER_READY:
    from app.worker.sandbox import run_in_sandbox

LESSONS = {slug: tutorial_content.parse_lesson(path) for slug, path in tutorial_content.lesson_files().items()}


@pytest.fixture(autouse=True)
def no_leftovers():
    yield
    assert leftover() == []


def grade(parsed: tutorial_content.ParsedLesson, entry_code: str):
    """Runs `entry_code` as the lesson's entry file (with its other starter files) against every test."""
    spec = parsed.front.exercise
    files = [{"path": f.path, "content": f.content, "is_folder": False} for f in spec.starter_files]
    files.append({"path": spec.entry, "content": entry_code, "is_folder": False})
    cases = [grading_service.CaseData(id=i, name=t.name, stdin=t.stdin, expected=t.expected_output,
                                      is_hidden=t.is_hidden, points=t.points, match_mode=t.match_mode)
             for i, t in enumerate(spec.tests, start=1)]
    nonce = secrets.token_hex(16)
    result = run_in_sandbox(files, spec.entry, tests=[{"id": c.id, "stdin": c.stdin} for c in cases], nonce=nonce,
                            ignore_input_prompts=spec.ignore_input_prompts,
                            timeout_sec=grading_service.overall_timeout(len(cases)))
    parsed_block = grading_service.parse_block(result.output, nonce)
    assert parsed_block is not None, f"{parsed.slug}: no result block ({result.status}): {result.output[-300:]}"
    return grading_service.build_results(cases, parsed_block)


@pytest.mark.parametrize("slug", list(LESSONS))
def test_the_reference_solution_passes_every_test(slug: str) -> None:
    parsed = LESSONS[slug]
    results, summary = grade(parsed, parsed.front.exercise.reference_solution)
    failed = [(r["name"], r["status"], r["actual_output"]) for r in results if not r["passed"]]
    assert summary.passed == summary.total, f"{slug}: failed {failed}"


@pytest.mark.parametrize("slug", list(LESSONS))
def test_the_starter_code_does_not_pass(slug: str) -> None:
    parsed = LESSONS[slug]
    _results, summary = grade(parsed, parsed.front.exercise.starter_code)
    assert summary.passed < summary.total, f"{slug}: the starter code already passes every test"


# A tiny program that runs one example file (named on stdin) exactly as a student would: a crash is an error.
RUNNER = "import runpy, sys\nrunpy.run_path(sys.stdin.readline().strip(), run_name='__main__')\n"


@pytest.mark.parametrize("slug", list(LESSONS))
def test_the_examples_run_without_errors(slug: str) -> None:
    parsed = LESSONS[slug]
    examples = [(i, e) for i, e in enumerate(parsed.front.examples, start=1) if "input(" not in e.code]
    if not examples:
        pytest.skip("every example of this lesson reads input")
    files = [{"path": "run_example.py", "content": RUNNER, "is_folder": False}]
    files += [{"path": f"example{i}.py", "content": e.code, "is_folder": False} for i, e in examples]
    nonce = secrets.token_hex(16)
    tests = [{"id": i, "stdin": f"example{i}.py\n"} for i, _ in examples]
    result = run_in_sandbox(files, "run_example.py", tests=tests, nonce=nonce, ignore_input_prompts=False,
                            timeout_sec=grading_service.overall_timeout(len(tests)))
    parsed_block = grading_service.parse_block(result.output, nonce)
    assert parsed_block is not None, f"{slug}: {result.status}"
    for i, example in examples:
        got = parsed_block[i]
        assert got["status"] == "ok", f"{slug} example '{example.title}': {got['status']}\n{got['output']}"
