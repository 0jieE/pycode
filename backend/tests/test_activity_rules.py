"""Activity rules in a student's class workspace: starter files are protected (edit yes; delete, rename, move no), the
activity folder turns read-only at due_at (like an archived one), no submissions after due_at, and the tree tells the
page all of it (protected, read_only_reason)."""
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity import Activity
from tests.test_submissions import edit, publish, submit, tree_entries

API = "/api/v1"
STARTER = [{"path": "main.py", "content": "print('starter')"}, {"path": "data/in.csv", "content": "a,b"}]


def entries(lab) -> dict:
    return tree_entries(lab.student, lab.cid)


def set_due(db: Session, activity_id: int, delta) -> None:
    db.expire_all()
    db.get(Activity, activity_id).due_at = None if delta is None else utcnow() + delta
    db.commit()


def mkfile(lab, path: str, content: str = "x"):
    return lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": path, "content": content})


def save(lab, path: str, content: str):
    e = entries(lab)[path]
    return lab.student.put(f"{API}/workspace/files/{e['id']}", json={"content": content, "last_updated_at": e["updated_at"]})


def rename(lab, path: str, new_path: str):
    return lab.student.patch(f"{API}/workspace/files/{entries(lab)[path]['id']}", json={"new_path": new_path})


def delete(lab, path: str):
    return lab.student.delete(f"{API}/workspace/files/{entries(lab)[path]['id']}")


def code(r) -> str:
    return r.json().get("code") if r.status_code >= 400 else str(r.status_code)


# ======================================================================== protected starter files

def test_starter_files_can_be_edited_but_not_deleted_renamed_or_moved(lab) -> None:
    publish(lab, title="Lab 1", files=STARTER)
    assert save(lab, "Lab 1/main.py", "print('my work')").status_code == 200        # editing is fine

    for r in (delete(lab, "Lab 1/main.py"), rename(lab, "Lab 1/main.py", "Lab 1/app.py"),
              rename(lab, "Lab 1/main.py", "elsewhere.py"), delete(lab, "Lab 1/data/in.csv")):
        assert r.status_code == 403 and r.json()["code"] == "STARTER_FILE_PROTECTED", r.text
    r = delete(lab, "Lab 1/main.py")
    assert r.json()["detail"] == "main.py is a starter file of 'Lab 1': it can be edited but not deleted, renamed or moved"

    for r in (delete(lab, "Lab 1"), rename(lab, "Lab 1", "Renamed")):              # the activity folder
        assert r.status_code == 403 and r.json()["code"] == "STARTER_FILE_PROTECTED"
    assert delete(lab, "Lab 1").json()["detail"] == "'Lab 1' is the folder of an activity: it cannot be deleted, renamed or moved"
    for r in (delete(lab, "Lab 1/data"), rename(lab, "Lab 1/data", "Lab 1/input")):  # a folder holding starter files
        assert r.status_code == 403 and r.json()["code"] == "STARTER_FILE_PROTECTED"
    assert set(entries(lab)) >= {"Lab 1", "Lab 1/main.py", "Lab 1/data", "Lab 1/data/in.csv"}


def test_the_students_own_files_stay_theirs_and_can_move_in_and_out(lab) -> None:
    publish(lab, title="Lab 1", files=STARTER)
    assert mkfile(lab, "Lab 1/helper.py").status_code == 201
    assert lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Lab 1/mine", "is_folder": True}).status_code == 201
    assert mkfile(lab, "Lab 1/mine/x.py").status_code == 201
    assert mkfile(lab, "notes.py").status_code == 201

    assert rename(lab, "Lab 1/helper.py", "Lab 1/utils.py").status_code == 200
    assert rename(lab, "Lab 1/utils.py", "utils.py").status_code == 200              # out of the folder
    assert rename(lab, "notes.py", "Lab 1/notes.py").status_code == 200              # into it
    assert rename(lab, "Lab 1/mine", "Lab 1/ours").status_code == 200                # a folder of their own
    assert delete(lab, "Lab 1/ours").status_code == 204
    assert delete(lab, "Lab 1/notes.py").status_code == 204


