"""Deleting draft activities, and archiving published ones (gone from students' view, folder read-only, submissions and
grades kept)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.execution import Execution
from app.models.test_case import TestCase
from app.models.user import Role
from tests.conftest import approved_student, login_as, new_device
from tests.test_submissions import edit, publish, tree_entries

API = "/api/v1"


def draft(lab, title: str = "Draft 1") -> dict:
    r = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": title, "starter_files": [{"path": "main.py", "content": "print(1)"}]})
    assert r.status_code == 201, r.text
    return r.json()


def archive(lab, activity_id: int, value: bool = True):
    return lab.teacher.patch(f"{API}/activities/{activity_id}", json={"is_archived": value})


def titles(c, cid: int, **params) -> list[str]:
    return [a["title"] for a in c.get(f"{API}/classes/{cid}/activities", params=params).json()["items"]]


# ===================================================================================== delete

def test_a_draft_can_be_deleted_with_its_test_cases(lab, db: Session) -> None:
    a = draft(lab)
    lab.teacher.post(f"{API}/activities/{a['id']}/test-cases", json={"name": "t", "expected_output": "1"})
    db.add(Execution(student_id=lab.teacher.get(f"{API}/auth/me").json()["id"], entry_path="Draft 1/main.py",
                     activity_id=a["id"], status="ok"))   # e.g. an instructor's "try" run
    db.commit()

    r = lab.teacher.delete(f"{API}/activities/{a['id']}")
    assert r.status_code == 204 and r.content == b""
    assert lab.teacher.get(f"{API}/activities/{a['id']}").status_code == 404
    db.expire_all()
    assert db.scalar(select(TestCase).where(TestCase.activity_id == a["id"])) is None          # cascaded
    assert db.scalar(select(Execution).where(Execution.entry_path == "Draft 1/main.py")).activity_id is None
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "activity_delete")).one()
    assert row.details == {"activity_id": a["id"], "class_id": lab.cid, "title": "Draft 1"}
    assert draft(lab)["title"] == "Draft 1"   # the title is free again


def test_a_published_activity_cannot_be_deleted(lab) -> None:
    a = publish(lab)
    r = lab.teacher.delete(f"{API}/activities/{a['id']}")
    assert r.status_code == 409 and r.json()["code"] == "ACTIVITY_PUBLISHED"
    assert r.json()["detail"] == "Published activities can be archived, not deleted"
    assert lab.teacher.get(f"{API}/activities/{a['id']}").status_code == 200


def test_delete_permissions(lab, db: Session) -> None:
    a = draft(lab)
    assert lab.teacher.delete(f"{API}/activities/999999").json()["code"] == "ACTIVITY_NOT_FOUND"
    assert lab.student.delete(f"{API}/activities/{a['id']}").status_code == 403
    assert login_as(db, Role.INSTRUCTOR, "teach2").delete(f"{API}/activities/{a['id']}").status_code == 403
    assert new_device().delete(f"{API}/activities/{a['id']}").status_code == 401
    assert lab.teacher.get(f"{API}/activities/{a['id']}").status_code == 200


# ==================================================================================== archive

def test_archiving_hides_the_activity_from_students_but_not_from_the_instructor(lab, db: Session) -> None:
    kept, gone = publish(lab, title="Lab 1"), publish(lab, title="Lab 2")
    r = archive(lab, gone["id"])
    assert r.status_code == 200 and r.json()["is_archived"] is True
    assert lab.teacher.get(f"{API}/activities/{kept['id']}").json()["is_archived"] is False

    assert titles(lab.student, lab.cid) == ["Lab 1"]
    assert lab.student.get(f"{API}/activities/{gone['id']}").json()["code"] == "ACTIVITY_NOT_FOUND"
    assert lab.student.get(f"{API}/activities/{gone['id']}/test-cases/student").status_code == 404
    assert titles(lab.student, lab.cid, include_archived=True) == ["Lab 1"]          # students cannot ask for it

    assert titles(lab.teacher, lab.cid) == ["Lab 1"]                                  # the default list
    assert titles(lab.teacher, lab.cid, include_archived=True) == ["Lab 1", "Lab 2"]  # on request
    assert lab.teacher.get(f"{API}/activities/{gone['id']}").json()["title"] == "Lab 2"
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "activity_archive")).one()
    assert row.details == {"activity_id": gone["id"], "archived": True}


def test_submissions_and_grades_are_kept(lab, db: Session) -> None:
    a = publish(lab)
    sid = lab.student.post(f"{API}/activities/{a['id']}/submit").json()["id"]
    archive(lab, a["id"])

    listed = lab.teacher.get(f"{API}/activities/{a['id']}/submissions").json()
    assert [s["id"] for s in listed["items"]] == [sid]
    assert lab.teacher.get(f"{API}/submissions/{sid}").status_code == 200
    assert lab.student.get(f"{API}/submissions/{sid}").status_code == 200             # their own record stays
    assert [s["activity_id"] for s in lab.student.get(f"{API}/classes/{lab.cid}/my-submissions").json()] == [a["id"]]

    r = lab.student.post(f"{API}/activities/{a['id']}/submit")                        # but no new submissions
    assert r.status_code == 404 and r.json()["code"] == "ACTIVITY_NOT_FOUND"


def test_the_folder_becomes_read_only(lab) -> None:
    a = publish(lab, title="Lab 1")
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "notes.py", "content": "mine"})
    archive(lab, a["id"])
    entries = tree_entries(lab.student, lab.cid)
    main = entries["Lab 1/main.py"]
    assert lab.student.get(f"{API}/workspace/files/{main['id']}").json()["content"] == "print('starter')"  # readable

    attempts = [
        lab.student.put(f"{API}/workspace/files/{main['id']}", json={"content": "x", "last_updated_at": main["updated_at"]}),
        lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Lab 1/new.py", "content": "x"}),
        lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Lab 1/sub", "is_folder": True}),
        lab.student.patch(f"{API}/workspace/files/{main['id']}", json={"new_path": "elsewhere.py"}),       # out of it
        lab.student.patch(f"{API}/workspace/files/{entries['Lab 1']['id']}", json={"new_path": "Renamed"}),
        lab.student.patch(f"{API}/workspace/files/{entries['notes.py']['id']}", json={"new_path": "Lab 1/notes.py"}),
        lab.student.delete(f"{API}/workspace/files/{main['id']}"),
        lab.student.delete(f"{API}/workspace/files/{entries['Lab 1']['id']}"),
    ]
    for r in attempts:
        assert r.status_code == 403 and r.json()["code"] == "ACTIVITY_ARCHIVED", r.text
    assert "read-only" in attempts[0].json()["detail"]
    assert tree_entries(lab.student, lab.cid)["Lab 1/main.py"]["updated_at"] == main["updated_at"]  # untouched

    # the rest of the workspace is unaffected, including a folder whose name only starts the same
    assert lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Lab 10/x.py", "content": "x"}).status_code == 201
    edit(lab.student, lab.cid, "notes.py", "still mine")


def test_unarchiving_restores_everything_and_gives_late_joiners_the_folder(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1")
    archive(lab, a["id"])
    late = approved_student(db, lab.teacher, lab.cid, lab.code, "late")        # joins while it is archived
    assert "Lab 1" not in tree_entries(late, lab.cid)

    assert archive(lab, a["id"], False).json()["is_archived"] is False
    assert "Lab 1/main.py" in tree_entries(late, lab.cid)                     # installed now
    assert titles(lab.student, lab.cid) == ["Lab 1"]
    edit(lab.student, lab.cid, "Lab 1/main.py", "writable again")
    assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200


def test_archive_rules(lab, db: Session) -> None:
    d = draft(lab)
    r = archive(lab, d["id"])
    assert r.status_code == 400 and r.json()["code"] == "ACTIVITY_NOT_PUBLISHED"
    a = publish(lab)
    assert lab.student.patch(f"{API}/activities/{a['id']}", json={"is_archived": True}).status_code == 403
    assert login_as(db, Role.INSTRUCTOR, "teach2").patch(f"{API}/activities/{a['id']}",
                                                          json={"is_archived": True}).status_code == 403
    assert archive(lab, a["id"]).status_code == 200
    assert archive(lab, a["id"]).status_code == 200                           # archiving twice is harmless
    assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "activity_archive")) is not None


def test_the_test_button_is_closed_for_an_archived_activity(lab, monkeypatch) -> None:
    from app.services import execution_service
    monkeypatch.setattr(execution_service, "enqueue_job", lambda *a, **k: None)
    a = publish(lab, title="Lab 1")
    lab.teacher.post(f"{API}/activities/{a['id']}/test-cases", json={"name": "t", "expected_output": "starter"})
    archive(lab, a["id"])
    r = lab.student.post(f"{API}/workspace/{lab.cid}/test", json={"activity_id": a["id"], "entry_path": "Lab 1/main.py"})
    assert r.status_code == 404 and r.json()["code"] == "ACTIVITY_NOT_FOUND"
