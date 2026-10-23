import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from app.models.workspace import Workspace, WorkspaceFile
from tests.conftest import approved_student, login_as, new_class, new_code, student_joins

FILES = [{"path": "main.py", "content": "print('hello')"}, {"path": "data/nums.csv", "content": "a,b\n1,2"}]


@pytest.fixture()
def teacher(db: Session) -> TestClient:
    return login_as(db, Role.INSTRUCTOR, "teach1")


@pytest.fixture()
def cid(teacher: TestClient) -> int:
    return new_class(teacher)


def create(teacher: TestClient, cid: int, title: str = "Lab 1", **kw):
    body = {"title": title, "instructions": "Do it", "starter_files": FILES, **kw}
    return teacher.post(f"/api/v1/classes/{cid}/activities", json=body)


def publish(teacher: TestClient, activity_id: int):
    return teacher.post(f"/api/v1/activities/{activity_id}/publish")


def paths_of(db: Session, student_username: str) -> dict[str, WorkspaceFile]:
    db.rollback()
    student = db.scalars(select(User).where(User.username == student_username)).one()
    ws = db.scalars(select(Workspace).where(Workspace.student_id == student.id)).one()
    return {f.path: f for f in db.scalars(select(WorkspaceFile).where(WorkspaceFile.workspace_id == ws.id))}


# ---------- create / validate ----------

def test_create_activity_is_a_draft(teacher: TestClient, cid: int) -> None:
    r = create(teacher, cid, due_at="2030-05-01T10:00:00+08:00")
    assert r.status_code == 201
    body = r.json()
    assert body["is_published"] is False and body["title"] == "Lab 1"
    assert body["due_at"] == "2030-05-01T02:00:00Z"
    assert [f["path"] for f in body["starter_files"]] == ["main.py", "data/nums.csv"]


@pytest.mark.parametrize("title", ["a/b", "../evil", ".hidden", " ", "x" * 151, "bad\\name", "a\x00b"])
def test_bad_titles_rejected(teacher: TestClient, cid: int, title: str) -> None:
    r = create(teacher, cid, title=title)
    assert r.status_code in (400, 422)
    assert r.json()["code"] in ("INVALID_TITLE", "VALIDATION_ERROR")


@pytest.mark.parametrize("path", ["../x.py", "/etc/x.py", "a\\b.py", "a//b.py", ".env.py", "x.exe", "noext", "a/"])
def test_bad_starter_paths_rejected(teacher: TestClient, cid: int, path: str) -> None:
    r = create(teacher, cid, starter_files=[{"path": path, "content": ""}])
    assert r.status_code == 400
    assert r.json()["code"] in ("INVALID_PATH", "INVALID_EXTENSION")


def test_starter_file_limits(teacher: TestClient, cid: int) -> None:
    big = create(teacher, cid, starter_files=[{"path": "a.py", "content": "x" * (100 * 1024 + 1)}])
    assert big.status_code == 400 and big.json()["code"] == "FILE_TOO_LARGE"

    dup = create(teacher, cid, starter_files=[{"path": "a.py"}, {"path": "A.py"}])
    assert dup.status_code == 400 and dup.json()["code"] == "INVALID_STARTER_FILES"

    many = create(teacher, cid, starter_files=[{"path": f"f{i}.py"} for i in range(51)])
    assert many.status_code == 400

    long_path = "d/" * 120 + "a.py"  # fine alone, too long once "{title}/" is prepended
    assert create(teacher, cid, title="T" * 20, starter_files=[{"path": long_path}]).status_code == 400


def test_title_must_be_unique_within_class(teacher: TestClient, cid: int) -> None:
    assert create(teacher, cid).status_code == 201
    r = create(teacher, cid)
    assert r.status_code == 409 and r.json()["code"] == "TITLE_TAKEN"
    assert create(teacher, cid, title="lab 1").status_code == 409  # case-insensitive, same folder name
    assert create(teacher, new_class(teacher, "Other"), title="Lab 1").status_code == 201  # other class is fine


def test_only_the_owning_instructor_manages_activities(db: Session, teacher: TestClient, cid: int) -> None:
    activity = create(teacher, cid).json()
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    student = login_as(db, Role.STUDENT, "stu1")
    admin = login_as(db, Role.ADMIN, "root")

    for c in (other, student, admin):
        assert c.post(f"/api/v1/classes/{cid}/activities", json={"title": "Hack"}).status_code == 403
        assert c.patch(f"/api/v1/activities/{activity['id']}", json={"instructions": "x"}).status_code == 403
        assert c.post(f"/api/v1/activities/{activity['id']}/publish").status_code == 403
    assert other.get(f"/api/v1/activities/{activity['id']}").json()["code"] == "NOT_CLASS_MEMBER"
    assert other.get(f"/api/v1/classes/{cid}/activities").status_code == 403
    assert admin.get(f"/api/v1/activities/{activity['id']}").status_code == 403
    assert teacher.get(f"/api/v1/activities/{activity['id']}").json()["is_published"] is False