def test_activities_without_starter_files_still_protect_their_folder(lab) -> None:
    publish(lab, title="Empty", files=[])
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Empty", "is_folder": True})
    assert r.status_code in (201, 409)                     # (the folder may already be there)
    assert delete(lab, "Empty").json()["code"] == "STARTER_FILE_PROTECTED"


def test_practice_and_unpublished_activities_have_no_rules(lab) -> None:
    lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={"title": "Draft", "starter_files": STARTER})
    assert mkfile(lab, "Draft/main.py").status_code == 201            # a draft has no folder of its own yet
    assert delete(lab, "Draft/main.py").status_code == 204
    lab.student.post(f"{API}/practice/files", json={"path": "Lab 1/main.py", "content": "x"})
    tree = lab.student.get(f"{API}/practice/tree").json()["entries"]
    assert all(e["protected"] is False and e["read_only_reason"] is None for e in tree)


# ============================================================================== past due

def test_the_folder_becomes_read_only_at_the_due_date(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    mkfile(lab, "Lab 1/mine.py")
    mkfile(lab, "notes.py")
    set_due(db, a["id"], timedelta(seconds=-10))  # (margin: the Docker VM clock can step back)

    attempts = [save(lab, "Lab 1/main.py", "late edit"), save(lab, "Lab 1/mine.py", "late edit"),
                mkfile(lab, "Lab 1/new.py"),
                lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "Lab 1/sub", "is_folder": True}),
                rename(lab, "Lab 1/mine.py", "Lab 1/other.py"), rename(lab, "Lab 1/mine.py", "out.py"),
                rename(lab, "notes.py", "Lab 1/notes.py"), delete(lab, "Lab 1/mine.py"), delete(lab, "Lab 1/main.py")]
    for r in attempts:
        assert r.status_code == 403 and r.json()["code"] == "ACTIVITY_PAST_DUE", r.text
    detail = attempts[0].json()["detail"]
    assert detail.startswith("'Lab 1' was due on ") and detail.endswith(": its folder is read-only")

    main = entries(lab)["Lab 1/main.py"]
    assert lab.student.get(f"{API}/workspace/files/{main['id']}").json()["content"] == "print('starter')"  # readable
    assert save(lab, "notes.py", "the rest of the workspace is fine").status_code == 200


def test_the_due_time_is_shown_in_philippine_time(lab, db: Session) -> None:
    from datetime import datetime
    a = publish(lab, title="Lab 1", files=STARTER)
    db.expire_all()
    db.get(Activity, a["id"]).due_at = datetime(2026, 1, 14, 2, 0)    # 10:00 AM in the Philippines (UTC+8)
    db.commit()
    r = save(lab, "Lab 1/main.py", "x")
    assert r.json()["detail"] == "'Lab 1' was due on Jan 14, 10:00 AM: its folder is read-only"


