"""The system has exactly one administrator: created by the first setup, never created, listed, changed, deactivated,
demoted or deleted through the users API, managing its own account through /me, and recoverable on the server with
`python -m app.reset_admin`. The database refuses a second admin too."""
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from app.services import user_service
from tests.conftest import PASSWORD, login, login_as, make_user, new_device

API = "/api/v1"
STUDENT = {"username": "bob", "password": "Secret-pass-1", "full_name": "Bob", "role": "student",
           "student_no": "2026-0001"}


@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "admin")


def admin_row(db: Session) -> User:
    db.expire_all()
    return db.scalar(select(User).where(User.role == Role.ADMIN))


def admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == Role.ADMIN))


# =========================================================================== the API never makes another admin

def test_creating_an_admin_is_refused(admin, db: Session) -> None:
    r = admin.post(f"{API}/users", json={**STUDENT, "role": "admin"})
    assert r.status_code == 403 and r.json()["code"] == "ADMIN_ROLE_RESERVED"
    assert r.json()["detail"] == "There is only one administrator account: no other account can be an administrator"
    assert admins(db) == 1 and db.scalar(select(User.id).where(User.username == "bob")) is None
    assert admin.post(f"{API}/users", json={**STUDENT, "role": "instructor", "student_no": None}).status_code == 201


def test_no_user_can_be_changed_to_admin_or_to_another_role(admin, db: Session) -> None:
    bob = admin.post(f"{API}/users", json=STUDENT).json()
    r = admin.patch(f"{API}/users/{bob['id']}", json={"role": "admin"})
    assert r.status_code == 403 and r.json()["code"] == "ADMIN_ROLE_RESERVED"
    r = admin.patch(f"{API}/users/{bob['id']}", json={"role": "instructor"})
    assert r.status_code == 400 and r.json()["code"] == "ROLE_CHANGE_NOT_ALLOWED"
    r = admin.patch(f"{API}/users/{bob['id']}", json={"role": "student", "full_name": "Robert"})   # unchanged role
    assert r.status_code == 200 and (r.json()["role"], r.json()["full_name"]) == ("student", "Robert")
    assert admins(db) == 1


def test_a_csv_import_with_an_admin_role_is_refused_whole(admin, db: Session) -> None:
    def upload(csv_text: str):
        return admin.post(f"{API}/users/import", files={"file": ("u.csv", io.BytesIO(csv_text.encode()), "text/csv")})

    head = "student_no,full_name,username,temp_password,role\n"
    r = upload(head + "1,Ann,ann,Temp-pass-1,student\n2,Eve,eve,Temp-pass-2,admin\n")
    assert r.status_code == 403 and r.json()["code"] == "ADMIN_ROLE_RESERVED"
    assert db.scalar(select(func.count()).select_from(User).where(User.username.in_(["ann", "eve"]))) == 0
    r = upload(head + "1,Ann,ann,Temp-pass-1,student\n2,Ian,ian,Temp-pass-2,instructor\n3,Cy,cyd,Temp-pass-3,\n")
    assert r.status_code == 200 and (r.json()["created"], r.json()["skipped"]) == (2, 1)
    assert r.json()["errors"][0]["detail"] == "only student accounts can be imported"
    r = upload("student_no,full_name,username,temp_password\n4,Dan,dan,Temp-pass-4\n")    # no role column: students
    assert r.json()["created"] == 1
    assert {u.role for u in db.scalars(select(User).where(User.username.in_(["ann", "cyd", "dan"])))} == {Role.STUDENT}
    assert admins(db) == 1


# =========================================================================== the admin cannot be changed through /users

@pytest.mark.parametrize("body", [{"is_active": False}, {"role": "student"}, {"role": "instructor"},
                                  {"full_name": "Someone"}])
