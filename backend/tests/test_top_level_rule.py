"""In a student's CLASS workspace nothing lives at the top level except the activity folders (made by the server):
creating or moving an entry so that it ends up outside an activity folder is 403 OUTSIDE_ACTIVITY_FOLDER. Older
top-level entries may stay and be deleted. Practice workspaces have no such rule. (These tests run with the rule ON.)"""
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workspace import Workspace, WorkspaceFile
from app.services import execution_service
from tests.test_submissions import publish, tree_entries

pytestmark = pytest.mark.top_level_rule

API = "/api/v1"
DETAIL = "Files and folders go inside an activity folder."


def mk(lab, path: str, folder: bool = False):
    return lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": path, "content": "", "is_folder": folder})


def rename(lab, path: str, new_path: str):
    return lab.student.patch(f"{API}/workspace/files/{tree_entries(lab.student, lab.cid)[path]['id']}",
                             json={"new_path": new_path})


def refused(r) -> bool:
    return r.status_code == 403 and r.json() == {"detail": DETAIL, "code": "OUTSIDE_ACTIVITY_FOLDER"}


def legacy_file(db: Session, lab, path: str = "notes.txt") -> None:
    """A top-level file from before the rule (written straight into the database)."""
    db.expire_all()
    ws = db.scalar(select(Workspace).where(Workspace.class_id == lab.cid))
    db.add(WorkspaceFile(workspace_id=ws.id, path=path, is_folder=False, content="old", size_bytes=3))
    db.commit()


def test_nothing_can_be_created_at_the_top_level(lab) -> None:
    publish(lab, title="Lab 1")
    assert refused(mk(lab, "notes.txt"))
    assert refused(mk(lab, "misc", folder=True))
    assert refused(mk(lab, "misc/notes.txt"))                 # a new top-level folder is still the top level
    assert set(tree_entries(lab.student, lab.cid)) == {"Lab 1", "Lab 1/main.py", "Lab 1/data", "Lab 1/data/in.csv"}


def test_creating_inside_an_activity_folder_works_as_before(lab) -> None:
    publish(lab, title="Lab 1")
    assert mk(lab, "Lab 1/notes.txt").status_code == 201
    assert mk(lab, "Lab 1/mine", folder=True).status_code == 201
    assert mk(lab, "Lab 1/deep/er/x.py").status_code == 201    # missing folders inside are created


def test_only_published_activities_count(lab) -> None:
    lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={"title": "Draft", "starter_files": []})
    assert refused(mk(lab, "Draft/x.py"))                     # a draft has no folder in student workspaces


def test_nothing_can_be_moved_to_the_top_level(lab) -> None:
    publish(lab, title="Lab 1")
    publish(lab, title="Lab 2")
    mk(lab, "Lab 1/mine.py")
    mk(lab, "Lab 1/sub", folder=True)
    assert refused(rename(lab, "Lab 1/mine.py", "mine.py"))
    assert refused(rename(lab, "Lab 1/sub", "sub"))
    assert refused(rename(lab, "Lab 1/mine.py", "elsewhere/mine.py"))
    assert rename(lab, "Lab 1/mine.py", "Lab 2/mine.py").status_code == 200   # between activity folders: fine
    assert rename(lab, "Lab 2/mine.py", "Lab 2/renamed.py").status_code == 200


def test_older_top_level_files_can_stay_be_edited_moved_in_and_deleted(lab, db: Session) -> None:
    publish(lab, title="Lab 1")
    legacy_file(db, lab, "notes.txt")
    legacy_file(db, lab, "old.py")
    entries = tree_entries(lab.student, lab.cid)
    r = lab.student.put(f"{API}/workspace/files/{entries['notes.txt']['id']}",
                        json={"content": "still mine", "last_updated_at": entries["notes.txt"]["updated_at"]})
    assert r.status_code == 200
    assert refused(rename(lab, "notes.txt", "notes2.txt"))                # renaming keeps it at the top: no
    assert rename(lab, "notes.txt", "Lab 1/notes.txt").status_code == 200  # into an activity folder: yes
    assert lab.student.delete(f"{API}/workspace/files/{entries['old.py']['id']}").status_code == 204


def test_the_other_rules_still_apply_first(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1")
    lab.teacher.patch(f"{API}/activities/{a['id']}", json={"is_archived": True})
    r = mk(lab, "Lab 1/x.py")
    assert r.status_code == 403 and r.json()["code"] == "ACTIVITY_ARCHIVED"
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    assert mk(lab, "notes.txt").json()["code"] == "LAB_CLOSED"


def test_practice_has_no_such_rule(lab) -> None:
    r = lab.student.post(f"{API}/practice/files", json={"path": "notes.txt", "content": "x"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert lab.student.patch(f"{API}/practice/files/{pid}", json={"new_path": "top.txt"}).status_code == 200


def test_a_real_run_and_submit_work_with_the_rule_on(lab, monkeypatch) -> None:
    monkeypatch.setattr(execution_service, "enqueue_interactive", lambda eid: None)
    a = publish(lab, title="Lab 1")
    assert mk(lab, "Lab 1/helper.py").status_code == 201
    r = lab.student.post(f"{API}/workspace/{lab.cid}/run", json={"entry_path": "Lab 1/main.py"})
    assert r.status_code == 202
    assert lab.student.post(f"{API}/activities/{a['id']}/submit").status_code == 200
