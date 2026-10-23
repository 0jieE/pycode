"""Per-user preferences: returned on the user object by the /auth endpoints, changed with PATCH /auth/me/preferences."""
import pytest
from sqlalchemy.orm import Session

from app.models.user import Role, User
from tests.conftest import PASSWORD, login, login_as, make_user, new_device

API = "/api/v1"
DEFAULTS = {"theme": "dark", "editor_theme": "match"}


def prefs(c, **body):
    return c.patch(f"{API}/auth/me/preferences", json=body)


def stored(db: Session, user_id: int):
    db.expire_all()
    return db.get(User, user_id).preferences


@pytest.mark.parametrize("role", [Role.ADMIN, Role.INSTRUCTOR, Role.STUDENT])
def test_every_role_gets_complete_defaults_everywhere_the_user_is_returned(db: Session, role: Role) -> None:
    make_user(db, role, "someone")
    c = new_device()
    r = login(c, "someone")
    assert r.json()["preferences"] == DEFAULTS                       # POST /auth/login
    assert c.get(f"{API}/auth/me").json()["preferences"] == DEFAULTS  # GET /auth/me
    assert c.patch(f"{API}/auth/me", json={"full_name": "New"}).json()["preferences"] == DEFAULTS  # PATCH /auth/me


def test_sign_up_returns_the_defaults(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    code = admin.post(f"{API}/registration-codes", json={"count": 1, "batch_name": "B"}).json()["codes"][0]
    r = new_device().post(f"{API}/auth/register", json={
        "code": code, "student_no": "2026-1", "full_name": "Ana Cruz", "username": "ana.cruz", "password": PASSWORD})
    assert r.status_code == 201 and r.json()["preferences"] == DEFAULTS


def test_changing_one_field_keeps_the_others_and_returns_the_full_object(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    r = prefs(c, theme="light")
    assert r.status_code == 200 and r.json() == {"theme": "light", "editor_theme": "match"}
    assert prefs(c, editor_theme="dark").json() == {"theme": "light", "editor_theme": "dark"}
    assert prefs(c, theme="system", editor_theme="light").json() == {"theme": "system", "editor_theme": "light"}
    assert prefs(c).json() == {"theme": "system", "editor_theme": "light"}  # nothing to change


def test_preferences_follow_the_user_to_another_computer(db: Session) -> None:
    c = login_as(db, Role.INSTRUCTOR, "teach1")
    prefs(c, theme="light", editor_theme="dark")
    other_pc = new_device()
    assert login(other_pc, "teach1").json()["preferences"] == {"theme": "light", "editor_theme": "dark"}
    assert other_pc.get(f"{API}/auth/me").json()["preferences"]["theme"] == "light"


@pytest.mark.parametrize("body", [
    {"theme": "blue"}, {"theme": "Dark"}, {"theme": None}, {"theme": 1},
    {"editor_theme": "system"}, {"editor_theme": None},
    {"font_size": 14}, {"theme": "light", "unknown": True},
])
def test_unknown_fields_values_and_null_are_422_and_nothing_is_saved(db: Session, body: dict) -> None:
    user = make_user(db, Role.STUDENT, "stu1")
    c = new_device()
    login(c, "stu1")
    prefs(c, theme="light")
    assert prefs(c, **body).status_code == 422
    assert c.get(f"{API}/auth/me").json()["preferences"] == {"theme": "light", "editor_theme": "match"}
    assert stored(db, user.id) == {"theme": "light", "editor_theme": "match"}


def test_the_profile_endpoint_still_refuses_preferences(db: Session) -> None:
    c = login_as(db, Role.STUDENT, "stu1")
    assert c.patch(f"{API}/auth/me", json={"preferences": {"theme": "light"}}).status_code == 422
    assert c.patch(f"{API}/auth/me", json={"theme": "light"}).status_code == 422
    assert c.get(f"{API}/auth/me").json()["preferences"] == DEFAULTS


def test_allowed_while_a_temporary_password_must_be_changed(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    user = make_user(db, Role.STUDENT, "stu1")
    admin.post(f"{API}/users/{user.id}/reset-password", json={"new_password": "Temporary-pw-1"})
    c = new_device()
    assert login(c, "stu1", "Temporary-pw-1").json()["preferences"] == DEFAULTS
    assert c.get(f"{API}/my/classes").json()["code"] == "PASSWORD_CHANGE_REQUIRED"   # still locked elsewhere
    assert prefs(c, theme="light").json()["theme"] == "light"


def test_admins_never_see_or_change_another_users_preferences(db: Session) -> None:
    admin = login_as(db, Role.ADMIN, "admin1")
    user = make_user(db, Role.STUDENT, "stu1")
    c = new_device()
    login(c, "stu1")
    prefs(c, theme="light")

    listed = admin.get(f"{API}/users").json()["items"]
    assert all("preferences" not in u for u in listed)
    assert "preferences" not in admin.patch(f"{API}/users/{user.id}", json={"full_name": "X"}).json()
    admin.patch(f"{API}/users/{user.id}", json={"preferences": {"theme": "dark"}})  # not a field there: ignored
    assert prefs(admin, theme="system").json()["theme"] == "system"  # this changed the admin's OWN preferences only
    assert stored(db, user.id) == {"theme": "light", "editor_theme": "match"}


def test_needs_a_signed_in_user() -> None:
    assert new_device().patch(f"{API}/auth/me/preferences", json={"theme": "light"}).status_code == 401


def test_old_or_broken_stored_values_fall_back_to_the_defaults(db: Session) -> None:
    """Room to grow: rows written by an older or newer version must never break a sign-in."""
    user = make_user(db, Role.STUDENT, "stu1")
    for raw, expected in (
        (None, DEFAULTS),
        ({}, DEFAULTS),
        ({"theme": "light"}, {"theme": "light", "editor_theme": "match"}),           # a field added later
        ({"theme": "neon", "editor_theme": "dark"}, {"theme": "dark", "editor_theme": "dark"}),  # an old value
        ({"theme": "light", "retired_setting": 3}, {"theme": "light", "editor_theme": "match"}),
        (["not", "an", "object"], DEFAULTS),
    ):
        db.expire_all()
        db.get(User, user.id).preferences = raw
        db.commit()
        c = new_device()
        assert login(c, "stu1").json()["preferences"] == expected, raw
    assert prefs(c, editor_theme="light").json() == {"theme": "dark", "editor_theme": "light"}
    assert stored(db, user.id) == {"theme": "dark", "editor_theme": "light"}  # cleaned up on the next save


def test_it_is_in_the_openapi_schema(client) -> None:
    spec = client.get(f"{API}/openapi.json").json()
    op = spec["paths"]["/api/v1/auth/me/preferences"]["patch"]
    assert op["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/PreferencesUpdate")
    schemas = spec["components"]["schemas"]
    assert schemas["Preferences"]["properties"]["theme"]["enum"] == ["dark", "light", "system"]
    assert schemas["Preferences"]["properties"]["editor_theme"]["enum"] == ["dark", "light", "match"]
    assert schemas["PreferencesUpdate"]["additionalProperties"] is False
    me = spec["paths"]["/api/v1/auth/me"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert me["$ref"].endswith("/MeOut") and "preferences" in schemas["MeOut"]["required"]
