from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.invite_code import InviteCode
from app.models.lab_session import LabSession
from app.models.user import Role
from app.models.workspace import Workspace, WorkspaceFile
from tests.conftest import add_activity, iso, login_as, new_class, new_code, student_joins


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture()
def teacher(db: Session) -> TestClient:
    return login_as(db, Role.INSTRUCTOR, "teach1")


@pytest.fixture()
def cid(teacher: TestClient) -> int:
    return new_class(teacher)


def use_count(db: Session, code_id: int) -> int:
    db.rollback()  # end the read snapshot so we see what the API committed
    return db.get(InviteCode, code_id).use_count


def enrollment_rows(db: Session) -> int:
    db.rollback()  # end the read snapshot so we see what the API committed
    return db.scalar(select(func.count()).select_from(Enrollment))


def workspace_paths(db: Session) -> set[str]:
    db.rollback()  # end the read snapshot so we see what the API committed
    return set(db.scalars(select(WorkspaceFile.path)))


def pending(teacher: TestClient, cid: int) -> list[dict]:
    return teacher.get(f"/api/v1/classes/{cid}/enrollments", params={"status": "pending"}).json()["items"]


# ---------- joining with a code ----------

def test_join_creates_pending_enrollment_and_counts_use(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 201
    assert r.json()["status"] == "pending" and r.json()["class_id"] == cid
    assert use_count(db, code["id"]) == 1

    items = pending(teacher, cid)
    assert len(items) == 1 and items[0]["student"]["username"] == "stu1"
    assert teacher.get(f"/api/v1/classes/{cid}").json()["pending_count"] == 1


def test_join_does_not_create_workspace_before_approval(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid)
    student_joins(db, new_code(teacher, cid)["code"], "stu1")
    assert db.scalar(select(func.count()).select_from(Workspace)) == 0


def test_code_is_case_insensitive_and_trimmed(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.post("/api/v1/enroll", json={"code": f"  {code.lower()} "}).status_code == 201


def test_unknown_code(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": "ZZZZZZZZ"})
    assert r.status_code == 404 and r.json()["code"] == "CODE_NOT_FOUND"


def test_expired_code_rejected(db: Session, teacher: TestClient, cid: int) -> None:
    now = utc_now()
    code = new_code(teacher, cid, valid_from=iso(now - timedelta(days=2)), valid_until=iso(now - timedelta(minutes=1)))
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 400 and r.json()["code"] == "CODE_EXPIRED"
    assert enrollment_rows(db) == 0 and use_count(db, code["id"]) == 0


def test_code_not_yet_valid_rejected(db: Session, teacher: TestClient, cid: int) -> None:
    now = utc_now()
    code = new_code(teacher, cid, valid_from=iso(now + timedelta(hours=1)), valid_until=iso(now + timedelta(days=1)))
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 400 and r.json()["code"] == "CODE_NOT_YET_VALID"


def test_inactive_code_rejected_then_works_when_switched_on(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)
    teacher.patch(f"/api/v1/invite-codes/{code['id']}", json={"is_active": False})
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 400 and r.json()["code"] == "CODE_INACTIVE"
    assert enrollment_rows(db) == 0

    teacher.patch(f"/api/v1/invite-codes/{code['id']}", json={"is_active": True})
    assert c.post("/api/v1/enroll", json={"code": code["code"]}).status_code == 201


def test_max_uses_enforced(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid, max_uses=2)
    student_joins(db, code["code"], "stu1")
    student_joins(db, code["code"], "stu2")
    late = login_as(db, Role.STUDENT, "stu3")
    r = late.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 400 and r.json()["code"] == "CODE_EXHAUSTED"
    assert use_count(db, code["id"]) == 2 and enrollment_rows(db) == 2


def test_duplicate_join_returns_existing_row_and_uses_no_extra_code_use(
        db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid, max_uses=1)
    c, first = student_joins(db, code["code"], "stu1")

    again = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert again.status_code == 200  # not 201: nothing was created
    assert again.json()["enrollment_id"] == first["enrollment_id"]
    assert enrollment_rows(db) == 1 and use_count(db, code["id"]) == 1  # max_uses=1 not tripped


def test_duplicate_join_with_a_second_code_of_same_class(db: Session, teacher: TestClient, cid: int) -> None:
    c, first = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    second = new_code(teacher, cid)
    r = c.post("/api/v1/enroll", json={"code": second["code"]})
    assert r.json()["enrollment_id"] == first["enrollment_id"]
    assert enrollment_rows(db) == 1 and use_count(db, second["id"]) == 0


def test_duplicate_join_keeps_rejected_status(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)
    c, first = student_joins(db, code["code"], "stu1")
    teacher.patch(f"/api/v1/enrollments/{first['enrollment_id']}", json={"action": "reject"})
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.json()["status"] == "rejected"  # can't bypass the instructor by re-joining


def test_archived_class_cannot_be_joined(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)
    teacher.patch(f"/api/v1/classes/{cid}", json={"is_archived": True})
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post("/api/v1/enroll", json={"code": code["code"]})
    assert r.status_code == 400 and r.json()["code"] == "CLASS_ARCHIVED"
    assert use_count(db, code["id"]) == 0


@pytest.mark.parametrize("role", [Role.INSTRUCTOR, Role.ADMIN])
def test_only_students_can_enroll(db: Session, teacher: TestClient, cid: int, role: Role) -> None:
    code = new_code(teacher, cid)["code"]
    c = login_as(db, role, "notastudent")
    assert c.post("/api/v1/enroll", json={"code": code}).status_code == 403


# ---------- approve / reject ----------

def test_approve_creates_workspace_with_published_starter_files(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid, "Lab 1", files=[
        {"path": "main.py", "content": "print('hi')"},
        {"path": "data/nums.csv", "content": "a,b\n1,2"},
    ])
    add_activity(db, cid, "Draft Lab", published=False)
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    assert workspace_paths(db) == set()

    r = teacher.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "approved" and body["reviewed_at"].endswith("Z") and body["reviewed_by"]

    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(Workspace)) == 1
    assert workspace_paths(db) == {"Lab 1", "Lab 1/main.py", "Lab 1/data", "Lab 1/data/nums.csv"}
    main = db.scalars(select(WorkspaceFile).where(WorkspaceFile.path == "Lab 1/main.py")).one()
    assert main.content == "print('hi')" and main.size_bytes == len("print('hi')") and not main.is_folder
    assert db.scalars(select(WorkspaceFile).where(WorkspaceFile.path == "Lab 1")).one().is_folder
    assert teacher.get(f"/api/v1/classes/{cid}").json()["approved_count"] == 1


def test_approve_without_activities_still_creates_workspace(db: Session, teacher: TestClient, cid: int) -> None:
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    teacher.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(Workspace)) == 1


def test_approve_twice_is_idempotent(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid)
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"
    teacher.patch(url, json={"action": "approve"})
    assert teacher.patch(url, json={"action": "approve"}).json()["status"] == "approved"
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(Workspace)) == 1
    assert db.scalar(select(func.count()).select_from(WorkspaceFile)) == 2
    approvals = db.scalars(select(ActivityLog).where(ActivityLog.action == "enrollment_approve")).all()
    assert len(approvals) == 1  # the no-op second click is not audited