# ---------- student visibility ----------

def test_students_only_see_published_activities_of_their_class(db: Session, teacher: TestClient, cid: int) -> None:
    draft = create(teacher, cid, title="Draft").json()
    live = create(teacher, cid, title="Live").json()
    publish(teacher, live["id"])
    code = new_code(teacher, cid)["code"]
    student = approved_student(db, teacher, cid, code, "stu1")
    unapproved, _ = student_joins(db, code, "stu2")

    listing = student.get(f"/api/v1/classes/{cid}/activities").json()
    assert [a["title"] for a in listing["items"]] == ["Live"] and listing["total"] == 1
    assert student.get(f"/api/v1/activities/{live['id']}").json()["instructions"] == "Do it"
    r = student.get(f"/api/v1/activities/{draft['id']}")  # a draft looks like it doesn't exist
    assert r.status_code == 404 and r.json()["code"] == "ACTIVITY_NOT_FOUND"

    assert unapproved.get(f"/api/v1/classes/{cid}/activities").status_code == 403
    assert unapproved.get(f"/api/v1/activities/{live['id']}").status_code == 403
    teacher_view = teacher.get(f"/api/v1/classes/{cid}/activities").json()
    assert teacher_view["total"] == 2


def test_student_of_another_class_cannot_read_activity(db: Session, teacher: TestClient, cid: int) -> None:
    live = create(teacher, cid).json()
    publish(teacher, live["id"])
    other_cid = new_class(teacher, "Other")
    outsider = approved_student(db, teacher, other_cid, new_code(teacher, other_cid)["code"], "stu9")
    assert outsider.get(f"/api/v1/activities/{live['id']}").status_code == 403
    assert outsider.get(f"/api/v1/classes/{cid}/activities").status_code == 403


# ---------- update ----------

def test_update_before_publish(teacher: TestClient, cid: int) -> None:
    a = create(teacher, cid).json()
    r = teacher.patch(f"/api/v1/activities/{a['id']}", json={
        "title": "Renamed", "starter_files": [{"path": "new.py", "content": "1"}]})
    assert r.status_code == 200
    assert r.json()["title"] == "Renamed" and [f["path"] for f in r.json()["starter_files"]] == ["new.py"]


def test_update_validates_and_checks_title_uniqueness(teacher: TestClient, cid: int) -> None:
    create(teacher, cid, title="Taken")
    a = create(teacher, cid, title="Mine").json()
    url = f"/api/v1/activities/{a['id']}"
    assert teacher.patch(url, json={"title": "Taken"}).json()["code"] == "TITLE_TAKEN"
    assert teacher.patch(url, json={"title": "a/b"}).json()["code"] == "INVALID_TITLE"
    assert teacher.patch(url, json={"starter_files": [{"path": "../x.py"}]}).json()["code"] == "INVALID_PATH"
    assert teacher.patch(url, json={"title": "Mine"}).status_code == 200  # same title as itself is fine


def test_renaming_revalidates_existing_starter_paths(teacher: TestClient, cid: int) -> None:
    a = create(teacher, cid, title="T", starter_files=[{"path": "d/" * 100 + "a.py"}]).json()
    r = teacher.patch(f"/api/v1/activities/{a['id']}", json={"title": "T" * 100})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATH"


def test_instructions_and_due_date_stay_editable_after_publish(teacher: TestClient, cid: int) -> None:
    a = create(teacher, cid, due_at="2030-01-01T00:00:00Z").json()
    publish(teacher, a["id"])
    url = f"/api/v1/activities/{a['id']}"
    r = teacher.patch(url, json={"instructions": "Updated", "due_at": None})
    assert r.status_code == 200 and r.json()["instructions"] == "Updated" and r.json()["due_at"] is None

    locked = teacher.patch(url, json={"title": "New title"})
    assert locked.status_code == 409 and locked.json()["code"] == "ACTIVITY_PUBLISHED"
    assert teacher.patch(url, json={"starter_files": []}).json()["code"] == "ACTIVITY_PUBLISHED"


# ---------- publish ----------