def test_the_admin_account_cannot_be_deactivated_demoted_or_edited_here(admin, db: Session, body) -> None:
    me = admin.get(f"{API}/me").json()
    r = admin.patch(f"{API}/users/{me['id']}", json=body)
    assert r.status_code == 409 and r.json()["code"] == "ADMIN_PROTECTED", body
    assert r.json()["detail"].startswith("The administrator account cannot be changed, deactivated or demoted here.")
    row = admin_row(db)
    assert (row.role, row.is_active, row.full_name) == (Role.ADMIN, True, "Test User")
    r = admin.patch(f"{API}/users/{me['id']}", json={"role": "admin"})   # asking for the admin role: always 403
    assert r.status_code == 403 and r.json()["code"] == "ADMIN_ROLE_RESERVED"


def test_the_admin_password_cannot_be_reset_through_users_and_nothing_is_deleted(admin, db: Session) -> None:
    me = admin.get(f"{API}/me").json()
    r = admin.post(f"{API}/users/{me['id']}/reset-password")
    assert r.status_code == 409 and r.json()["code"] == "ADMIN_PROTECTED"
    assert "python -m app.reset_admin" in r.json()["detail"]
    bob = admin.post(f"{API}/users", json=STUDENT).json()
    for uid in (me["id"], bob["id"]):                     # there is no way to delete an account at all
        assert admin.delete(f"{API}/users/{uid}").status_code == 405
    assert admins(db) == 1


# =========================================================================== listing and counting

def test_the_list_never_shows_the_admin_and_filters_only_instructors_or_students(admin, db: Session) -> None:
    admin.post(f"{API}/users", json=STUDENT)
    admin.post(f"{API}/users", json={**STUDENT, "username": "ivy", "student_no": None, "role": "instructor"})
    listing = admin.get(f"{API}/users").json()
    assert sorted(u["username"] for u in listing["items"]) == ["bob", "ivy"] and listing["total"] == 2
    assert admin.get(f"{API}/users", params={"q": "admin"}).json()["total"] == 0
    assert [u["username"] for u in admin.get(f"{API}/users", params={"role": "student"}).json()["items"]] == ["bob"]
    assert [u["username"] for u in admin.get(f"{API}/users", params={"role": "instructor"}).json()["items"]] == ["ivy"]
    assert admin.get(f"{API}/users", params={"role": "admin"}).status_code == 422


def test_counts(admin, db: Session) -> None:
    assert admin.get(f"{API}/users/counts").json() == {"instructors": 0, "students": 0}
    admin.post(f"{API}/users", json=STUDENT)
    admin.post(f"{API}/users", json={**STUDENT, "username": "carl", "student_no": "2026-0002"})
    admin.post(f"{API}/users", json={**STUDENT, "username": "ivy", "student_no": None, "role": "instructor"})
    assert admin.get(f"{API}/users/counts").json() == {"instructors": 1, "students": 2}
    teacher = login_as(db, Role.INSTRUCTOR, "teach1")
    assert teacher.get(f"{API}/users/counts").status_code == 403


# =========================================================================== /me for every role

@pytest.mark.parametrize("role", [Role.ADMIN, Role.INSTRUCTOR, Role.STUDENT])
def test_me_reads_and_renames_my_own_account(db: Session, role) -> None:
    c = login_as(db, role, "someone")
    me = c.get(f"{API}/me")
    assert me.status_code == 200 and (me.json()["username"], me.json()["role"]) == ("someone", role.value)
    assert "preferences" in me.json()
    r = c.patch(f"{API}/me", json={"full_name": "  New Name  "})
    assert r.status_code == 200 and r.json()["full_name"] == "New Name"
    assert c.get(f"{API}/auth/me").json()["full_name"] == "New Name"           # the same account as /auth/me
    for bad in ({"full_name": ""}, {"full_name": None}, {"role": "admin"}, {"username": "other"}, {}):
        assert c.patch(f"{API}/me", json=bad).status_code == 422, bad
    assert db.scalar(select(ActivityLog.details).where(ActivityLog.action == "profile_update")) == {"fields": ["full_name"]}