def test_reapproval_never_overwrites_student_files(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid, "Lab 1")
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"
    teacher.patch(url, json={"action": "approve"})

    f = db.scalars(select(WorkspaceFile).where(WorkspaceFile.path == "Lab 1/main.py")).one()
    f.content = "my own work"
    db.commit()

    teacher.patch(url, json={"action": "remove"})
    teacher.patch(url, json={"action": "approve"})
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalars(select(WorkspaceFile).where(WorkspaceFile.path == "Lab 1/main.py")).one().content == "my own work"
    assert db.scalar(select(func.count()).select_from(Workspace)) == 1


def test_reject_creates_no_workspace_and_can_be_reversed(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid)
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"

    assert teacher.patch(url, json={"action": "reject"}).json()["status"] == "rejected"
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(Workspace)) == 0
    assert pending(teacher, cid) == []

    assert teacher.patch(url, json={"action": "approve"}).json()["status"] == "approved"
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(Workspace)) == 1


def test_remove_keeps_workspace_data(db: Session, teacher: TestClient, cid: int) -> None:
    add_activity(db, cid)
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"
    teacher.patch(url, json={"action": "approve"})
    assert teacher.patch(url, json={"action": "remove"}).json()["status"] == "removed"
    db.rollback()  # end the read snapshot so we see what the API committed
    assert db.scalar(select(func.count()).select_from(WorkspaceFile)) == 2


@pytest.mark.parametrize("first,second", [("remove", None), ("approve", "reject"), ("reject", "remove")])
def test_invalid_transitions_conflict(db: Session, teacher: TestClient, cid: int, first: str, second: str | None) -> None:
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"
    if second is None:  # remove a still-pending enrollment
        r = teacher.patch(url, json={"action": first})
    else:
        teacher.patch(url, json={"action": first})
        r = teacher.patch(url, json={"action": second})
    assert r.status_code == 409 and r.json()["code"] == "INVALID_TRANSITION"


