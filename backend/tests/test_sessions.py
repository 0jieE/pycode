from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.main import app as main_app
from app.models.activity_log import ActivityLog
from app.models.lab_session import LabSession
from app.models.user import Role
from app.services import session_service
from tests.conftest import (
    approved_student,
    iso,
    login_as,
    new_class,
    new_room,
    new_code,
    new_session,
    student_joins,
)


@pytest.fixture()
def teacher(db: Session) -> TestClient:
    return login_as(db, Role.INSTRUCTOR, "teach1")


@pytest.fixture()
def cid(teacher: TestClient) -> int:
    return new_class(teacher)


def patch(c: TestClient, session_id: int, action: str):
    return c.patch(f"/api/v1/sessions/{session_id}/{action}")


# ---------- create / list ----------

def test_create_session_starts_closed(teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid, "Week 1")
    assert s["is_open"] is False and s["opened_at"] is None and s["closed_at"] is None
    assert s["name"] == "Week 1" and s["starts_at"].endswith("Z") and isinstance(s["lab_id"], int)
    assert "batch_name" not in s


def test_a_session_needs_a_lab(teacher: TestClient, cid: int) -> None:
    body = {"name": "Week 1", "starts_at": "2030-01-01T10:00:00Z", "ends_at": "2030-01-01T11:00:00Z"}
    r = teacher.post(f"/api/v1/classes/{cid}/sessions", json=body)
    assert r.status_code == 422 and "lab_id" in r.json()["detail"]
    r = teacher.post(f"/api/v1/classes/{cid}/sessions", json={**body, "lab_id": None})
    assert r.status_code == 422
    r = teacher.post(f"/api/v1/classes/{cid}/sessions", json={**body, "lab_id": 999999})
    assert r.status_code == 404 and r.json()["code"] == "LAB_NOT_FOUND"
    # the old field name is not accepted in its place
    assert teacher.post(f"/api/v1/classes/{cid}/sessions", json={
        "batch_name": "Week 1", **{k: v for k, v in body.items() if k != "name"},
        "lab_id": new_room(teacher)}).status_code == 422


def test_session_window_validated(teacher: TestClient, cid: int) -> None:
    r = teacher.post(f"/api/v1/classes/{cid}/sessions", json={
        "name": "B", "starts_at": "2030-01-01T10:00:00Z", "ends_at": "2030-01-01T09:00:00Z", "lab_id": new_room(teacher)})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_SESSION_WINDOW"
    assert teacher.post(f"/api/v1/classes/{cid}/sessions", json={
        "name": "", "starts_at": "2030-01-01T10:00:00Z", "ends_at": "2030-01-01T11:00:00Z",
        "lab_id": new_room(teacher)}).status_code == 422


def test_cannot_create_or_open_in_archived_class(teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid)
    teacher.patch(f"/api/v1/classes/{cid}", json={"is_archived": True})
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    r = teacher.post(f"/api/v1/classes/{cid}/sessions",
                     json={"name": "B", "starts_at": iso(now), "ends_at": iso(now + timedelta(hours=1)),
                           "lab_id": new_room(teacher)})
    assert r.status_code == 400 and r.json()["code"] == "CLASS_ARCHIVED"
    assert patch(teacher, s["id"], "open").json()["code"] == "CLASS_ARCHIVED"