def test_more_time_or_no_due_date_unlocks_it_at_once(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    set_due(db, a["id"], timedelta(seconds=-10))  # (margin: the Docker VM clock can step back)
    assert save(lab, "Lab 1/main.py", "x").json()["code"] == "ACTIVITY_PAST_DUE"
    assert submit(lab.student, a["id"]).json()["code"] == "ACTIVITY_PAST_DUE"

    later = (utcnow() + timedelta(days=1)).replace(microsecond=0).isoformat() + "Z"
    assert lab.teacher.patch(f"{API}/activities/{a['id']}", json={"due_at": later}).status_code == 200
    assert save(lab, "Lab 1/main.py", "more time").status_code == 200
    assert submit(lab.student, a["id"]).json()["status"] == "submitted"

    set_due(db, a["id"], timedelta(seconds=-10))  # (margin: the Docker VM clock can step back)
    assert lab.teacher.patch(f"{API}/activities/{a['id']}", json={"due_at": None}).status_code == 200
    assert save(lab, "Lab 1/main.py", "no deadline at all").status_code == 200


def test_reading_run_and_test_keep_working_past_due(lab, db: Session, monkeypatch) -> None:
    from app.services import execution_service
    monkeypatch.setattr(execution_service, "enqueue", lambda eid: None)
    monkeypatch.setattr(execution_service, "enqueue_job", lambda *a, **k: None)
    a = publish(lab, title="Lab 1", files=STARTER)
    lab.teacher.post(f"{API}/activities/{a['id']}/test-cases", json={"name": "t", "expected_output": "starter"})
    set_due(db, a["id"], timedelta(seconds=-10))  # (margin: the Docker VM clock can step back)
    assert lab.student.post(f"{API}/workspace/{lab.cid}/run", json={"entry_path": "Lab 1/main.py", "mode": "batch"}).status_code == 202
    from app.core.redis import get_redis
    for key in get_redis().scan_iter("run:cooldown:*"):
        get_redis().delete(key)
    from app.models.execution import Execution
    db.expire_all()
    for ex in db.query(Execution).all():
        ex.status = "ok"
    db.commit()
    r = lab.student.post(f"{API}/workspace/{lab.cid}/test", json={"activity_id": a["id"], "entry_path": "Lab 1/main.py"})
    assert r.status_code == 202


def test_the_lab_closed_rule_still_comes_first_before_the_due_date(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    set_due(db, a["id"], timedelta(days=1))
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    assert save(lab, "Lab 1/main.py", "x").json()["code"] == "LAB_CLOSED"


def test_archived_keeps_its_own_code(lab) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    lab.teacher.patch(f"{API}/activities/{a['id']}", json={"is_archived": True})
    assert save(lab, "Lab 1/main.py", "x").json()["code"] == "ACTIVITY_ARCHIVED"


# ============================================================================ tree flags

def test_the_tree_says_what_is_protected_and_what_is_read_only(lab, db: Session) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    publish(lab, title="Lab 2", files=[{"path": "main.py", "content": "x"}])
    mkfile(lab, "Lab 1/mine.py")
    mkfile(lab, "notes.py")
    tree = entries(lab)
    flags = {p: (e["protected"], e["read_only_reason"]) for p, e in tree.items()}
    assert flags["Lab 1"] == (True, None) and flags["Lab 1/main.py"] == (True, None)
    assert flags["Lab 1/data"] == (True, None) and flags["Lab 1/data/in.csv"] == (True, None)
    assert flags["Lab 1/mine.py"] == (False, None) and flags["notes.py"] == (False, None)

    set_due(db, a["id"], timedelta(seconds=-10))  # (margin: the Docker VM clock can step back)
    tree = entries(lab)
    reason = tree["Lab 1/main.py"]["read_only_reason"]
    assert reason.startswith("'Lab 1' was due on ") and reason.endswith(": its folder is read-only")
    for path in ("Lab 1", "Lab 1/data", "Lab 1/data/in.csv", "Lab 1/mine.py"):
        assert tree[path]["read_only_reason"] == reason
    assert tree["Lab 2/main.py"]["read_only_reason"] is None and tree["notes.py"]["read_only_reason"] is None
    # the 403 says the same thing
    assert save(lab, "Lab 1/mine.py", "x").json()["detail"] == reason


def test_save_and_rename_responses_carry_the_flags_too(lab) -> None:
    publish(lab, title="Lab 1", files=STARTER)
    r = save(lab, "Lab 1/main.py", "edited")
    assert r.json()["protected"] is True and r.json()["read_only_reason"] is None
    mkfile(lab, "Lab 1/a.py")
    r = rename(lab, "Lab 1/a.py", "Lab 1/b.py")
    assert r.json()["protected"] is False


def test_an_archived_folder_is_flagged_in_the_tree(lab) -> None:
    a = publish(lab, title="Lab 1", files=STARTER)
    lab.teacher.patch(f"{API}/activities/{a['id']}", json={"is_archived": True})
    tree = entries(lab)
    assert tree["Lab 1/main.py"]["read_only_reason"] == "'Lab 1' was archived by your instructor: its folder is read-only"
