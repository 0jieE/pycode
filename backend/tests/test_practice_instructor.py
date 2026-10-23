"""Instructors have a personal Practice workspace too: the same /practice/* endpoints, private to its owner."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.redis import get_redis
from app.models.execution import Execution, ExecutionMode, ExecutionStatus
from app.models.user import Role
from app.models.workspace import Workspace
from app.services import execution_service
from app.services import interactive_service as isvc
from tests.conftest import Listener, login_as, new_device
from tests.test_interactive import fresh_state, sent  # noqa: F401  (fixtures)
from tests.test_practice import API, KB, P, pentry, pmk, ppaths, prun, psave, ptree, uid
from tests.test_sandbox import DOCKER_READY


def test_an_instructor_gets_an_empty_workspace_on_first_access(lab, db: Session) -> None:
    assert ptree(lab.teacher)["entries"] == []
    db.expire_all()
    mine = db.scalars(select(Workspace).where(Workspace.student_id == uid(lab.teacher), Workspace.class_id.is_(None))).all()
    assert len(mine) == 1
    assert ptree(lab.teacher)["entries"] == [] and len(db.scalars(select(Workspace).where(
        Workspace.student_id == uid(lab.teacher), Workspace.class_id.is_(None))).all()) == 1  # not created twice


def test_the_instructor_can_manage_files_folders_versions_and_renames(lab) -> None:
    t = lab.teacher
    assert pmk(t, "samples", folder=True).status_code == 201
    created = pmk(t, "samples/solution.py", "print('v1')")
    assert created.status_code == 201
    entry = pentry(t, "samples/solution.py")

    saved = psave(t, entry["id"], "print('v2')", entry["updated_at"], version=True)
    assert saved.status_code == 200
    stale = psave(t, entry["id"], "print('lost')", entry["updated_at"])       # optimistic locking, as for students
    assert stale.status_code == 409 and stale.json()["code"] == "SAVE_CONFLICT"
    assert t.get(f"{P}/files/{entry['id']}").json()["content"] == "print('v2')"

    versions = t.get(f"{P}/files/{entry['id']}/versions").json()
    assert versions["total"] == 1
    assert t.get(f"{P}/versions/{versions['items'][0]['id']}").json()["content"] == "print('v2')"

    assert t.patch(f"{P}/files/{entry['id']}", json={"new_path": "samples/answer.py"}).status_code == 200
    assert ppaths(t) == {"samples", "samples/answer.py"}
    assert t.delete(f"{P}/files/{entry['id']}").status_code == 204
    assert ppaths(t) == {"samples"}


def test_the_same_rules_and_quotas_as_for_students(lab) -> None:
    for path in ("../escape.py", ".hidden.py", "bad.exe", "a/../b.py"):
        assert pmk(lab.teacher, path, "x").status_code == pmk(lab.student, path, "x").status_code == 400
    big = pmk(lab.teacher, "big.py", "x" * (101 * KB))
    assert big.status_code == pmk(lab.student, "big.py", "x" * (101 * KB)).status_code
    assert big.status_code in (400, 413) and big.json()["code"] == pmk(lab.student, "big2.py", "x" * (101 * KB)).json()["code"]
    assert pmk(lab.teacher, "ok.py", "x" * (100 * KB)).status_code == 201
    assert pmk(lab.teacher, "ok.py", "again").status_code == 409


def test_it_is_never_locked_by_a_lab_session(lab) -> None:
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    assert pmk(lab.teacher, "no_lab_needed.py", "print(1)").status_code == 201


def test_workspaces_are_private_in_both_directions(lab, db: Session) -> None:
    mine = pmk(lab.teacher, "teacher_only.py", "secret answer key").json()
    theirs = pmk(lab.student, "student_only.py", "student's notes").json()

    assert lab.student.get(f"{P}/files/{mine['id']}").status_code == 404           # a student cannot read it ...
    assert lab.student.put(f"{P}/files/{mine['id']}", json={"content": "x", "last_updated_at": mine["updated_at"]}).status_code == 404
    assert lab.student.delete(f"{P}/files/{mine['id']}").status_code == 404
    assert lab.teacher.get(f"{P}/files/{theirs['id']}").status_code == 404         # ... nor the other way round
    assert ppaths(lab.student) == {"student_only.py"} and ppaths(lab.teacher) == {"teacher_only.py"}

    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    assert other_teacher.get(f"{P}/files/{mine['id']}").status_code == 404
    assert ppaths(other_teacher) == set()

    # it is not a class workspace either: the class endpoints do not know it
    assert lab.student.get(f"{API}/workspace/files/{mine['id']}").status_code == 404
    sid = uid(lab.student)
    tree = lab.teacher.get(f"{API}/classes/{lab.cid}/students/{sid}/workspace").json()
    assert all(e["path"] != "teacher_only.py" for e in tree["entries"])


def test_admins_and_anonymous_users_have_none(lab, db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "root")
    assert admin.get(f"{P}/tree").status_code == 403
    assert new_device().get(f"{P}/tree").status_code == 401


def test_it_never_reaches_the_monitor_or_submissions(lab, db: Session, sent) -> None:
    listener = Listener(f"monitor:{lab.session_id}")
    try:
        f = pmk(lab.teacher, "main.py", "print(1)").json()
        psave(lab.teacher, f["id"], "print(2)", f["updated_at"])
        assert prun(lab.teacher).status_code == 202
        assert listener.messages(wait=0.4) == []
    finally:
        listener.close()
    students = lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()["students"]
    assert [s["student"]["username"] for s in students] == ["stu1"]
    assert students[0]["last_run"] is None and students[0]["last_test"] is None


# ================================================================ running

def test_the_instructor_can_run_a_practice_file(lab, db: Session, sent) -> None:
    pmk(lab.teacher, "main.py", "print('answer key')")
    batch = prun(lab.teacher, stdin="x\n")
    assert batch.status_code == 202 and sent == [("practice", batch.json()["execution_id"])]

    db.expire_all()
    ex = db.get(Execution, batch.json()["execution_id"])
    assert ex.student_id == uid(lab.teacher) and ex.mode == ExecutionMode.BATCH and ex.stdin == "x\n"
    assert ex.lab_session_id is None and ex.activity_id is None
    ex.status, ex.output, ex.exit_code = ExecutionStatus.OK, "answer key\n", 0
    db.commit()

    body = lab.teacher.get(f"{API}/executions/{ex.id}").json()
    assert body["practice"] is True and body["class_id"] is None and body["output"] == "answer key\n"
    assert lab.student.get(f"{API}/executions/{ex.id}").status_code == 404           # nobody else can read it
    assert login_as(db, Role.INSTRUCTOR, "teach2").get(f"{API}/executions/{ex.id}").status_code == 404


def test_an_instructor_run_is_interactive_by_default(lab, sent) -> None:
    pmk(lab.teacher, "main.py", "print(input())")
    r = lab.teacher.post(f"{P}/run", json={"entry_path": "main.py"})
    assert r.status_code == 202 and sent == [("interactive", r.json()["execution_id"])]
    assert lab.teacher.post(f"{P}/run", json={"entry_path": "missing.py"}).status_code in (404, 429)


def test_the_run_limits_apply_to_instructors_too(lab, sent) -> None:
    pmk(lab.teacher, "main.py", "print(1)")
    assert prun(lab.teacher).status_code == 202
    again = prun(lab.teacher)
    assert again.status_code == 429 and again.json()["code"] in ("RUN_IN_PROGRESS", "RUN_TOO_FAST")
    assert len(sent) == 1


def test_the_instructor_can_type_into_their_own_interactive_run_and_nobody_else_can(lab, sent) -> None:
    pmk(lab.teacher, "main.py", "print(input())")
    eid = lab.teacher.post(f"{P}/run", json={"entry_path": "main.py"}).json()["execution_id"]
    listener = Listener(isvc.control_channel(eid))
    try:
        with lab.student.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            assert ws.receive_json()["code"] == "EXECUTION_NOT_FOUND"
        with lab.teacher.websocket_connect(f"{API}/ws/run/{eid}") as ws:
            ws.receive_json()
            ws.send_json({"type": "stdin", "data": "hello"})
            assert listener.messages(wait=0.5) == [{"type": "stdin", "data": "hello"}]
    finally:
        listener.close()
    assert get_redis().get(isvc.stop_key(eid)) is None


@pytest.mark.skipif(not DOCKER_READY, reason="needs the Docker socket and lab-python-runner:1")
def test_a_practice_batch_run_of_an_instructor_runs_in_the_sandbox(lab, monkeypatch, tasks_module) -> None:
    monkeypatch.setattr(execution_service, "enqueue_practice", lambda eid: tasks_module.run_code(eid))
    pmk(lab.teacher, "main.py", "name = input('Name? ')\nprint('Hi', name)")
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    eid = lab.teacher.post(f"{P}/run", json={"mode": "batch", "entry_path": "main.py", "stdin": "Prof\n"}).json()["execution_id"]
    done = lab.teacher.get(f"{API}/executions/{eid}").json()
    assert done["status"] == "ok" and done["output"] == "Name? Hi Prof\n" and done["practice"] is True