def test_list_sessions_paginated(teacher: TestClient, cid: int) -> None:
    for i in range(3):
        new_session(teacher, cid, f"Batch {i}")
    page = teacher.get(f"/api/v1/classes/{cid}/sessions", params={"size": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert teacher.get(f"/api/v1/classes/{cid}/sessions", params={"size": 101}).status_code == 422


# ---------- permissions ----------

def test_only_the_owning_instructor_controls_sessions(db: Session, teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid)
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    student = login_as(db, Role.STUDENT, "stu1")
    admin = login_as(db, Role.ADMIN, "root")

    for c, expected in [(other, 403), (student, 403), (admin, 403)]:
        assert patch(c, s["id"], "open").status_code == expected
        assert patch(c, s["id"], "close").status_code == expected
        assert c.post(f"/api/v1/classes/{cid}/sessions", json={
            "name": "x", "starts_at": "2030-01-01T10:00:00Z",
            "ends_at": "2030-01-01T11:00:00Z", "lab_id": 1}).status_code == expected
        assert c.get(f"/api/v1/classes/{cid}/sessions").status_code == expected
    assert patch(other, s["id"], "open").json()["code"] == "NOT_CLASS_OWNER"
    assert patch(teacher, 99999, "open").json()["code"] == "SESSION_NOT_FOUND"

    db.rollback()
    assert db.get(LabSession, s["id"]).is_open is False  # nothing changed


def test_anonymous_cannot_control_sessions(client: TestClient) -> None:
    assert client.patch("/api/v1/sessions/1/open").status_code == 401


# ---------- open / close ----------

def test_open_and_close_session(teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid)
    opened = patch(teacher, s["id"], "open").json()
    assert opened["is_open"] is True and opened["opened_at"].endswith("Z") and opened["closed_at"] is None

    closed = patch(teacher, s["id"], "close").json()
    assert closed["is_open"] is False and closed["closed_at"].endswith("Z")


def test_only_one_open_session_per_class(teacher: TestClient, cid: int) -> None:
    a, b = new_session(teacher, cid, "A"), new_session(teacher, cid, "B")
    assert patch(teacher, a["id"], "open").status_code == 200

    r = patch(teacher, b["id"], "open")
    assert r.status_code == 409 and r.json()["code"] == "SESSION_ALREADY_OPEN"
    assert "A" in r.json()["detail"]

    patch(teacher, a["id"], "close")
    assert patch(teacher, b["id"], "open").status_code == 200


def test_opening_an_open_session_is_idempotent_and_closing_a_closed_one_too(
        teacher: TestClient, cid: int, db: Session) -> None:
    s = new_session(teacher, cid)
    first = patch(teacher, s["id"], "open").json()
    again = patch(teacher, s["id"], "open")
    assert again.status_code == 200 and again.json()["opened_at"] == first["opened_at"]

    assert patch(teacher, s["id"], "close").status_code == 200
    assert patch(teacher, s["id"], "close").status_code == 200
    db.rollback()
    actions = list(db.scalars(select(ActivityLog.action).where(ActivityLog.action.like("session_%"))))
    assert sorted(actions) == ["session_close", "session_create", "session_open"]  # no-ops not audited


def test_session_can_be_reopened_after_closing(teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid)
    patch(teacher, s["id"], "open")
    patch(teacher, s["id"], "close")
    again = patch(teacher, s["id"], "open").json()
    assert again["is_open"] is True and again["closed_at"] is None


def test_open_sessions_are_per_class(teacher: TestClient, cid: int) -> None:
    other_cid = new_class(teacher, "Other class")
    a, b = new_session(teacher, cid), new_session(teacher, other_cid)
    assert patch(teacher, a["id"], "open").status_code == 200
    assert patch(teacher, b["id"], "open").status_code == 200


def test_parallel_opens_only_one_wins(teacher: TestClient, cid: int) -> None:
    sessions = [new_session(teacher, cid, f"B{i}") for i in range(4)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda s: patch(teacher, s["id"], "open"), sessions))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    current = teacher.get(f"/api/v1/classes/{cid}/sessions").json()["items"]
    assert sum(1 for s in current if s["is_open"]) == 1


def test_session_actions_audited(teacher: TestClient, cid: int, db: Session) -> None:
    s = new_session(teacher, cid)
    patch(teacher, s["id"], "open")
    patch(teacher, s["id"], "close")
    db.rollback()
    actions = list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))
    assert actions[-3:] == ["session_create", "session_open", "session_close"]


# ---------- current session ----------