def test_publish_creates_folder_and_files_for_every_approved_student(
        db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    approved_student(db, teacher, cid, code, "stu1")
    approved_student(db, teacher, cid, code, "stu2")
    a = create(teacher, cid).json()

    r = publish(teacher, a["id"])
    assert r.status_code == 200 and r.json()["is_published"] is True

    for name in ("stu1", "stu2"):
        files = paths_of(db, name)
        assert set(files) == {"Lab 1", "Lab 1/main.py", "Lab 1/data", "Lab 1/data/nums.csv"}
        assert files["Lab 1"].is_folder and files["Lab 1/data"].is_folder
        assert files["Lab 1/main.py"].content == "print('hello')" and not files["Lab 1/main.py"].is_folder


def test_publish_skips_students_who_are_not_approved(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    approved_student(db, teacher, cid, code, "okstu")
    student_joins(db, code, "waiting")
    _, rej = student_joins(db, code, "rejected")
    teacher.patch(f"/api/v1/enrollments/{rej['enrollment_id']}", json={"action": "reject"})
    _, gone = student_joins(db, code, "removed")
    url = f"/api/v1/enrollments/{gone['enrollment_id']}"
    teacher.patch(url, json={"action": "approve"})
    teacher.patch(url, json={"action": "remove"})

    publish(teacher, create(teacher, cid).json()["id"])
    db.rollback()
    owners = set(db.scalars(
        select(User.username).join(Workspace, Workspace.student_id == User.id)
        .join(WorkspaceFile, WorkspaceFile.workspace_id == Workspace.id).where(WorkspaceFile.path == "Lab 1")))
    assert owners == {"okstu"}


def test_publish_never_overwrites_existing_student_files(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    approved_student(db, teacher, cid, code, "stu1")
    approved_student(db, teacher, cid, code, "stu2")

    # stu1 already has their own "Lab 1/main.py" (and a folder with that name)
    student = db.scalars(select(User).where(User.username == "stu1")).one()
    ws = db.scalars(select(Workspace).where(Workspace.student_id == student.id)).one()
    db.add_all([
        WorkspaceFile(workspace_id=ws.id, path="Lab 1", is_folder=True),
        WorkspaceFile(workspace_id=ws.id, path="Lab 1/main.py", content="MY OWN CODE", size_bytes=11),
    ])
    db.commit()

    assert publish(teacher, create(teacher, cid).json()["id"]).status_code == 200

    mine = paths_of(db, "stu1")
    assert mine["Lab 1/main.py"].content == "MY OWN CODE"  # untouched
    assert "Lab 1/data/nums.csv" in mine  # the files they lacked were still added
    assert paths_of(db, "stu2")["Lab 1/main.py"].content == "print('hello')"


def test_publish_twice_conflicts(teacher: TestClient, cid: int) -> None:
    a = create(teacher, cid).json()
    assert publish(teacher, a["id"]).status_code == 200
    r = publish(teacher, a["id"])
    assert r.status_code == 409 and r.json()["code"] == "ACTIVITY_ALREADY_PUBLISHED"


def test_publish_with_no_students_or_no_files(teacher: TestClient, cid: int, db: Session) -> None:
    a = create(teacher, cid, starter_files=[]).json()
    assert publish(teacher, a["id"]).status_code == 200
    approved_student(db, teacher, cid, new_code(teacher, cid)["code"], "late")  # joins after publish
    assert set(paths_of(db, "late")) == {"Lab 1"}  # approval installs it (even with no files, just the folder)


def test_student_approved_after_publish_gets_the_folder(db: Session, teacher: TestClient, cid: int) -> None:
    publish(teacher, create(teacher, cid).json()["id"])
    approved_student(db, teacher, cid, new_code(teacher, cid)["code"], "late")
    assert "Lab 1/main.py" in paths_of(db, "late")


def test_publish_is_atomic_when_a_student_has_no_workspace_yet(db: Session, teacher: TestClient, cid: int) -> None:
    """An approved enrollment without a workspace row (e.g. data repair) must not break publish."""
    code = new_code(teacher, cid)["code"]
    approved_student(db, teacher, cid, code, "stu1")
    db.rollback()
    db.execute(Workspace.__table__.delete())
    db.commit()
    assert publish(teacher, create(teacher, cid).json()["id"]).status_code == 200
    assert "Lab 1/main.py" in paths_of(db, "stu1")


def test_publish_event_and_audit(db: Session, teacher: TestClient, cid: int, listen) -> None:
    approved_student(db, teacher, cid, new_code(teacher, cid)["code"], "stu1")
    a = create(teacher, cid).json()
    events = listen(f"class:{cid}")

    publish(teacher, a["id"])
    assert events.messages() == [{"type": "activity_published", "activity_id": a["id"], "title": "Lab 1"}]

    publish(teacher, a["id"])  # rejected duplicate publishes nothing
    assert events.messages() == []

    db.rollback()
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "activity_publish")).one()
    assert log.details == {"activity_id": a["id"], "students": 1}


def test_publish_scales_to_a_whole_class(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    for i in range(12):
        approved_student(db, teacher, cid, code, f"s{i:02d}")
    publish(teacher, create(teacher, cid).json()["id"])
    db.rollback()
    assert db.scalar(select(func.count()).select_from(WorkspaceFile).where(WorkspaceFile.path == "Lab 1")) == 12
