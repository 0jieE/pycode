"""The built-in Python tutorial: the seed, what students and staff see, progress and locking, running and checking
exercises (the sandbox replaced by the fake of test_grading.py), the instructor's matrix and editing lessons."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import tutorial_content
from app.core.redis import get_redis
from app.models.execution import Execution, ExecutionKind, ExecutionMode
from app.models.tutorial import TutorialLesson, TutorialProgress
from app.models.user import Role
from app.services import execution_service
from tests.conftest import approved_student, login_as, new_device
from tests.test_grading import FakeSandbox, clear_cooldowns

API = "/api/v1"
T = f"{API}/tutorial"
SECRET_EXPECTED = "HIDDEN-EXPECTED-7731"
SECRET_SOLUTION = "print('REFERENCE-SOLUTION-9912')"


def lesson_body(slug: str, order_hint: int = 0, **over) -> dict:
    body = {
        "slug": slug, "title": f"Lesson {slug}", "summary": f"About {slug}", "body_md": f"# {slug}\n\nText.",
        "examples": [{"title": "Ex", "code": "print(1)"}],
        "exercise": {
            "prompt": "Print the magic word.", "starter_code": "# todo\n", "entry": "main.py",
            "ignore_input_prompts": True, "reference_solution": SECRET_SOLUTION,
            "tests": [
                {"name": "sample one", "stdin": "a\n", "expected_output": "ok-a", "is_hidden": False, "match_mode": "trim"},
                {"name": "sample two", "stdin": "b\n", "expected_output": "ok-b", "is_hidden": False, "match_mode": "trim"},
                {"name": "secret one", "stdin": "SECRET-STDIN-1\n", "expected_output": SECRET_EXPECTED, "is_hidden": True,
                 "match_mode": "trim"},
                {"name": "secret two", "stdin": "c\n", "expected_output": "ok-c", "is_hidden": True, "match_mode": "exact"},
            ],
        },
    }
    body.update(over)
    return body


@pytest.fixture(autouse=True)
def fresh():
    clear_cooldowns()
    yield


@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "admin1")


@pytest.fixture()
def three_lessons(db: Session, admin) -> list[dict]:
    """Three small lessons (l1, l2, l3) made through the API, so the tests control every test case."""
    made = []
    for slug in ("l1", "l2", "l3"):
        r = admin.post(f"{T}/manage/lessons", json=lesson_body(slug))
        assert r.status_code == 201, r.text
        made.append(r.json())
    return made


@pytest.fixture()
def jobs(monkeypatch) -> list[dict]:
    """Replaces the Celery hand-off of test jobs; records every job."""
    sent: list[dict] = []
    monkeypatch.setattr(execution_service, "enqueue_job",
                        lambda eid, **kw: sent.append({"execution_id": eid, **kw}))
    return sent


@pytest.fixture()
def sent(monkeypatch) -> list[dict]:
    """Replaces the Celery hand-off of runs; records (queue, task, files)."""
    log: list[dict] = []
    monkeypatch.setattr(execution_service, "_send",
                        lambda eid, queue, task=execution_service.RUN_TASK, files=None:
                        log.append({"execution_id": eid, "queue": queue, "task": task, "files": files}))
    return log


@pytest.fixture()
def sandbox(tasks_module, monkeypatch):
    fake = FakeSandbox(tasks_module)
    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake)
    return fake


def check(c: TestClient, slug: str, code: str = "print(input())", extra_files=()):
    files = [{"path": "main.py", "content": code}, *extra_files]
    return c.post(f"{T}/lessons/{slug}/check", json={"files": files})


def run_check(lab, tasks_module, jobs, slug: str, answer) -> dict:
    """Queues a check for stu1 and runs it with the fake sandbox answering `answer(stdin)`."""
    clear_cooldowns()
    r = check(lab.student, slug)
    assert r.status_code == 202, r.text
    job = jobs[-1]
    tasks_module.run_in_sandbox.answer = answer
    tasks_module.run_code(job["execution_id"], files=job["files"], case_ids=job.get("case_ids"))
    return lab.student.get(f"{API}/executions/{job['execution_id']}").json()


def all_pass(stdin: str) -> tuple[str, str]:
    return "ok", {"a\n": "ok-a", "b\n": "ok-b", "SECRET-STDIN-1\n": SECRET_EXPECTED, "c\n": "ok-c"}[stdin]


def some_fail(stdin: str) -> tuple[str, str]:
    return "ok", {"a\n": "ok-a", "b\n": "wrong", "SECRET-STDIN-1\n": SECRET_EXPECTED, "c\n": "ok-c"}[stdin]


# =================================================================================== the seed

def test_the_seed_loads_every_lesson_file_and_is_idempotent(db: Session) -> None:
    files = tutorial_content.lesson_files()
    assert len(files) == 25 and list(files)[:3] == ["print", "comments", "variables"]
    first = tutorial_content.load_all(db)
    assert len(first.created) == 25 and first.updated == []
    second = tutorial_content.load_all(db)
    assert second.created == [] and len(second.updated) == 25
    assert db.scalar(select(TutorialLesson).where(TutorialLesson.slug == "print")).sort_order == 1

    # an edit is overwritten by a re-seed, but hiding survives it
    lesson = db.scalar(select(TutorialLesson).where(TutorialLesson.slug == "print"))
    lesson.title, lesson.is_hidden = "Changed", True
    db.commit()
    tutorial_content.load_all(db)
    db.expire_all()
    lesson = db.scalar(select(TutorialLesson).where(TutorialLesson.slug == "print"))
    assert lesson.title == "Printing output" and lesson.is_hidden is True


def test_every_default_lesson_has_two_sample_and_two_hidden_tests(db: Session) -> None:
    for slug, path in tutorial_content.lesson_files().items():
        parsed = tutorial_content.parse_lesson(path)
        tests = parsed.front.exercise.tests
        assert sum(1 for t in tests if not t.is_hidden) == 2 and sum(1 for t in tests if t.is_hidden) == 2, slug
        assert 1 <= len(parsed.front.examples) <= 3, slug
        assert parsed.front.exercise.reference_solution.strip() != parsed.front.exercise.starter_code.strip(), slug


# ========================================================================== what students see

def test_students_list_visible_lessons_in_order_with_their_progress(lab, db: Session, three_lessons, admin) -> None:
    admin.patch(f"{T}/manage/lessons/l3", json={"is_hidden": True})
    r = lab.student.get(f"{T}/lessons")
    assert r.status_code == 200
    assert [(l["slug"], l["order"], l["locked"], l["passed"], l["viewed"], l["attempts"]) for l in r.json()] == [
        ("l1", 1, False, False, False, 0), ("l2", 2, False, False, False, 0)]
    assert lab.student.get(f"{T}/lessons/l3").status_code == 404            # hidden: does not exist for students
    assert lab.student.post(f"{T}/lessons/l3/view").status_code == 404
    assert lab.teacher.get(f"{T}/lessons").status_code == 200               # instructors may browse too


def test_hidden_tests_and_the_reference_solution_never_reach_students(lab, three_lessons) -> None:
    r = lab.student.get(f"{T}/lessons/l1")
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Lesson l1" and body["examples"] == [{"title": "Ex", "code": "print(1)"}]
    tests = body["exercise"]["tests"]
    assert [t["name"] for t in tests] == ["sample one", "sample two", "secret one", "secret two"]
    assert tests[0] == {"name": "sample one", "is_hidden": False, "stdin": "a\n", "expected_output": "ok-a",
                        "match_mode": "trim", "points": 1}
    assert tests[2] == {"name": "secret one", "is_hidden": True, "points": 1}   # name and points only
    assert "reference_solution" not in body["exercise"]
    assert SECRET_EXPECTED not in r.text and "SECRET-STDIN-1" not in r.text and "REFERENCE-SOLUTION" not in r.text
    listing = lab.student.get(f"{T}/lessons")
    assert SECRET_EXPECTED not in listing.text and "REFERENCE-SOLUTION" not in listing.text


def test_no_default_lesson_leaks_its_solution(lab, db: Session) -> None:
    tutorial_content.load_all(db)
    for slug, path in tutorial_content.lesson_files().items():
        parsed = tutorial_content.parse_lesson(path)
        r = lab.student.get(f"{T}/lessons/{slug}")
        assert r.status_code == 200, slug
        assert parsed.front.exercise.reference_solution.strip() not in r.text, slug
        for t in r.json()["exercise"]["tests"]:
            if t["is_hidden"]:
                assert set(t) == {"name", "is_hidden", "points"}, slug


def test_staff_see_everything(lab, three_lessons, admin) -> None:
    r = admin.get(f"{T}/manage/lessons/l1")
    assert r.status_code == 200
    assert r.json()["exercise"]["reference_solution"] == SECRET_SOLUTION
    assert r.json()["exercise"]["tests"][2]["expected_output"] == SECRET_EXPECTED
    assert r.json()["has_default"] is False
    assert lab.teacher.get(f"{T}/manage/lessons").status_code == 200
    assert lab.student.get(f"{T}/manage/lessons").status_code == 403
    assert lab.student.get(f"{T}/manage/lessons/l1").status_code == 403


# ============================================================================ progress

def test_view_and_autosave_are_per_student(lab, db: Session, three_lessons) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    r = lab.student.post(f"{T}/lessons/l1/view")
    assert r.status_code == 200 and r.json()["viewed_at"].endswith("Z") and r.json()["passed_at"] is None
    r = lab.student.put(f"{T}/lessons/l1/code", json={"code": "print('my work')"})
    assert r.status_code == 200
    mine = lab.student.get(f"{T}/lessons/l1").json()["progress"]
    assert mine["last_code"] == "print('my work')" and mine["viewed_at"] is not None
    theirs = other.get(f"{T}/lessons/l1").json()["progress"]
    assert theirs == {"viewed_at": None, "passed_at": None, "attempts": 0, "last_code": None}
    assert other.get(f"{T}/lessons").json()[0]["viewed"] is False
    assert lab.student.get(f"{T}/lessons").json()[0]["viewed"] is True
    assert lab.teacher.post(f"{T}/lessons/l1/view").status_code == 403       # progress is for students
    assert lab.student.put(f"{T}/lessons/l1/code", json={"code": "x" * (100 * 1024 + 1)}).status_code == 422


# ============================================================================== checking

def test_check_queues_a_test_job_on_the_practice_queue(lab, db: Session, three_lessons, jobs) -> None:
    r = check(lab.student, "l1", "print('hi')", [{"path": "extra.py", "content": "x = 1"}])
    assert r.status_code == 202 and r.json()["queue_position"] == 1
    job = jobs[-1]
    assert job["queue"] == "practice" and job["timeout"] == 25 and job.get("case_ids") is None
    assert {f["path"] for f in job["files"]} == {"main.py", "extra.py"}
    db.expire_all()
    ex = db.get(Execution, job["execution_id"])
    assert ex.kind == ExecutionKind.TEST and ex.mode == ExecutionMode.BATCH and ex.tutorial_lesson_id == three_lessons[0]["id"]
    assert ex.workspace_id is None and ex.lab_session_id is None and ex.entry_path == "main.py"


def test_check_validation(lab, three_lessons, jobs) -> None:
    r = lab.student.post(f"{T}/lessons/l1/check", json={"files": [{"path": "other.py", "content": "x"}]})
    assert r.status_code == 400 and r.json()["code"] == "ENTRY_NOT_FOUND"
    r = lab.student.post(f"{T}/lessons/l1/check", json={"files": [{"path": "main.py", "content": "x"},
                                                                  {"path": "sub/main.py", "content": "x"}]})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATH"
    assert lab.student.post(f"{T}/lessons/nope/check", json={"files": [{"path": "main.py", "content": "x"}]}).status_code == 404
    assert lab.teacher.post(f"{T}/lessons/l1/check", json={"files": [{"path": "main.py", "content": "x"}]}).status_code == 403
    assert jobs == []


def test_passing_every_test_marks_the_lesson_passed(lab, db: Session, three_lessons, jobs, sandbox, tasks_module) -> None:
    first = run_check(lab, tasks_module, jobs, "l1", some_fail)
    assert first["status"] == "ok" and first["test_summary"] == {"passed": 3, "total": 4, "score": 3, "max_score": 4}
    assert first["tutorial_lesson_id"] == three_lessons[0]["id"] and first["kind"] == "test"
    row = lab.student.get(f"{T}/lessons").json()[0]
    assert (row["attempts"], row["passed"]) == (1, False)                     # not all passed: not passed

    second = run_check(lab, tasks_module, jobs, "l1", all_pass)
    assert second["test_summary"]["passed"] == 4
    row = lab.student.get(f"{T}/lessons").json()[0]
    assert (row["attempts"], row["passed"]) == (2, True)
    db.expire_all()
    progress = db.scalar(select(TutorialProgress).where(TutorialProgress.lesson_id == three_lessons[0]["id"]))
    passed_at = progress.passed_at
    assert passed_at is not None

    third = run_check(lab, tasks_module, jobs, "l1", some_fail)              # failing later keeps the pass
    assert third["test_summary"]["passed"] == 3
    db.expire_all()
    progress = db.scalar(select(TutorialProgress).where(TutorialProgress.lesson_id == three_lessons[0]["id"]))
    assert progress.passed_at == passed_at and progress.attempts == 3


def test_check_results_hide_what_hidden_tests_printed(lab, three_lessons, jobs, sandbox, tasks_module) -> None:
    result = run_check(lab, tasks_module, jobs, "l1", lambda s: ("ok", "printed:" + s.strip()))
    by_name = {t["name"]: t for t in result["test_results"]}
    assert by_name["sample one"]["actual_output"] == "printed:a"
    assert by_name["secret one"]["actual_output"] is None and by_name["secret two"]["actual_output"] is None
    assert SECRET_EXPECTED not in json.dumps(result)
    # the sandbox got ids and stdin only
    assert sandbox.calls[0]["tests"] == [{"id": 1, "stdin": "a\n"}, {"id": 2, "stdin": "b\n"},
                                         {"id": 3, "stdin": "SECRET-STDIN-1\n"}, {"id": 4, "stdin": "c\n"}]
    assert SECRET_EXPECTED not in json.dumps(sandbox.calls[0], default=str)


def test_checks_count_as_the_students_active_run(lab, three_lessons, jobs) -> None:
    assert check(lab.student, "l1").status_code == 202
    r = check(lab.student, "l1")
    assert r.status_code == 429 and r.json()["code"] in ("RUN_IN_PROGRESS", "RUN_TOO_FAST")


# ================================================================================= locking

def test_lessons_unlock_in_order_when_a_class_asks_for_it(lab, db: Session, three_lessons, jobs, sandbox, tasks_module) -> None:
    r = lab.teacher.patch(f"{API}/classes/{lab.cid}", json={"tutorial_unlock_in_order": True})
    assert r.status_code == 200 and r.json()["tutorial_unlock_in_order"] is True
    assert [l["locked"] for l in lab.student.get(f"{T}/lessons").json()] == [False, True, True]

    for call in (lambda: lab.student.get(f"{T}/lessons/l2"), lambda: lab.student.post(f"{T}/lessons/l2/view"),
                 lambda: lab.student.put(f"{T}/lessons/l2/code", json={"code": "x"}),
                 lambda: check(lab.student, "l2")):
        r = call()
        assert r.status_code == 403 and r.json()["code"] == "TUTORIAL_LOCKED"
    assert lab.student.get(f"{T}/lessons/l1").status_code == 200

    run_check(lab, tasks_module, jobs, "l1", all_pass)                        # pass lesson 1 ...
    assert [l["locked"] for l in lab.student.get(f"{T}/lessons").json()] == [False, False, True]
    assert lab.student.get(f"{T}/lessons/l2").status_code == 200              # ... lesson 2 opens, 3 stays locked
    assert lab.student.get(f"{T}/lessons/l3").json()["code"] == "TUTORIAL_LOCKED"

    lab.teacher.patch(f"{API}/classes/{lab.cid}", json={"tutorial_unlock_in_order": False})
    assert [l["locked"] for l in lab.student.get(f"{T}/lessons").json()] == [False, False, False]


def test_students_in_no_such_class_and_staff_are_never_locked(lab, db: Session, three_lessons) -> None:
    lab.teacher.patch(f"{API}/classes/{lab.cid}", json={"tutorial_unlock_in_order": True})
    loner = login_as(db, Role.STUDENT, "loner")                               # no class at all
    assert [l["locked"] for l in loner.get(f"{T}/lessons").json()] == [False, False, False]
    assert [l["locked"] for l in lab.teacher.get(f"{T}/lessons").json()] == [False, False, False]
    assert lab.teacher.get(f"{T}/lessons/l3").status_code == 200


def test_a_hidden_lesson_does_not_block_the_next_one(lab, db: Session, three_lessons, admin) -> None:
    lab.teacher.patch(f"{API}/classes/{lab.cid}", json={"tutorial_unlock_in_order": True})
    admin.patch(f"{T}/manage/lessons/l1", json={"is_hidden": True})
    rows = lab.student.get(f"{T}/lessons").json()
    assert [(l["slug"], l["locked"]) for l in rows] == [("l2", False), ("l3", True)]


# =================================================================================== running

def test_run_goes_to_the_practice_or_interactive_queue_with_the_code(lab, db: Session, sent) -> None:
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")               # no open lab: still allowed
    r = lab.student.post(f"{T}/run", json={"code": "print(input())", "stdin": "x\n", "mode": "batch"})
    assert r.status_code == 202, r.text
    assert sent[-1]["queue"] == "practice" and sent[-1]["task"] == "app.worker.tasks.run_code"
    assert sent[-1]["files"] == [{"path": "main.py", "content": "print(input())", "is_folder": False}]
    db.expire_all()
    ex = db.get(Execution, r.json()["execution_id"])
    assert ex.mode == ExecutionMode.BATCH and ex.stdin == "x\n" and ex.workspace_id is None and ex.lab_session_id is None

    clear_cooldowns()
    db.get(Execution, ex.id).status = "ok"
    db.commit()
    r = lab.student.post(f"{T}/run", json={"code": "print(1)"})
    assert r.status_code == 202
    assert sent[-1]["queue"] == "interactive" and sent[-1]["task"] == "app.worker.tasks.run_interactive"
    assert lab.teacher.post(f"{T}/run", json={"code": "print(1)", "mode": "batch"}).status_code == 202  # instructors too
    assert new_device().post(f"{T}/run", json={"code": "print(1)"}).status_code == 401


def test_run_keeps_the_per_student_limits(lab, sent) -> None:
    assert lab.student.post(f"{T}/run", json={"code": "print(1)", "mode": "batch"}).status_code == 202
    r = lab.student.post(f"{T}/run", json={"code": "print(1)", "mode": "batch"})
    assert r.status_code == 429


def test_the_worker_runs_the_given_code_instead_of_a_workspace(lab, db: Session, sent, tasks_module, monkeypatch) -> None:
    r = lab.student.post(f"{T}/run", json={"code": "print('tutorial')", "mode": "batch", "stdin": "in\n"})
    eid, seen = r.json()["execution_id"], {}

    def fake(files, entry, stdin="", on_output=None, **kw):
        seen.update(files=files, entry=entry, stdin=stdin)
        return tasks_module.RunResult("ok", 0, "tutorial\n", 5)

    monkeypatch.setattr(tasks_module, "run_in_sandbox", fake)
    tasks_module.run_code(eid, files=sent[-1]["files"])
    assert seen == {"files": [{"path": "main.py", "content": "print('tutorial')", "is_folder": False}],
                    "entry": "main.py", "stdin": "in\n"}
    assert lab.student.get(f"{API}/executions/{eid}").json()["output"] == "tutorial\n"


# ========================================================================= the instructor's matrix

def test_the_class_matrix(lab, db: Session, three_lessons, jobs, sandbox, tasks_module) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    run_check(lab, tasks_module, jobs, "l1", all_pass)
    run_check(lab, tasks_module, jobs, "l2", some_fail)
    other.post(f"{T}/lessons/l1/view")

    r = lab.teacher.get(f"{API}/classes/{lab.cid}/tutorial-progress")
    assert r.status_code == 200
    m = r.json()
    assert [l["slug"] for l in m["lessons"]] == ["l1", "l2", "l3"] and m["unlock_in_order"] is False
    by_user = {s["student"]["username"]: s for s in m["students"]}
    stu1 = by_user["stu1"]
    assert stu1["passed_count"] == 1 and set(stu1["lessons"]) == {"l1", "l2"}
    assert stu1["lessons"]["l1"]["passed_at"] is not None and stu1["lessons"]["l1"]["attempts"] == 1
    assert stu1["lessons"]["l2"]["passed_at"] is None and stu1["lessons"]["l2"]["attempts"] == 1
    assert stu1["lessons"]["l2"]["last_activity"].endswith("Z")
    stu2 = by_user["stu2"]
    assert stu2["passed_count"] == 0 and set(stu2["lessons"]) == {"l1"} and stu2["lessons"]["l1"]["attempts"] == 0

    assert login_as(db, Role.INSTRUCTOR, "teach2").get(f"{API}/classes/{lab.cid}/tutorial-progress").status_code in (403, 404)
    assert lab.student.get(f"{API}/classes/{lab.cid}/tutorial-progress").status_code == 403


# ===================================================================================== editing

def test_create_update_hide_and_reorder(lab, admin, three_lessons) -> None:
    r = admin.post(f"{T}/manage/lessons", json=lesson_body("l1"))
    assert r.status_code == 409 and r.json()["code"] == "SLUG_TAKEN"
    assert admin.post(f"{T}/manage/lessons", json=lesson_body("Bad Slug!")).status_code == 422
    bad = lesson_body("l4")
    bad["exercise"]["tests"] = []
    assert admin.post(f"{T}/manage/lessons", json=bad).status_code == 422
    bad = lesson_body("l4")
    bad["exercise"]["tests"][0]["match_mode"] = "contains"
    bad["exercise"]["tests"][0]["expected_output"] = "  "
    assert admin.post(f"{T}/manage/lessons", json=bad).status_code == 422

    r = lab.teacher.patch(f"{T}/manage/lessons/l2", json={"title": "Renamed", "body_md": "# New text"})
    assert r.status_code == 200 and r.json()["title"] == "Renamed" and r.json()["body_md"] == "# New text"
    assert lab.student.get(f"{T}/lessons/l2").json()["title"] == "Renamed"
    new_exercise = lesson_body("x")["exercise"]
    new_exercise["tests"][0]["expected_output"] = "changed"
    r = admin.patch(f"{T}/manage/lessons/l2", json={"exercise": new_exercise})
    assert r.json()["exercise"]["tests"][0]["expected_output"] == "changed"
    assert admin.patch(f"{T}/manage/lessons/l2", json={"nonsense": 1}).status_code == 422

    assert admin.patch(f"{T}/manage/lessons/l3", json={"is_hidden": True}).json()["is_hidden"] is True
    assert [l["slug"] for l in lab.student.get(f"{T}/lessons").json()] == ["l1", "l2"]
    assert [l["slug"] for l in admin.get(f"{T}/manage/lessons").json()] == ["l1", "l2", "l3"]
    assert admin.patch(f"{T}/manage/lessons/l3", json={"is_hidden": False}).json()["is_hidden"] is False

    r = admin.patch(f"{T}/manage/lessons/order", json={"order": ["l3", "l1", "l2"]})
    assert r.status_code == 200 and [l["slug"] for l in r.json()] == ["l3", "l1", "l2"]
    assert [l["order"] for l in lab.student.get(f"{T}/lessons").json()] == [1, 2, 3]
    r = admin.patch(f"{T}/manage/lessons/order", json={"order": ["l1"]})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_ORDER"

    for call in (lambda c: c.post(f"{T}/manage/lessons", json=lesson_body("l9")),
                 lambda c: c.patch(f"{T}/manage/lessons/l1", json={"title": "x"}),
                 lambda c: c.patch(f"{T}/manage/lessons/order", json={"order": ["l1", "l2", "l3"]}),
                 lambda c: c.post(f"{T}/manage/lessons/l1/reset")):
        assert call(lab.student).status_code == 403
        assert call(new_device()).status_code == 401


def test_reset_to_default_reloads_the_repo_file(lab, db: Session, admin) -> None:
    tutorial_content.load_all(db)
    original = admin.get(f"{T}/manage/lessons/print").json()
    assert original["has_default"] is True
    admin.patch(f"{T}/manage/lessons/print", json={"title": "Broken", "is_hidden": True,
                                                    "exercise": lesson_body("x")["exercise"]})
    r = admin.post(f"{T}/manage/lessons/print/reset")
    assert r.status_code == 200
    assert r.json()["title"] == original["title"] and r.json()["exercise"] == original["exercise"]
    assert r.json()["is_hidden"] is True                                       # hiding is a choice, kept

    admin.post(f"{T}/manage/lessons", json=lesson_body("custom"))
    r = admin.post(f"{T}/manage/lessons/custom/reset")
    assert r.status_code == 404 and r.json()["code"] == "NO_DEFAULT"


def test_the_admin_seed_endpoint(lab, db: Session, admin) -> None:
    r = admin.post(f"{T}/manage/lessons/seed")
    assert r.status_code == 200 and len(r.json()["created"]) == 25
    assert lab.teacher.post(f"{T}/manage/lessons/seed").status_code == 403
    assert len(lab.student.get(f"{T}/lessons").json()) == 25


# ==================================================================================== deleting

def test_delete_a_lesson_made_by_hand(lab, db: Session, admin, three_lessons, jobs, sandbox, tasks_module) -> None:
    from app.models.activity_log import ActivityLog

    lab.student.post(f"{T}/lessons/l2/view")
    result = run_check(lab, tasks_module, jobs, "l2", all_pass)
    lesson_id = three_lessons[1]["id"]

    assert lab.teacher.delete(f"{T}/manage/lessons/l2").status_code == 204     # instructors may, like admins
    assert admin.get(f"{T}/manage/lessons/l2").status_code == 404
    assert [l["slug"] for l in lab.student.get(f"{T}/lessons").json()] == ["l1", "l3"]
    db.expire_all()
    assert db.scalar(select(TutorialProgress).where(TutorialProgress.lesson_id == lesson_id)) is None   # cascaded
    ex = db.get(Execution, result["id"])
    assert ex is not None and ex.tutorial_lesson_id is None                       # kept, unlinked
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "tutorial_change")).all()
    assert any(row.details == {"op": "delete", "slug": "l2"} for row in log)

    r = admin.delete(f"{T}/manage/lessons/l2")
    assert r.status_code == 404 and r.json()["code"] == "LESSON_NOT_FOUND"
    assert lab.student.delete(f"{T}/manage/lessons/l3").status_code == 403
    assert new_device().delete(f"{T}/manage/lessons/l3").status_code == 401


def test_a_default_lesson_can_only_be_hidden(lab, db: Session, admin) -> None:
    tutorial_content.load_all(db)
    r = admin.delete(f"{T}/manage/lessons/print")
    assert r.status_code == 409 and r.json()["code"] == "LESSON_IS_DEFAULT"
    assert r.json()["detail"] == "Lessons that come with the system can be hidden, not deleted"
    assert admin.get(f"{T}/manage/lessons/print").status_code == 200


def test_deleting_a_lesson_does_not_leave_the_next_one_locked(lab, db: Session, three_lessons, jobs, sandbox,
                                                                  tasks_module) -> None:
    lab.teacher.patch(f"{API}/classes/{lab.cid}", json={"tutorial_unlock_in_order": True})
    run_check(lab, tasks_module, jobs, "l1", all_pass)
    assert [l["locked"] for l in lab.student.get(f"{T}/lessons").json()] == [False, False, True]
    lab.teacher.delete(f"{T}/manage/lessons/l2")                                  # l2 was not passed ...
    rows = lab.student.get(f"{T}/lessons").json()
    assert [(l["slug"], l["locked"]) for l in rows] == [("l1", False), ("l3", False)]   # ... l3 now follows l1
    assert lab.student.get(f"{T}/lessons/l3").status_code == 200