def test_current_session_visibility(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    student = approved_student(db, teacher, cid, code, "stu1")
    pending, _ = student_joins(db, code, "stu2")
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    s = new_session(teacher, cid)
    url = f"/api/v1/classes/{cid}/sessions/current"

    assert teacher.get(url).json() is None and student.get(url).json() is None  # lab closed
    patch(teacher, s["id"], "open")
    assert teacher.get(url).json()["id"] == s["id"]
    assert student.get(url).json()["is_open"] is True

    assert pending.get(url).status_code == 403  # not approved yet
    assert pending.get(url).json()["code"] == "NOT_CLASS_MEMBER"
    assert other_teacher.get(url).status_code == 403
    assert login_as(db, Role.ADMIN, "root").get(url).status_code == 403
    assert teacher.get("/api/v1/classes/99999/sessions/current").status_code == 404


def test_removed_student_loses_access_to_current_session(db: Session, teacher: TestClient, cid: int) -> None:
    code = new_code(teacher, cid)["code"]
    c, joined = student_joins(db, code, "stu1")
    url = f"/api/v1/enrollments/{joined['enrollment_id']}"
    teacher.patch(url, json={"action": "approve"})
    teacher.patch(url, json={"action": "remove"})
    assert c.get(f"/api/v1/classes/{cid}/sessions/current").status_code == 403


def test_my_classes_lab_open_follows_the_session(db: Session, teacher: TestClient, cid: int) -> None:
    student = approved_student(db, teacher, cid, new_code(teacher, cid)["code"], "stu1")
    s = new_session(teacher, cid)
    assert student.get("/api/v1/my/classes").json()["items"][0]["lab_open"] is False
    patch(teacher, s["id"], "open")
    assert student.get("/api/v1/my/classes").json()["items"][0]["lab_open"] is True
    patch(teacher, s["id"], "close")
    assert student.get("/api/v1/my/classes").json()["items"][0]["lab_open"] is False


# ---------- Redis events ----------

def test_closing_publishes_session_closed_on_the_class_channel(
        teacher: TestClient, cid: int, listen) -> None:
    s = new_session(teacher, cid)
    patch(teacher, s["id"], "open")
    events = listen(f"class:{cid}")

    patch(teacher, s["id"], "close")
    assert events.messages() == [{"type": "session_closed"}]

    patch(teacher, s["id"], "close")  # already closed: nothing is announced again
    assert events.messages() == []


def test_opening_publishes_session_opened_and_only_on_its_own_class(
        teacher: TestClient, cid: int, listen) -> None:
    other_cid = new_class(teacher, "Other")
    mine, theirs = listen(f"class:{cid}"), listen(f"class:{other_cid}")
    s = new_session(teacher, cid)

    patch(teacher, s["id"], "open")
    assert mine.messages() == [{"type": "session_opened"}]
    assert theirs.messages() == []


def test_failed_open_publishes_nothing(teacher: TestClient, cid: int, listen) -> None:
    a, b = new_session(teacher, cid, "A"), new_session(teacher, cid, "B")
    patch(teacher, a["id"], "open")
    events = listen(f"class:{cid}")
    assert patch(teacher, b["id"], "open").status_code == 409
    assert events.messages() == []


# ---------- the "Laboratory access is closed" guard ----------

@pytest.fixture()
def probe(db: Session) -> TestClient:
    """A tiny app with one write route behind the guard, sharing the real error handlers.
    (The real workspace write endpoints arrive in Phase 5 and use the same guard.)"""
    app = FastAPI()
    app.exception_handlers.update(main_app.exception_handlers)

    @app.put("/probe/{class_id}")
    def write(class_id: int, session: Session = Depends(get_db)) -> dict:
        session_service.require_lab_open(session, class_id)
        return {"written": True}

    return TestClient(app)


def test_write_is_403_while_lab_closed_and_ok_while_open(
        probe: TestClient, teacher: TestClient, cid: int) -> None:
    s = new_session(teacher, cid)

    r = probe.put(f"/probe/{cid}")
    assert r.status_code == 403
    assert r.json() == {"detail": "Laboratory access is closed", "code": "LAB_CLOSED"}

    patch(teacher, s["id"], "open")
    assert probe.put(f"/probe/{cid}").json() == {"written": True}

    patch(teacher, s["id"], "close")
    assert probe.put(f"/probe/{cid}").status_code == 403


def test_guard_is_per_class(probe: TestClient, teacher: TestClient, cid: int) -> None:
    other_cid = new_class(teacher, "Other")
    patch(teacher, new_session(teacher, cid)["id"], "open")
    assert probe.put(f"/probe/{cid}").status_code == 200
    assert probe.put(f"/probe/{other_cid}").status_code == 403
