"""GET /classes/{class_id}/my-submissions"""
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity import Activity
from app.models.user import Role
from tests.conftest import approved_student, login_as, new_class, new_code, new_room


def publish(lab, title: str, **extra) -> dict:
    body = {"title": title, "starter_files": [{"path": "main.py", "content": "print(1)"}], **extra}
    a = lab.teacher.post(f"/api/v1/classes/{lab.cid}/activities", json=body)
    assert a.status_code == 201, a.text
    assert lab.teacher.post(f"/api/v1/activities/{a.json()['id']}/publish").status_code == 200
    return a.json()


def submit(c: TestClient, activity_id: int):
    r = c.post(f"/api/v1/activities/{activity_id}/submit")
    assert r.status_code == 200, r.text
    return r.json()


def mine(c: TestClient, cid: int):
    return c.get(f"/api/v1/classes/{cid}/my-submissions")


def test_returns_only_my_own_submissions_one_per_activity(lab, db: Session) -> None:
    a1, a2, a3 = publish(lab, "Lab 1"), publish(lab, "Lab 2"), publish(lab, "Lab 3")
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    first, second = submit(lab.student, a1["id"]), submit(lab.student, a3["id"])
    submit(other, a1["id"])  # someone else's work, including the SAME activity
    submit(other, a2["id"])

    r = mine(lab.student, lab.cid)
    assert r.status_code == 200
    body = r.json()
    assert [row["activity_id"] for row in body] == [a1["id"], a3["id"]]  # a2 not submitted by me; ordered
    assert all(set(row) == {"activity_id", "status", "submitted_at"} for row in body)
    assert body[0]["status"] == "submitted" and body[0]["submitted_at"] == first["submitted_at"]
    assert body[1]["submitted_at"] == second["submitted_at"]
    assert body[0]["submitted_at"].endswith("Z")  # the shared UTC serializer

    assert [row["activity_id"] for row in mine(other, lab.cid).json()] == [a1["id"], a2["id"]]  # and vice versa


def test_nothing_submitted_gives_an_empty_list(lab) -> None:
    publish(lab, "Lab 1")
    r = mine(lab.student, lab.cid)
    assert r.status_code == 200 and r.json() == []


def test_a_resubmission_shows_the_latest_time_and_status(lab, db: Session) -> None:
    a = publish(lab, "Lab 1", due_at=(utcnow() + timedelta(hours=1)).isoformat() + "Z")
    first = submit(lab.student, a["id"])
    assert first["status"] == "submitted"

    second = submit(lab.student, a["id"])                # resubmitted before the deadline
    assert second["status"] == "submitted"

    rows = mine(lab.student, lab.cid).json()
    assert len(rows) == 1  # still one row for the activity
    assert rows[0] == {"activity_id": a["id"], "status": "submitted", "submitted_at": second["submitted_at"]}
    assert second["submitted_at"] >= first["submitted_at"]


def test_only_this_classes_submissions_are_returned(lab, db: Session) -> None:
    here = publish(lab, "Lab 1")
    other_cid = new_class(lab.teacher, "Other class")
    other_session = lab.teacher.post(f"/api/v1/classes/{other_cid}/sessions", json={
        "name": "B", "starts_at": "2030-01-01T10:00:00Z", "ends_at": "2030-01-01T11:00:00Z",
        "lab_id": new_room(lab.teacher)}).json()
    lab.teacher.patch(f"/api/v1/sessions/{other_session['id']}/open")
    elsewhere = lab.teacher.post(f"/api/v1/classes/{other_cid}/activities", json={
        "title": "Lab X", "starter_files": [{"path": "main.py", "content": "x"}]}).json()
    lab.teacher.post(f"/api/v1/activities/{elsewhere['id']}/publish")
    # the same student is approved in the second class too
    code = new_code(lab.teacher, other_cid)["code"]
    joined = lab.student.post("/api/v1/enroll", json={"code": code}).json()
    lab.teacher.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})

    submit(lab.student, here["id"])
    submit(lab.student, elsewhere["id"])
    assert [r["activity_id"] for r in mine(lab.student, lab.cid).json()] == [here["id"]]
    assert [r["activity_id"] for r in mine(lab.student, other_cid).json()] == [elsewhere["id"]]


def test_pending_unenrolled_and_removed_students_get_403(lab, db: Session) -> None:
    publish(lab, "Lab 1")
    pending = login_as(db, Role.STUDENT, "waiting")
    pending.post("/api/v1/enroll", json={"code": lab.code})
    unenrolled = login_as(db, Role.STUDENT, "stranger")
    other_cid = new_class(lab.teacher, "Other class")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")

    for c in (pending, unenrolled, outsider):
        r = mine(c, lab.cid)
        assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_MEMBER"

    enrollment = lab.teacher.get(f"/api/v1/classes/{lab.cid}/enrollments", params={"status": "approved"}).json()["items"][0]
    lab.teacher.patch(f"/api/v1/enrollments/{enrollment['id']}", json={"action": "remove"})
    assert mine(lab.student, lab.cid).status_code == 403  # access ends with the enrollment


def test_a_class_that_does_not_exist_is_also_403(lab) -> None:
    assert mine(lab.student, 999999).status_code == 403  # no way to probe which class ids exist


def test_instructors_admins_and_anonymous_are_refused(lab, db: Session) -> None:
    assert mine(lab.teacher, lab.cid).status_code == 403
    assert mine(login_as(db, Role.ADMIN, "root"), lab.cid).status_code == 403
    assert mine(TestClient(lab.student.app), lab.cid).status_code == 401


def test_works_while_the_lab_is_closed(lab) -> None:
    a = publish(lab, "Lab 1")
    submit(lab.student, a["id"])
    lab.teacher.patch(f"/api/v1/sessions/{lab.session_id}/close")
    assert len(mine(lab.student, lab.cid).json()) == 1  # reading never needs an open lab
