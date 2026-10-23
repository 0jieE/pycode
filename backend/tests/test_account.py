"""Self-service account management: PATCH /auth/me, POST /auth/change-password, and the temporary-password lock."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import get_redis
from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from app.services import auth_service
from tests.conftest import PASSWORD, login, login_as, make_user, new_device

API = "/api/v1"
NEW_PASSWORD = "Brand-new-pw-1"
ROLES = [Role.ADMIN, Role.INSTRUCTOR, Role.STUDENT]


@pytest.fixture(autouse=True)
def fresh_attempt_counters():
    for key in get_redis().scan_iter("pwchange:attempts:*"):
        get_redis().delete(key)
    yield


def audit(db: Session, action: str) -> list[ActivityLog]:
    db.rollback()
    return list(db.scalars(select(ActivityLog).where(ActivityLog.action == action).order_by(ActivityLog.id)))


def change(c: TestClient, current: str = PASSWORD, new: str = NEW_PASSWORD):
    return c.post(f"{API}/auth/change-password", json={"current_password": current, "new_password": new})


def reload(db: Session, user_id: int) -> User:
    db.rollback()
    db.expire_all()
    return db.get(User, user_id)


# ============================================================== PATCH /auth/me

@pytest.mark.parametrize("role", ROLES)
def test_every_role_can_update_their_own_name_and_username(db: Session, role: Role) -> None:
    c = login_as(db, role, "olduser")
    r = c.patch(f"{API}/auth/me", json={"full_name": "  Maria Santos  ", "username": "maria.s"})
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "Maria Santos" and body["username"] == "maria.s" and body["role"] == role.value
    assert "password_hash" not in body and "current_session_id" not in body
    assert c.get(f"{API}/auth/me").json()["username"] == "maria.s"  # the same device stays signed in

    assert login(new_device(), "olduser").status_code == 401
    assert login(new_device(), "maria.s").status_code == 200


def test_send_only_what_changes(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.patch(f"{API}/auth/me", json={"full_name": "New Name"}).json()["username"] == "stu1"
    assert c.patch(f"{API}/auth/me", json={"username": "newname"}).json()["full_name"] == "New Name"
    assert c.patch(f"{API}/auth/me", json={}).status_code == 200  # nothing to change


def test_username_is_stored_lowercase_like_at_sign_up(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.patch(f"{API}/auth/me", json={"username": "  Maria.S_01 "}).json()["username"] == "maria.s_01"


def test_username_taken_is_409_and_nothing_changes(db: Session) -> None:
    make_user(db, Role.INSTRUCTOR, "taken.name")
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.patch(f"{API}/auth/me", json={"username": "Taken.Name", "full_name": "Changed"})
    assert r.status_code == 409 and r.json()["code"] == "USERNAME_TAKEN"
    me = c.get(f"{API}/auth/me").json()
    assert me["username"] == "stu1" and me["full_name"] == "Test User"


def test_keeping_your_own_username_is_not_a_conflict(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.patch(f"{API}/auth/me", json={"username": "STU1"}).status_code == 200
    assert audit(db, "profile_update") == []  # nothing actually changed, so nothing is audited


@pytest.mark.parametrize("body", [
    {"username": "abc"}, {"username": "x" * 33}, {"username": "has space"}, {"username": "bad-char"},
    {"username": "emojié"}, {"username": ""}, {"username": None},
    {"full_name": ""}, {"full_name": "   "}, {"full_name": "x" * 151}, {"full_name": None},
])
def test_invalid_values_are_rejected(db: Session, body: dict) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.patch(f"{API}/auth/me", json=body).status_code == 422
    assert c.get(f"{API}/auth/me").json()["username"] == "stu1"


@pytest.mark.parametrize("field,value", [
    ("role", "admin"), ("student_no", "2024-0001"), ("is_active", False), ("id", 99),
    ("must_change_password", False), ("password", "Newpass123"), ("email", "a@b.c"),
])
def test_fields_a_user_may_not_change_are_rejected_not_ignored(db: Session, field: str, value) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    before = c.get(f"{API}/auth/me").json()
    r = c.patch(f"{API}/auth/me", json={"full_name": "Sneaky", field: value})
    assert r.status_code == 422
    assert c.get(f"{API}/auth/me").json() == before  # not even the allowed field was applied


def test_profile_update_audit_has_field_names_only(db: Session) -> None:
    user = make_user(db, Role.STUDENT, "stu1")
    c = new_device()
    login(c, "stu1")
    c.patch(f"{API}/auth/me", json={"username": "secretname1", "full_name": "Secret Person"})
    rows = audit(db, "profile_update")
    assert len(rows) == 1 and rows[0].user_id == user.id and rows[0].details == {"fields": ["full_name", "username"]}
    assert "secretname1" not in json.dumps(rows[0].details) and "Secret" not in json.dumps(rows[0].details)


def test_profile_needs_a_signed_in_user() -> None:
    assert new_device().patch(f"{API}/auth/me", json={"full_name": "x"}).status_code == 401


# ======================================================= POST /auth/change-password

@pytest.mark.parametrize("role", ROLES)
def test_every_role_can_change_their_own_password(db: Session, role: Role) -> None:
    c = login_as(db, role, "someone")
    r = change(c)
    assert r.status_code == 204 and r.content == b""
    assert c.get(f"{API}/auth/me").status_code == 200  # this device stays signed in (it got a fresh cookie)

    assert login(new_device(), "someone", PASSWORD).status_code == 401  # the old password no longer works
    assert login(new_device(), "someone", NEW_PASSWORD).status_code == 200


def test_the_password_is_stored_as_an_argon2_hash(db: Session) -> None:
    user = make_user(db, Role.STUDENT, "stu1")
    c = new_device()
    login(c, "stu1")
    change(c)
    assert reload(db, user.id).password_hash.startswith("$argon2") and NEW_PASSWORD not in reload(db, user.id).password_hash


def test_wrong_current_password(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    r = change(c, current="not-my-password")
    assert r.status_code == 400 and r.json()["code"] == "INVALID_CURRENT_PASSWORD"
    assert login(new_device(), "stu1", PASSWORD).status_code == 200  # unchanged


@pytest.mark.parametrize("new", ["short", "x" * 7, "y" * 129, ""])
def test_new_password_length_is_8_to_128(db: Session, new: str) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert change(c, new=new).status_code == 422
    assert change(c, new="z" * 8).status_code == 204


def test_new_password_must_differ_from_the_current_one(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    r = change(c, new=PASSWORD)
    assert r.status_code == 400 and r.json()["code"] == "PASSWORD_UNCHANGED"


def test_unknown_fields_are_rejected(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    r = c.post(f"{API}/auth/change-password", json={"current_password": PASSWORD, "new_password": NEW_PASSWORD,
                                                      "user_id": 1})
    assert r.status_code == 422


def test_other_sessions_are_signed_out_but_this_one_stays(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    stolen = new_device()
    stolen.cookies.set(settings.COOKIE_NAME, c.cookies.get(settings.COOKIE_NAME))
    assert stolen.get(f"{API}/auth/me").status_code == 200  # same session, e.g. a copied cookie

    assert change(c).status_code == 204
    assert c.get(f"{API}/auth/me").status_code == 200
    r = stolen.get(f"{API}/auth/me")
    assert r.status_code == 401 and r.json()["code"] == "SESSION_REPLACED"


def test_change_password_is_audited_without_secrets(db: Session) -> None:
    user = make_user(db, Role.STUDENT, "stu1")
    c = new_device()
    login(c, "stu1")
    change(c, current="wrong-one")
    change(c)
    done, failed = audit(db, "password_change"), audit(db, "password_change_failed")
    assert len(done) == 1 and done[0].user_id == user.id and done[0].ip_address
    assert len(failed) == 1 and failed[0].user_id == user.id
    for row in done + failed:
        text = json.dumps(row.details or {})
        assert PASSWORD not in text and NEW_PASSWORD not in text and "wrong-one" not in text


def test_a_stolen_cookie_cannot_be_used_to_guess_the_password(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    for _ in range(auth_service.PASSWORD_ATTEMPT_LIMIT):
        assert change(c, current="guess").status_code == 400
    r = change(c, current="guess")
    assert r.status_code == 429 and r.json()["code"] == "TOO_MANY_ATTEMPTS"
    assert change(c).status_code == 429  # even the right password waits until the window is over

    get_redis().delete(*get_redis().scan_iter("pwchange:attempts:*"))  # the window passes
    assert change(c).status_code == 204
    assert login(new_device(), "stu1", NEW_PASSWORD).status_code == 200


def test_attempts_are_counted_per_user_and_reset_by_success(db: Session) -> None:
    a = login_as(db, Role.STUDENT, "usera")
    b = login_as(db, Role.STUDENT, "userb")
    for _ in range(auth_service.PASSWORD_ATTEMPT_LIMIT):
        change(a, current="guess")
    assert change(a).status_code == 429
    assert change(b).status_code == 204  # someone else is not affected

    b_id = b.get(f"{API}/auth/me").json()["id"]
    assert get_redis().get(f"pwchange:attempts:{b_id}") is None  # a success resets the counter


def test_change_password_needs_a_signed_in_user() -> None:
    assert change(new_device()).status_code == 401


def test_nginx_limits_the_change_password_endpoint() -> None:
    conf = Path("nginx/nginx.conf").read_text()
    assert "zone=password_zone:10m rate=10r/m" in conf
    block = conf[conf.index("location = /api/v1/auth/change-password"):]
    assert "limit_req zone=password_zone burst=5" in block.split("}")[0]


# ================================================= temporary passwords: the lock

def locked_student(db: Session, admin: TestClient, username: str = "stu1") -> tuple[TestClient, int]:
    user = make_user(db, Role.STUDENT, username)
    assert admin.post(f"{API}/users/{user.id}/reset-password", json={"new_password": "Temporary-pw-1"}).status_code == 200
    c = new_device()
    assert login(c, username, "Temporary-pw-1").status_code == 200  # signing in is allowed
    return c, user.id


def test_normal_accounts_are_not_locked(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.get(f"{API}/auth/me").json()["must_change_password"] is False
    assert c.get(f"{API}/my/classes").status_code == 200


def test_an_admin_reset_locks_the_account_until_the_password_is_changed(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    c, uid = locked_student(db, admin)
    assert c.get(f"{API}/auth/me").json()["must_change_password"] is True

    r = c.get(f"{API}/my/classes")
    assert r.status_code == 403 and r.json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert c.post(f"{API}/enroll", json={"code": "ABCDEFGH"}).json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert c.post(f"{API}/practice/run", json={"entry_path": "main.py"}).json()["code"] == "PASSWORD_CHANGE_REQUIRED"

    assert c.patch(f"{API}/auth/me", json={"full_name": "Locked But Allowed"}).status_code == 200  # allowed
    assert change(c, current="Temporary-pw-1").status_code == 204

    assert c.get(f"{API}/auth/me").json()["must_change_password"] is False
    assert c.get(f"{API}/my/classes").status_code == 200  # unlocked, same device, no new login needed
    assert reload(db, uid).must_change_password is False


def test_a_locked_user_can_still_sign_out(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    c, _ = locked_student(db, admin)
    assert c.post(f"{API}/auth/logout").status_code == 204


def test_a_failed_change_keeps_the_lock(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    c, _ = locked_student(db, admin)
    assert change(c, current="wrong").status_code == 400
    assert change(c, current="Temporary-pw-1", new="Temporary-pw-1").json()["code"] == "PASSWORD_UNCHANGED"
    assert c.get(f"{API}/my/classes").status_code == 403


def test_the_lock_applies_to_every_role_and_to_websockets(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    teacher = make_user(db, Role.INSTRUCTOR, "teach1")
    admin.post(f"{API}/users/{teacher.id}/reset-password", json={"new_password": "Temporary-pw-1"})
    t = new_device()
    login(t, "teach1", "Temporary-pw-1")
    assert t.get(f"{API}/classes").json()["code"] == "PASSWORD_CHANGE_REQUIRED"

    other_admin = make_user(db, Role.ADMIN, "admin2")
    admin.post(f"{API}/users/{other_admin.id}/reset-password", json={"new_password": "Temporary-pw-1"})
    a2 = new_device()
    login(a2, "admin2", "Temporary-pw-1")
    assert a2.get(f"{API}/users").json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert admin.get(f"{API}/users").status_code == 200  # the admin who did the reset is not locked

    stu, _ = locked_student(db, admin, "stu1")
    with stu.websocket_connect(f"{API}/ws/class/1") as ws:
        assert ws.receive_json()["code"] == "PASSWORD_CHANGE_REQUIRED"


def test_a_csv_import_gives_temporary_passwords(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    data = "student_no,full_name,username,temp_password\n2024-1,Ana Cruz,ana.cruz,Welcome-123\n"
    assert admin.post(f"{API}/users/import", files={"file": ("s.csv", data, "text/csv")}).json()["created"] == 1
    c = new_device()
    assert login(c, "ana.cruz", "Welcome-123").json()["must_change_password"] is True
    assert c.get(f"{API}/my/classes").json()["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert change(c, current="Welcome-123").status_code == 204
    assert c.get(f"{API}/my/classes").status_code == 200


def test_accounts_created_by_an_admin_with_a_password_are_not_locked(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    r = admin.post(f"{API}/users", json={"username": "newuser", "password": "Chosen-pw-1", "full_name": "N U",
                                          "role": "student"})
    assert r.status_code == 201 and r.json()["must_change_password"] is False
