from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.activity_log import ActivityLog
from app.models.submission import Submission, SubmissionFile
from app.models.user import Role
from tests.conftest import approved_student, iso, login_as, new_class, new_code

STARTER = [{"path": "main.py", "content": "print('starter')"}, {"path": "data/in.csv", "content": "a,b"}]


def publish(lab, title: str = "Lab 1", files=None, **extra) -> dict:
    body = {"title": title, "instructions": "do it", "starter_files": STARTER if files is None else files, **extra}
    a = lab.teacher.post(f"/api/v1/classes/{lab.cid}/activities", json=body)
    assert a.status_code == 201, a.text
    assert lab.teacher.post(f"/api/v1/activities/{a.json()['id']}/publish").status_code == 200
    return a.json()


def tree_entries(c: TestClient, cid: int) -> dict[str, dict]:
    return {e["path"]: e for e in c.get(f"/api/v1/workspace/{cid}/tree").json()["entries"]}


def submit(c: TestClient, activity_id: int):
    return c.post(f"/api/v1/activities/{activity_id}/submit")


def edit(c: TestClient, cid: int, path: str, content: str) -> None:
    e = tree_entries(c, cid)[path]
    r = c.put(f"/api/v1/workspace/files/{e['id']}", json={"content": content, "last_updated_at": e["updated_at"]})
    assert r.status_code == 200, r.text


def detail(c: TestClient, submission_id: int):
    return c.get(f"/api/v1/submissions/{submission_id}")


# ---------------------------------------------------------------- snapshot

def test_submit_snapshots_every_file_in_the_activity_folder(lab) -> None:
    a = publish(lab)
    edit(lab.student, lab.cid, "Lab 1/main.py", "print('my answer')")
    r = submit(lab.student, a["id"])
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "submitted" and body["file_count"] == 2 and body["submitted_at"].endswith("Z")

    files = detail(lab.student, body["id"]).json()["files"]
    assert files == [{"path": "Lab 1/data/in.csv", "content": "a,b"},
                     {"path": "Lab 1/main.py", "content": "print('my answer')"}]


def test_snapshot_is_unaffected_by_later_edits_deletes_and_renames(lab) -> None:
    a = publish(lab)
    edit(lab.student, lab.cid, "Lab 1/main.py", "version at submit time")
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Lab 1/mine.py", "content": "m"})
    sid = submit(lab.student, a["id"]).json()["id"]
    frozen = detail(lab.teacher, sid).json()["files"]

    # starter files can only be edited now; the student's own files can still be renamed and deleted
    edit(lab.student, lab.cid, "Lab 1/main.py", "edited AFTER submitting")
    entries = tree_entries(lab.student, lab.cid)
    lab.student.patch(f"/api/v1/workspace/files/{entries['Lab 1/mine.py']['id']}", json={"new_path": "Lab 1/moved.py"})
    lab.student.delete(f"/api/v1/workspace/files/{tree_entries(lab.student, lab.cid)['Lab 1/moved.py']['id']}")

    assert detail(lab.teacher, sid).json()["files"] == frozen
    assert {"path": "Lab 1/main.py", "content": "version at submit time"} in frozen
    assert {"path": "Lab 1/mine.py", "content": "m"} in frozen


def test_only_files_inside_the_activity_folder_are_included(lab) -> None:
    a = publish(lab, title="Lab 1")
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "notes.py", "content": "outside"})
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Lab 10/other.py", "content": "sibling"})
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Lab 1/extra/new.py", "content": "new"})

    sid = submit(lab.student, a["id"]).json()["id"]
    assert [f["path"] for f in detail(lab.student, sid).json()["files"]] == [
        "Lab 1/data/in.csv", "Lab 1/extra/new.py", "Lab 1/main.py"]


def test_empty_folders_are_not_submitted(lab) -> None:
    a = publish(lab, files=[{"path": "sub/x.py", "content": "x"}])
    sid = submit(lab.student, a["id"]).json()["id"]
    assert [f["path"] for f in detail(lab.student, sid).json()["files"]] == ["Lab 1/sub/x.py"]


