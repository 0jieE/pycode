import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from tests.conftest import PASSWORD, login, login_as, make_user, new_device

NEW_USER = {"username": "bob", "password": "Sup3rSecret", "full_name": "Bob", "role": "student",
            "student_no": "2026-0001"}


@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "admin")


# ---------- role blocking ----------

@pytest.mark.parametrize("role", [Role.STUDENT, Role.INSTRUCTOR])
def test_non_admins_are_blocked_from_user_management(db: Session, role: Role) -> None:
    c = login_as(db, role, "someone")
    assert c.get("/api/v1/users").status_code == 403
    assert c.get("/api/v1/users").json()["code"] == "FORBIDDEN_ROLE"
    assert c.post("/api/v1/users", json=NEW_USER).status_code == 403
    assert c.patch("/api/v1/users/1", json={"full_name": "x"}).status_code == 403
    assert c.post("/api/v1/users/1/reset-password").status_code == 403
    csv_file = {"file": ("s.csv", b"student_no,full_name,username,temp_password\n", "text/csv")}
    assert c.post("/api/v1/users/import", files=csv_file).status_code == 403


def test_anonymous_is_blocked_from_user_management(client: TestClient) -> None:
    assert client.get("/api/v1/users").status_code == 401


# ---------- admin CRUD ----------

def test_admin_creates_lists_and_filters_users(admin: TestClient) -> None:
    r = admin.post("/api/v1/users", json=NEW_USER)
    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "bob" and body["role"] == "student" and body["is_active"] is True
    assert "password" not in body and "password_hash" not in body

    listing = admin.get("/api/v1/users").json()                       # the administrator is never listed
    assert listing["total"] == 1 and listing["page"] == 1 and len(listing["items"]) == 1
    assert admin.get("/api/v1/users", params={"role": "student"}).json()["total"] == 1
    assert admin.get("/api/v1/users", params={"q": "bo"}).json()["items"][0]["username"] == "bob"


def test_new_user_can_log_in_with_given_password(admin: TestClient) -> None:
    admin.post("/api/v1/users", json=NEW_USER)
    assert login(new_device(), "bob", NEW_USER["password"]).status_code == 200


def test_duplicate_username_and_student_no_conflict(admin: TestClient) -> None:
    assert admin.post("/api/v1/users", json=NEW_USER).status_code == 201
    dup_name = admin.post("/api/v1/users", json={**NEW_USER, "student_no": "other"})
    assert dup_name.status_code == 409 and dup_name.json()["code"] == "USERNAME_TAKEN"
    dup_no = admin.post("/api/v1/users", json={**NEW_USER, "username": "carl"})
    assert dup_no.status_code == 409 and dup_no.json()["code"] == "STUDENT_NO_TAKEN"


@pytest.mark.parametrize("bad", [
    {"password": "short"},
    {"username": "has space"},
    {"username": "ab"},
    {"role": "superuser"},
])
def test_create_user_validation(admin: TestClient, bad: dict) -> None:
    r = admin.post("/api/v1/users", json={**NEW_USER, **bad})
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"


def test_pagination_is_capped_at_100(admin: TestClient) -> None:
    assert admin.get("/api/v1/users", params={"size": 101}).status_code == 422
    assert admin.get("/api/v1/users", params={"size": 100}).status_code == 200
    assert admin.get("/api/v1/users", params={"page": 0}).status_code == 422


def test_pagination_pages(admin: TestClient) -> None:
    for i in range(5):
        admin.post("/api/v1/users", json={**NEW_USER, "username": f"user{i}", "student_no": f"n{i}"})
    p1 = admin.get("/api/v1/users", params={"page": 1, "size": 4}).json()
    p2 = admin.get("/api/v1/users", params={"page": 2, "size": 4}).json()
    assert p1["total"] == 5 and len(p1["items"]) == 4 and len(p2["items"]) == 1     # (not the admin)


def test_admin_updates_user(admin: TestClient, db: Session) -> None:
    uid = admin.post("/api/v1/users", json=NEW_USER).json()["id"]
    r = admin.patch(f"/api/v1/users/{uid}", json={"full_name": "Robert", "student_no": "2026-0099"})
    assert r.status_code == 200
    assert r.json()["full_name"] == "Robert" and r.json()["student_no"] == "2026-0099"
    assert admin.patch("/api/v1/users/99999", json={"full_name": "x"}).status_code == 404


def test_update_cannot_steal_another_students_number(admin: TestClient) -> None:
    admin.post("/api/v1/users", json=NEW_USER)
    uid = admin.post("/api/v1/users", json={**NEW_USER, "username": "carl", "student_no": "n2"}).json()["id"]
    r = admin.patch(f"/api/v1/users/{uid}", json={"student_no": NEW_USER["student_no"]})
    assert r.status_code == 409


def test_deactivating_kicks_the_user_and_blocks_login(admin: TestClient) -> None:
    uid = admin.post("/api/v1/users", json=NEW_USER).json()["id"]
    bob = new_device()
    assert login(bob, "bob", NEW_USER["password"]).status_code == 200

    assert admin.patch(f"/api/v1/users/{uid}", json={"is_active": False}).status_code == 200
    assert bob.get("/api/v1/auth/me").status_code == 403  # live session is cut off at once
    assert login(new_device(), "bob", NEW_USER["password"]).status_code == 403

    admin.patch(f"/api/v1/users/{uid}", json={"is_active": True})
    assert login(new_device(), "bob", NEW_USER["password"]).status_code == 200