def test_unknown_action_and_missing_enrollment(teacher: TestClient) -> None:
    assert teacher.patch("/api/v1/enrollments/1", json={"action": "explode"}).status_code == 422
    r = teacher.patch("/api/v1/enrollments/99999", json={"action": "approve"})
    assert r.status_code == 404 and r.json()["code"] == "ENROLLMENT_NOT_FOUND"


def test_other_instructor_cannot_review_enrollment(db: Session, teacher: TestClient, cid: int) -> None:
    _, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    r = other.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})
    assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_OWNER"
    assert pending(teacher, cid)[0]["id"] == joined["enrollment_id"]  # still pending


def test_student_cannot_review_their_own_enrollment(db: Session, teacher: TestClient, cid: int) -> None:
    c, joined = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    assert c.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"}).status_code == 403


def test_review_actions_are_audited(db: Session, teacher: TestClient, cid: int) -> None:
    _, a = student_joins(db, new_code(teacher, cid)["code"], "stu1")
    _, b = student_joins(db, new_code(teacher, cid)["code"], "stu2")
    teacher.patch(f"/api/v1/enrollments/{a['enrollment_id']}", json={"action": "approve"})
    teacher.patch(f"/api/v1/enrollments/{b['enrollment_id']}", json={"action": "reject"})
    db.rollback()  # end the read snapshot so we see what the API committed
    actions = list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))
    assert "enrollment_approve" in actions and "enrollment_reject" in actions
    assert actions.count("enroll_request") == 2


# ---------- listing ----------

def test_enrollment_list_filters_and_paginates(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    ids = [student_joins(db, code, f"stu{i}")[1]["enrollment_id"] for i in range(5)]
    teacher.patch(f"/api/v1/enrollments/{ids[0]}", json={"action": "approve"})

    url = f"/api/v1/classes/{cid}/enrollments"
    assert teacher.get(url).json()["total"] == 5
    assert teacher.get(url, params={"status": "pending"}).json()["total"] == 4
    assert teacher.get(url, params={"status": "approved"}).json()["total"] == 1
    page2 = teacher.get(url, params={"page": 2, "size": 2}).json()
    assert len(page2["items"]) == 2 and page2["total"] == 5
    assert teacher.get(url, params={"size": 101}).status_code == 422
    assert teacher.get(url, params={"status": "bogus"}).status_code == 422


def test_enrollment_list_only_shows_this_class(db: Session, teacher: TestClient, cid: int) -> None:
    other_cid = new_class(teacher, "Other")
    student_joins(db, new_code(teacher, other_cid)["code"], "stu1")
    assert pending(teacher, cid) == []


# ---------- student's own view ----------

def test_my_classes_shows_status_and_lab_state(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    c, joined = student_joins(db, code, "stu1")

    mine = c.get("/api/v1/my/classes").json()
    assert mine["total"] == 1
    row = mine["items"][0]
    assert row["status"] == "pending" and row["class_name"] == "Programming 1"
    assert row["instructor_name"] == "Test User" and row["lab_open"] is False

    teacher.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})
    db.add(LabSession(class_id=cid, name="Session A", starts_at=utc_now(),
                      ends_at=utc_now() + timedelta(minutes=40), is_open=True, opened_at=utc_now()))
    db.commit()
    row = c.get("/api/v1/my/classes").json()["items"][0]
    assert row["status"] == "approved" and row["lab_open"] is True


def test_my_classes_is_private_and_hides_removed(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    c1, joined1 = student_joins(db, code, "stu1")
    c2, _ = student_joins(db, code, "stu2")
    assert c1.get("/api/v1/my/classes").json()["total"] == 1
    assert c2.get("/api/v1/my/classes").json()["items"][0]["enrollment_id"] != joined1["enrollment_id"]

    teacher.patch(f"/api/v1/enrollments/{joined1['enrollment_id']}", json={"action": "approve"})
    teacher.patch(f"/api/v1/enrollments/{joined1['enrollment_id']}", json={"action": "remove"})
    assert c1.get("/api/v1/my/classes").json()["total"] == 0


def test_my_classes_is_students_only(teacher: TestClient) -> None:
    assert teacher.get("/api/v1/my/classes").status_code == 403


def test_max_uses_holds_under_parallel_joins(db: Session, teacher: TestClient, cid: int) -> None:
    from concurrent.futures import ThreadPoolExecutor

    code = new_code(teacher, cid, max_uses=2)
    students = [login_as(db, Role.STUDENT, f"race{i}") for i in range(6)]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda c: c.post("/api/v1/enroll", json={"code": code["code"]}), students))

    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 201, 400, 400, 400, 400]
    assert use_count(db, code["id"]) == 2 and enrollment_rows(db) == 2