def test_nothing_to_submit_is_rejected(lab) -> None:
    a = publish(lab, files=[])
    r = submit(lab.student, a["id"])
    assert r.status_code == 400 and r.json()["code"] == "EMPTY_SUBMISSION"

    b = publish(lab, title="Lab 2")
    folder = tree_entries(lab.student, lab.cid)["Lab 2"]
    r = lab.student.delete(f"/api/v1/workspace/files/{folder['id']}")   # the activity folder cannot be deleted any more
    assert r.status_code == 403 and r.json()["code"] == "STARTER_FILE_PROTECTED"
    assert submit(lab.student, b["id"]).status_code == 200


# -------------------------------------------------------------- resubmit

def test_resubmitting_replaces_the_old_submission(lab, db: Session) -> None:
    a = publish(lab)
    first = submit(lab.student, a["id"]).json()
    edit(lab.student, lab.cid, "Lab 1/main.py", "second attempt")
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Lab 1/more.py", "content": "m"})
    second = submit(lab.student, a["id"]).json()

    assert second["id"] == first["id"] and second["file_count"] == 3
    db.rollback()
    assert db.scalar(select(func.count()).select_from(Submission)) == 1
    assert db.scalar(select(func.count()).select_from(SubmissionFile)) == 3  # old files were replaced, not added to
    files = {f["path"]: f["content"] for f in detail(lab.teacher, second["id"]).json()["files"]}
    assert files["Lab 1/main.py"] == "second attempt" and "Lab 1/more.py" in files


def test_resubmit_with_fewer_files_drops_the_removed_ones(lab) -> None:
    a = publish(lab)
    lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "Lab 1/extra.py", "content": "x"})
    sid = submit(lab.student, a["id"]).json()["id"]
    lab.student.delete(f"/api/v1/workspace/files/{tree_entries(lab.student, lab.cid)['Lab 1/extra.py']['id']}")
    submit(lab.student, a["id"])
    assert [f["path"] for f in detail(lab.student, sid).json()["files"]] == ["Lab 1/data/in.csv", "Lab 1/main.py"]


def test_each_student_has_their_own_submission(lab, db: Session) -> None:
    a = publish(lab)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    s1, s2 = submit(lab.student, a["id"]).json(), submit(other, a["id"]).json()
    assert s1["id"] != s2["id"] and s1["student_id"] != s2["student_id"]


# ----------------------------------------------------------------- late

def set_due(db: Session, activity_id: int, due: datetime | None) -> None:
    db.rollback()
    db.get(Activity, activity_id).due_at = due
    db.commit()


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_no_submissions_after_the_due_date(lab, db: Session) -> None:
    a = publish(lab, due_at=iso(now() + timedelta(hours=1)))
    assert submit(lab.student, a["id"]).json()["status"] == "submitted"

    set_due(db, a["id"], now() - timedelta(minutes=1))
    r = submit(lab.student, a["id"])                     # no late submissions (nor late resubmissions)
    assert r.status_code == 403 and r.json()["code"] == "ACTIVITY_PAST_DUE"
    assert r.json()["detail"].startswith("'Lab 1' was due on ") and r.json()["detail"].endswith(": submissions are closed")

    set_due(db, a["id"], now() + timedelta(days=1))      # the instructor gives more time
    assert submit(lab.student, a["id"]).json()["status"] == "submitted"
    set_due(db, a["id"], None)                           # or removes the deadline
    assert submit(lab.student, a["id"]).status_code == 200


def test_no_due_date_is_never_late(lab) -> None:
    assert submit(lab.student, publish(lab)["id"]).json()["status"] == "submitted"


def test_old_late_rows_are_kept_and_listed_as_late(lab, db: Session) -> None:
    a = publish(lab)
    sid = submit(lab.student, a["id"]).json()["id"]
    db.rollback()
    db.get(Submission, sid).status = "late"              # a row from before the rule
    db.commit()
    items = lab.teacher.get(f"/api/v1/activities/{a['id']}/submissions").json()["items"]
    assert items[0]["status"] == "late"