def test_me_change_password(db: Session) -> None:
    c = login_as(db, Role.ADMIN, "admin")
    other = new_device()
    assert login(other, "admin").status_code == 200       # (this signs the first device out: one session)
    r = other.post(f"{API}/me/change-password", json={"current_password": "wrong-one", "new_password": "Brand-new-1"})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_CURRENT_PASSWORD"
    assert other.post(f"{API}/me/change-password", json={"current_password": "x"}).status_code == 422
    r = other.post(f"{API}/me/change-password", json={"current_password": PASSWORD, "new_password": "Brand-new-1"})
    assert r.status_code == 204
    assert other.get(f"{API}/me").status_code == 200       # this device stays signed in (fresh cookie)
    assert login(new_device(), "admin", PASSWORD).status_code == 401
    assert login(new_device(), "admin", "Brand-new-1").status_code == 200
    assert c.get(f"{API}/me").status_code == 401


def test_me_needs_a_signed_in_user() -> None:
    assert new_device().get(f"{API}/me").status_code == 401
    assert new_device().patch(f"{API}/me", json={"full_name": "x"}).status_code == 401


# =========================================================================== recovery on the server

def test_reset_admin_gives_a_temporary_password_that_must_be_changed(admin, db: Session, capsys) -> None:
    from app import reset_admin

    old = admin
    admin_row(db).is_active = False      # even a disabled admin is recovered
    db.commit()
    assert reset_admin.main() == 0
    printed = capsys.readouterr().out
    temporary = printed.split("temporary password:")[1].split()[0]
    assert "username:            admin" in printed and len(temporary) >= 8

    row = admin_row(db)
    assert row.must_change_password is True and row.is_active is True and row.current_session_id is None
    assert old.get(f"{API}/me").status_code == 401                              # signed out everywhere
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "admin_password_reset")).one()
    assert log.user_id is None and log.details == {"target_id": row.id, "via": "app.reset_admin"}
    assert temporary not in str(log.details)

    c = new_device()
    assert login(c, "admin", PASSWORD).status_code == 401
    assert login(c, "admin", temporary).status_code == 200
    assert c.get(f"{API}/users").json()["code"] == "PASSWORD_CHANGE_REQUIRED"   # locked until changed...
    assert c.get(f"{API}/me").json()["must_change_password"] is True             # ... but /me works
    r = c.post(f"{API}/me/change-password", json={"current_password": temporary, "new_password": "Mine-again-1"})
    assert r.status_code == 204
    assert c.get(f"{API}/users").status_code == 200


def test_reset_admin_without_an_admin(db: Session, capsys) -> None:
    from app import reset_admin

    assert reset_admin.main() == 1
    assert "python -m app.seed" in capsys.readouterr().err


# =========================================================================== first setup and the database

def test_the_seed_creates_exactly_one_admin_once(db: Session) -> None:
    from app.seed import seed

    first = seed(db)
    admin_line = next(a for a in first.accounts if a[1] == "admin")
    assert admin_line[0] == "admin" and admin_line[2]                            # its password, printed once
    second = seed(db)
    assert next(a for a in second.accounts if a[1] == "admin")[2] is None        # already there: unchanged
    assert admins(db) == 1


def test_the_seed_keeps_an_admin_that_was_renamed(db: Session) -> None:
    from app.seed import seed

    make_user(db, Role.ADMIN, "principal")
    seed(db)
    assert admins(db) == 1 and db.scalar(select(User.id).where(User.username == "admin")) is None


def test_only_one_admin_can_ever_exist(db: Session) -> None:
    make_user(db, Role.ADMIN, "admin")
    with pytest.raises(ConflictError) as e:
        user_service.create_admin(db, "second", "Second")
    assert e.value.code == "ADMIN_EXISTS"
    db.rollback()
    with pytest.raises(IntegrityError):                   # the database refuses it too, whatever the code does
        db.execute(text("INSERT INTO users (username, password_hash, full_name, role, is_active, "
                        "must_change_password, created_at, updated_at) "
                        "VALUES ('sneaky', 'x', 'X', 'admin', 1, 0, NOW(), NOW())"))
        db.flush()
    db.rollback()
    bob = make_user(db, Role.STUDENT, "bob")
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": bob.id})
        db.flush()
    db.rollback()
    assert admins(db) == 1
