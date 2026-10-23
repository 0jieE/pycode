"""The monitor shows each student's latest Test: GET /sessions/{id}/monitor -> students[].last_test, and the live
"tested" event. Uses the fake sandbox of test_grading.py (no Docker)."""
import pytest
from sqlalchemy.orm import Session

from app.models.execution import Execution, ExecutionStatus
from tests.conftest import Listener, approved_student, new_session
from tests.test_grading import (API, activity_with_cases, clear_cooldowns, fresh_cooldowns, jobs, run_tests,  # noqa: F401
                                sandbox)


def snapshot(lab, session_id: int | None = None) -> dict:
    r = lab.teacher.get(f"{API}/sessions/{session_id or lab.session_id}/monitor")
    assert r.status_code == 200, r.text
    return {s["student"]["username"]: s for s in r.json()["students"]}


def test_a_test_run_before_the_page_was_opened_is_in_the_snapshot(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, hidden = activity_with_cases(lab)           # sample worth 2 points, hidden worth 3
    assert snapshot(lab)["stu1"]["last_test"] is None     # nothing tested yet

    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "wrong")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(eid)

    last = snapshot(lab)["stu1"]["last_test"]              # the instructor opens the monitor only now
    assert set(last) == {"execution_id", "activity_id", "passed", "total", "score", "max_score", "finished_at"}
    assert (last["execution_id"], last["activity_id"]) == (eid, a["id"])
    assert (last["passed"], last["total"], last["score"], last["max_score"]) == (1, 2, 2, 5)
    assert last["finished_at"].endswith("Z")


def test_the_newest_finished_test_wins(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    ids = []
    for answer in (lambda s: ("ok", "wrong"), lambda s: ("ok", "4" if s == "2\n" else "SECRET-EXPECTED-OUTPUT-xyz")):
        clear_cooldowns()
        sandbox.answer = answer
        ids.append(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
        tasks_module.run_code(ids[-1])
    last = snapshot(lab)["stu1"]["last_test"]
    assert last["execution_id"] == ids[1] and (last["passed"], last["score"]) == (2, 5)  # the second, better one


def test_a_test_still_waiting_shows_the_previous_result(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "no")
    first = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    tasks_module.run_code(first)
    clear_cooldowns()
    second = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]       # queued, no worker yet
    assert snapshot(lab)["stu1"]["last_test"]["execution_id"] == first
    db.expire_all()
    db.get(Execution, second).status = ExecutionStatus.RUNNING
    db.commit()
    assert snapshot(lab)["stu1"]["last_test"]["execution_id"] == first


def test_a_test_that_could_not_run_is_not_a_result(lab, db: Session, jobs, tasks_module, monkeypatch) -> None:
    a, _, _ = activity_with_cases(lab)

    def boom(*args, **kwargs):
        raise RuntimeError("docker down")

    monkeypatch.setattr(tasks_module, "run_in_sandbox", boom)
    tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
    assert snapshot(lab)["stu1"]["last_test"] is None


def test_it_is_per_student_and_per_session(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    sandbox.answer = lambda stdin: ("ok", "4")
    tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])

    rows = snapshot(lab)
    assert rows["stu1"]["last_test"] is not None and rows["stu2"]["last_test"] is None
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    later = new_session(lab.teacher, lab.cid, "Batch B")
    assert snapshot(lab, later["id"])["stu1"]["last_test"] is None        # another session: not included
    assert snapshot(lab)["stu1"]["last_test"] is not None                 # the first session still shows it


def test_tests_and_runs_are_reported_separately(lab, db: Session, jobs, sandbox, tasks_module, monkeypatch) -> None:
    from tests.test_run import run as plain_run  # noqa: F401  (a plain Run goes through the batch queue below)
    from app.services import execution_service
    monkeypatch.setattr(execution_service, "enqueue", lambda eid: None)
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4")
    tasks_module.run_code(run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"])
    row = snapshot(lab)["stu1"]
    assert row["last_run"] is None and row["last_test"] is not None        # a Test is not "the last run"

    clear_cooldowns()
    run_id = lab.student.post(f"{API}/workspace/{lab.cid}/run", json={
        "mode": "batch", "entry_path": "Lab 1/main.py"}).json()["execution_id"]
    row = snapshot(lab)["stu1"]
    assert row["last_run"]["execution_id"] == run_id                       # a plain Run is not a test
    assert row["last_test"]["execution_id"] != run_id


def test_grading_and_instructor_tries_are_not_the_students_last_test(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, shown, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4")
    assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200     # queues a grade job
    tasks_module.run_code(jobs[-1]["execution_id"])
    tried = lab.teacher.post(f"{API}/test-cases/{shown['id']}/try").json()["execution_id"]
    tasks_module.run_code(tried, files=jobs[-1]["files"], case_ids=jobs[-1]["case_ids"])
    assert snapshot(lab)["stu1"]["last_test"] is None


def test_the_live_tested_event_carries_the_score(lab, db: Session, jobs, sandbox, tasks_module) -> None:
    a, _, _ = activity_with_cases(lab)
    sandbox.answer = lambda stdin: ("ok", "4" if stdin == "2\n" else "no")
    eid = run_tests(lab.student, lab.cid, a["id"]).json()["execution_id"]
    events = Listener(f"monitor:{lab.session_id}")
    try:
        tasks_module.run_code(eid)
        tested = [e for e in events.messages() if e["type"] == "tested"]
    finally:
        events.close()
    assert len(tested) == 1
    event = tested[0]
    assert (event["passed"], event["total"], event["score"], event["max_score"]) == (1, 2, 2, 5)
    assert event["execution_id"] == eid and event["activity_id"] == a["id"] and event["student"]
    # the snapshot and the live event agree
    last = snapshot(lab)["stu1"]["last_test"]
    assert (last["passed"], last["total"], last["score"], last["max_score"]) == (1, 2, 2, 5)
