import itertools
import os

# Tests run against their own database. Must be set before any `app` import reads settings.
os.environ["MYSQL_DATABASE"] = "lab_test"
os.environ["REDIS_URL"] = "redis://redis:6379/1"  # own Redis db: test cooldown keys never touch dev data

from collections.abc import Iterator  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.activity import Activity  # noqa: E402
from app.models.user import Role, User  # noqa: E402
from app.schemas.user import UserCreate  # noqa: E402
from app.services import user_service  # noqa: E402

PASSWORD = "Passw0rd!"

# Standalone script that runs at import time (needs Docker); ported into test_sandbox.py in Phase 6.
collect_ignore = ["test_sandbox_abuse_reference.py"]


def reset_schema() -> None:
    """Drop every table in the test database (including alembic_version)."""
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in conn.execute(text("SHOW TABLES")).scalars().all():
            conn.execute(text(f"DROP TABLE IF EXISTS `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))


@pytest.fixture(autouse=True)
def top_level_rule_switch(request, monkeypatch):
    """A class workspace refuses files and folders at the top level (only activity folders live there). Most tests
    exercise OTHER workspace mechanics (saving, quotas, versions, runs) with simple top-level paths, so the rule is off
    for them; the tests of the rule itself, and of flows that must work with it, carry @pytest.mark.top_level_rule."""
    if request.node.get_closest_marker("top_level_rule") is None:
        from app.services.workspace_service import ActivityRules
        monkeypatch.setattr(ActivityRules, "check_inside_activity", lambda self, path: None)
    yield


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[None]:
    """Fresh schema built by running the real Alembic migrations."""
    reset_schema()
    command.upgrade(Config("alembic.ini"), "head")
    yield
    reset_schema()


@pytest.fixture()
def db(migrated_db: None) -> Iterator[Session]:
    """A session on a database emptied of all rows (schema kept)."""
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in Base.metadata.tables:
            conn.execute(text(f"DELETE FROM `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def client(db: Session) -> TestClient:
    return TestClient(app)


def new_device() -> TestClient:
    """A TestClient has its own cookie jar, so each one acts as a separate PC."""
    return TestClient(app)


def make_user(db: Session, role: Role = Role.STUDENT, username: str = "user1",
              password: str = PASSWORD, **kw) -> User:
    return user_service.create_user(
        db,
        UserCreate(username=username, password=password, full_name=kw.pop("full_name", "Test User"),
                   role=role, **kw),
    )


def login(client: TestClient, username: str, password: str = PASSWORD):
    return client.post("/api/v1/auth/login", json={"username": username, "password": password})


def login_as(db: Session, role: Role, username: str) -> TestClient:
    """A new device signed in as a newly created user with the given role."""
    make_user(db, role, username)
    c = new_device()
    assert login(c, username).status_code == 200
    return c


# ---------------------------------------------------------------- class helpers (Phase 3+)

def iso(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def new_class(teacher: TestClient, name: str = "Programming 1") -> int:
    r = teacher.post("/api/v1/classes", json={"name": name, "year_and_section": "BSIT 1A", "school_year": "2026-2027"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_code(teacher: TestClient, class_id: int, **overrides) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    body = {"valid_from": iso(now - timedelta(minutes=1)), "valid_until": iso(now + timedelta(days=1))}
    body.update(overrides)
    r = teacher.post(f"/api/v1/classes/{class_id}/invite-codes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_activity(db: Session, class_id: int, title: str = "Lab 1", published: bool = True,
                 files: list[dict] | None = None) -> Activity:
    activity = Activity(
        class_id=class_id, title=title, is_published=published,
        starter_files=files if files is not None else [{"path": "main.py", "content": "print(1)"}],
    )
    db.add(activity)
    db.commit()
    return activity


def student_joins(db: Session, code: str, username: str) -> tuple[TestClient, dict]:
    """A new student (own device) joins with `code`. Returns (client, enroll response json)."""
    c = login_as(db, Role.STUDENT, username)
    r = c.post("/api/v1/enroll", json={"code": code})
    assert r.status_code in (200, 201), r.text
    return c, r.json()


# ---------------------------------------------------------------- sessions / events (Phase 4+)

_rooms = itertools.count(1)


def new_room(client: TestClient) -> int:
    """A new lab (any instructor or admin may create one), so sessions made by tests never book the same room."""
    r = client.post("/api/v1/labs", json={"name": f"Room {next(_rooms)}"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_session(teacher: TestClient, class_id: int, name: str = "Session A") -> dict:
    """A session from now to +40 min, in a lab of its own."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    r = teacher.post(f"/api/v1/classes/{class_id}/sessions", json={
        "name": name, "starts_at": iso(now), "ends_at": iso(now + timedelta(minutes=40)),
        "lab_id": new_room(teacher)})
    assert r.status_code == 201, r.text
    return r.json()


def approved_student(db: Session, teacher: TestClient, class_id: int, code: str, username: str) -> TestClient:
    """A student who joined with `code` and was approved by `teacher`."""
    c, joined = student_joins(db, code, username)
    r = teacher.patch(f"/api/v1/enrollments/{joined['enrollment_id']}", json={"action": "approve"})
    assert r.status_code == 200, r.text
    return c


class Listener:
    """Subscribes to a Redis channel so a test can assert on events published by the API."""

    def __init__(self, channel: str) -> None:
        from app.core.redis import get_redis

        self.pubsub = get_redis().pubsub(ignore_subscribe_messages=True)
        self.pubsub.subscribe(channel)
        self.pubsub.get_message(timeout=2)  # wait for the subscribe confirmation to be processed

    def messages(self, wait: float = 0.5) -> list[dict]:
        import json

        out = []
        while (m := self.pubsub.get_message(timeout=wait)) is not None:
            out.append(json.loads(m["data"]))
            wait = 0.2
        return out

    def close(self) -> None:
        self.pubsub.close()


@pytest.fixture()
def listen():
    listeners: list[Listener] = []

    def factory(channel: str) -> Listener:
        listeners.append(Listener(channel))
        return listeners[-1]

    yield factory
    for item in listeners:
        item.close()


# ---------------------------------------------------------------- a ready-to-use lab (Phase 5+)

@pytest.fixture()
def lab(db: Session):
    """An instructor, a class with an OPEN lab session, and one approved student ("stu1")."""
    from types import SimpleNamespace

    teacher = login_as(db, Role.INSTRUCTOR, "teach1")
    cid = new_class(teacher)
    code = new_code(teacher, cid)["code"]
    session = new_session(teacher, cid)
    assert teacher.patch(f"/api/v1/sessions/{session['id']}/open").status_code == 200
    student = approved_student(db, teacher, cid, code, "stu1")
    return SimpleNamespace(teacher=teacher, cid=cid, code=code, session_id=session["id"], student=student)


# ---------------------------------------------------------------- celery tasks / docker (Phase 6+)

@pytest.fixture(scope="session")
def tasks_module():
    """app.worker.tasks. Importing it connects to Docker; where there is no socket (the api container)
    it is imported with a stub sandbox, which the tests then replace with their own fakes anyway."""
    try:
        from app.worker import tasks
        return tasks
    except Exception:
        import sys
        import types
        from dataclasses import dataclass
        from typing import Optional
        from unittest.mock import MagicMock

        @dataclass
        class RunResult:
            status: str
            exit_code: Optional[int]
            output: str
            duration_ms: int

        stub = types.ModuleType("app.worker.sandbox")
        stub.IMAGE = "lab-python-runner:1"
        stub.RunResult = RunResult
        stub.client = MagicMock()
        stub.reap_orphans = MagicMock(return_value=0)
        stub.run_in_sandbox = MagicMock()
        stub.run_interactive = MagicMock()
        sys.modules["app.worker.sandbox"] = stub
        from app.worker import tasks
        return tasks