def test_admin_cannot_deactivate_self(admin: TestClient) -> None:
    my_id = admin.get("/api/v1/auth/me").json()["id"]
    r = admin.patch(f"/api/v1/users/{my_id}", json={"is_active": False})
    assert r.status_code == 409 and r.json()["code"] == "ADMIN_PROTECTED"


# ---------- reset password ----------

def test_reset_password_generates_temp_password_and_ends_session(admin: TestClient) -> None:
    uid = admin.post("/api/v1/users", json=NEW_USER).json()["id"]
    bob = new_device()
    login(bob, "bob", NEW_USER["password"])

    r = admin.post(f"/api/v1/users/{uid}/reset-password")
    assert r.status_code == 200
    temp = r.json()["temporary_password"]
    assert len(temp) >= 8

    assert bob.get("/api/v1/auth/me").status_code == 401
    assert login(new_device(), "bob", NEW_USER["password"]).status_code == 401  # old password dead
    assert login(new_device(), "bob", temp).status_code == 200


def test_reset_password_with_chosen_password(admin: TestClient) -> None:
    uid = admin.post("/api/v1/users", json=NEW_USER).json()["id"]
    r = admin.post(f"/api/v1/users/{uid}/reset-password", json={"new_password": "BrandNew123"})
    assert r.json()["temporary_password"] == "BrandNew123"
    assert login(new_device(), "bob", "BrandNew123").status_code == 200
    assert admin.post(f"/api/v1/users/{uid}/reset-password", json={"new_password": "x"}).status_code == 422
    assert admin.post("/api/v1/users/99999/reset-password").status_code == 404


# ---------- CSV import ----------

HEADER = "student_no,full_name,username,temp_password\n"


def upload(admin: TestClient, text: str | bytes, name: str = "students.csv"):
    data = text.encode("utf-8") if isinstance(text, str) else text
    return admin.post("/api/v1/users/import", files={"file": (name, data, "text/csv")})


def test_import_creates_students_who_can_login(admin: TestClient, db: Session) -> None:
    r = upload(admin, HEADER + "2026-1001,Ana Cruz,ana,TempPass1\n2026-1002,Ben Reyes,ben,TempPass2\n")
    assert r.status_code == 200
    assert r.json() == {"created": 2, "skipped": 0, "errors": []}
    assert db.scalars(select(User).where(User.role == Role.STUDENT)).all().__len__() == 2
    assert login(new_device(), "ana", "TempPass1").status_code == 200


def test_import_reports_bad_and_duplicate_rows_but_keeps_good_ones(admin: TestClient) -> None:
    admin.post("/api/v1/users", json=NEW_USER)  # bob / 2026-0001 already exist
    csv_text = HEADER + "\n".join([
        "2026-2001,Good One,good1,TempPass1",
        "2026-2002,Dup Name,bob,TempPass1",          # row 3: username exists
        "2026-0001,Dup No,newname,TempPass1",         # row 4: student_no exists
        "2026-2003,Short Pw,shortpw,abc",             # row 5: password too short
        ",No Number,nonumber,TempPass1",              # row 6: missing student_no
        "2026-2004,Bad User,bad user,TempPass1",      # row 7: invalid username
        "2026-2005,In File Dup,good1,TempPass1",      # row 8: duplicate inside the file
        "2026-2006,Good Two,good2,TempPass1",
    ]) + "\n"
    body = upload(admin, csv_text).json()
    assert body["created"] == 2 and body["skipped"] == 6
    assert [e["row"] for e in body["errors"]] == [3, 4, 5, 6, 7, 8]
    assert login(new_device(), "good2", "TempPass1").status_code == 200


def test_import_accepts_excel_bom_and_header_case(admin: TestClient) -> None:
    data = "﻿Student_No,Full_Name,Username,Temp_Password\n2026-3001,Cara,cara,TempPass1\n"
    assert upload(admin, data).json()["created"] == 1


@pytest.mark.parametrize("content", [
    "student_no,full_name,username\n1,A,aaa\n",   # missing temp_password column
    HEADER,                                        # no rows
    b"\xff\xfe\x00bad",                            # not UTF-8
])
def test_import_rejects_malformed_files(admin: TestClient, content: str | bytes) -> None:
    r = upload(admin, content)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_CSV"


def test_import_rejects_oversized_file(admin: TestClient) -> None:
    r = upload(admin, HEADER + "x" * (300 * 1024))
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"


# ---------- audit ----------

def test_user_management_is_audited(admin: TestClient, db: Session) -> None:
    uid = admin.post("/api/v1/users", json=NEW_USER).json()["id"]
    admin.patch(f"/api/v1/users/{uid}", json={"full_name": "Robert"})
    admin.post(f"/api/v1/users/{uid}/reset-password")
    upload(admin, HEADER + "2026-4001,Dee,dee,TempPass1\n")
    db.expire_all()
    actions = list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))
    assert actions[-4:] == ["user_create", "user_update", "password_reset", "user_import"]
    details = str(list(db.scalars(select(ActivityLog.details))))
    assert NEW_USER["password"] not in details and "TempPass1" not in details
    assert PASSWORD not in details


def test_make_user_helper_roles(db: Session) -> None:
    assert make_user(db, Role.INSTRUCTOR, "teach").role == Role.INSTRUCTOR