# ------------------------------------------------------- lab open/closed

def test_submit_works_while_the_lab_is_closed(lab) -> None:
    a = publish(lab)
    lab.teacher.patch(f"/api/v1/sessions/{lab.session_id}/close")
    assert lab.student.post(f"/api/v1/workspace/{lab.cid}/files", json={"path": "x.py"}).status_code == 403
    assert submit(lab.student, a["id"]).status_code == 200  # deadline-based, not lab-session-based


# ----------------------------------------------------------- permissions

def test_cannot_submit_unpublished_or_unknown_activities(lab) -> None:
    draft = lab.teacher.post(f"/api/v1/classes/{lab.cid}/activities", json={"title": "Draft"}).json()
    r = submit(lab.student, draft["id"])
    assert r.status_code == 404 and r.json()["code"] == "ACTIVITY_NOT_FOUND"
    assert submit(lab.student, 99999).status_code == 404


def test_only_approved_members_of_the_class_can_submit(lab, db: Session) -> None:
    a = publish(lab)
    pending = login_as(db, Role.STUDENT, "waiting")
    pending.post("/api/v1/enroll", json={"code": lab.code})
    other_cid = new_class(lab.teacher, "Other")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")
    for c in (pending, outsider):
        r = submit(c, a["id"])
        assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_MEMBER"


def test_instructors_and_admins_cannot_submit(lab, db: Session) -> None:
    a = publish(lab)
    admin = login_as(db, Role.ADMIN, "root")
    assert submit(lab.teacher, a["id"]).status_code == 403
    assert submit(admin, a["id"]).status_code == 403
    assert submit(TestClient(lab.student.app), a["id"]).status_code == 401


def test_instructor_lists_and_reads_submissions(lab, db: Session) -> None:
    a = publish(lab)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    submit(lab.student, a["id"])
    submit(other, a["id"])

    page = lab.teacher.get(f"/api/v1/activities/{a['id']}/submissions").json()
    assert page["total"] == 2 and {i["student"]["username"] for i in page["items"]} == {"stu1", "stu2"}
    assert all(i["file_count"] == 2 for i in page["items"])
    assert lab.teacher.get(f"/api/v1/activities/{a['id']}/submissions", params={"size": 1}).json()["items"].__len__() == 1
    assert lab.teacher.get(f"/api/v1/activities/{a['id']}/submissions", params={"size": 101}).status_code == 422

    d = detail(lab.teacher, page["items"][0]["id"]).json()
    assert d["student"]["username"] in {"stu1", "stu2"} and len(d["files"]) == 2


def test_other_instructor_cannot_see_submissions(lab, db: Session) -> None:
    a = publish(lab)
    sid = submit(lab.student, a["id"]).json()["id"]
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    assert other_teacher.get(f"/api/v1/activities/{a['id']}/submissions").json()["code"] == "NOT_CLASS_OWNER"
    assert detail(other_teacher, sid).json()["code"] == "NOT_CLASS_OWNER"
    assert lab.teacher.get("/api/v1/activities/99999/submissions").status_code == 404


def test_students_see_only_their_own_submission(lab, db: Session) -> None:
    a = publish(lab)
    sid = submit(lab.student, a["id"]).json()["id"]
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    assert detail(lab.student, sid).status_code == 200
    r = detail(other, sid)
    assert r.status_code == 404 and r.json()["code"] == "SUBMISSION_NOT_FOUND"
    assert other.get(f"/api/v1/activities/{a['id']}/submissions").status_code == 403  # listing is instructor-only
    assert detail(lab.student, 99999).status_code == 404
    assert detail(login_as(db, Role.ADMIN, "root"), sid).status_code == 403


def test_submit_is_audited(lab, db: Session) -> None:
    a = publish(lab)
    sid = submit(lab.student, a["id"]).json()["id"]
    db.rollback()
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "submit")).one()
    assert log.details == {"activity_id": a["id"], "submission_id": sid, "files": 2, "status": "submitted"}
