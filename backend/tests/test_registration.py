"""Student self sign-up gated by admin-issued one-time registration codes."""
import hashlib
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base, utcnow
from app.core.security import UNAMBIGUOUS_ALPHABET
from app.main import app
from app.models.activity_log import ActivityLog
from app.models.registration_code import RegistrationCode
from app.models.user import Role, User
from app.services import registration_service
from tests.conftest import PASSWORD, login, login_as, make_user, new_class, new_code, new_device

API = "/api/v1"
CODE_RE = re.compile(rf"^[{UNAMBIGUOUS_ALPHABET}]{{5}}-[{UNAMBIGUOUS_ALPHABET}]{{5}}$")
INVALID = {"detail": "Invalid or expired code", "code": "INVALID_REGISTRATION_CODE"}


# ---------------------------------------------------------------- helpers

@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "admin")


def gen(admin: TestClient, count: int = 1, batch: str = "Batch A", **extra):
    return admin.post(f"{API}/registration-codes", json={"count": count, "batch_name": batch, **extra})


def make_codes(admin: TestClient, count: int = 1, batch: str = "Batch A", **extra) -> list[str]:
    r = gen(admin, count, batch, **extra)
    assert r.status_code == 201, r.text
    return r.json()["codes"]


def canonical(code: str) -> str:
    return code.replace("-", "")


def sha(code: str) -> str:
    return hashlib.sha256(canonical(code).encode()).hexdigest()


def signup(client: TestClient, code: str, **over):
    body = {"code": code, "student_no": "2026-0001", "full_name": "Maria Santos",
            "username": "maria.s", "password": "Sup3rSecret", **over}
    return client.post(f"{API}/auth/register", json=body)


def code_rows(db: Session) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(RegistrationCode))


def user_by_name(db: Session, username: str):
    db.expire_all()
    return db.scalars(select(User).where(User.username == username)).first()


# ================================================================ generation

def test_single_code_format_and_response(admin: TestClient) -> None:
    r = gen(admin, batch="Section A")
    assert r.status_code == 201
    body = r.json()
    assert body["count"] == 1 and body["batch_name"] == "Section A" and body["expires_at"] is None
    assert len(body["codes"]) == 1 and CODE_RE.match(body["codes"][0])
    assert not set("0O1IL") & set(canonical(body["codes"][0]))  # no ambiguous characters
    assert r.headers["cache-control"] == "no-store"  # a response full of secrets is never cached


def test_bulk_generation_gives_unique_codes(admin: TestClient, db: Session) -> None:
    codes = make_codes(admin, count=200, batch="Whole year")
    assert len(codes) == len(set(codes)) == 200 and all(CODE_RE.match(c) for c in codes)
    assert code_rows(db) == 200


@pytest.mark.parametrize("body", [
    {"count": 0, "batch_name": "B"}, {"count": 201, "batch_name": "B"}, {"count": -1, "batch_name": "B"},
    {"batch_name": "B"}, {"count": 1}, {"count": 1, "batch_name": ""}, {"count": 1, "batch_name": "   "},
    {"count": 1, "batch_name": "x" * 101},
    {"count": 2, "batch_name": "B", "student_no": "2026-1"},      # student_no only with count = 1
    {"count": 5, "batch_name": "B", "full_name": "Maria"},        # full_name only with count = 1
    {"count": 1, "batch_name": "B", "student_no": "  "},
])
def test_generation_validation(admin: TestClient, db: Session, body: dict) -> None:
    r = admin.post(f"{API}/registration-codes", json=body)
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"
    assert code_rows(db) == 0


def test_single_code_can_be_bound_to_a_student_and_prefilled(admin: TestClient, db: Session) -> None:
    code = make_codes(admin, student_no="2026-0042", full_name="Maria Santos", expires_at="2099-01-01T00:00:00Z")[0]
    row = db.scalars(select(RegistrationCode)).one()
    assert row.student_no == "2026-0042" and row.full_name == "Maria Santos" and row.expires_at.year == 2099
    assert row.batch_name == "Batch A" and row.code_hash == sha(code)


def test_expiry_must_be_in_the_future_and_student_must_not_exist_yet(admin: TestClient, db: Session) -> None:
    r = gen(admin, expires_at="2000-01-01T00:00:00Z")
    assert r.status_code == 400 and r.json()["code"] == "INVALID_EXPIRY"
    make_user(db, Role.STUDENT, "existing", student_no="2026-0007")
    r = gen(admin, student_no="2026-0007")
    assert r.status_code == 409 and r.json()["code"] == "STUDENT_NO_TAKEN"
    assert code_rows(db) == 0


# ===================================================== plaintext stays secret

def test_plaintext_codes_appear_only_in_the_create_response(admin: TestClient, db: Session, caplog) -> None:
    caplog.set_level(logging.DEBUG)
    codes = make_codes(admin, count=3, batch="Secret batch")

    db.expire_all()
    stored = []
    for row in db.scalars(select(RegistrationCode)):
        stored.append(row)
        assert len(row.code_hash) == 64 and row.code_hash in {sha(c) for c in codes}   # SHA-256 of the code
        assert row.code_hint in {canonical(c)[-4:] for c in codes}                      # last 4 characters
    assert len(stored) == 3

    # nothing else the API says, stores or logs contains a code
    everything = [
        json.dumps(admin.get(f"{API}/registration-codes").json()),
        json.dumps(admin.get(f"{API}/registration-codes/batches").json()),
        json.dumps([[str(getattr(r, c.name)) for c in RegistrationCode.__table__.columns] for r in stored]),
        json.dumps([[str(a.details), str(a.action)] for a in db.scalars(select(ActivityLog))]),
        caplog.text,
    ]
    for blob in everything:
        for code in codes:
            assert code not in blob and canonical(code) not in blob

    # even a failed and a successful sign-up leave no trace of the code
    signup(new_device(), codes[0], username="nobody1")
    signup(new_device(), "ZZZZZ-ZZZZZ")
    db.expire_all()
    audit = json.dumps([[str(a.details), str(a.ip_address)] for a in db.scalars(select(ActivityLog))])
    for code in codes + ["ZZZZZ-ZZZZZ"]:
        assert code not in audit and canonical(code) not in audit and code not in caplog.text


def test_only_the_hash_is_stored_so_a_database_leak_gives_no_working_codes(admin: TestClient, db: Session) -> None:
    code = make_codes(admin)[0]
    row = db.scalars(select(RegistrationCode)).one()
    r = signup(new_device(), row.code_hash)  # presenting the stolen hash is not the same as the code
    assert r.status_code == 400 and r.json() == INVALID
    assert signup(new_device(), code).status_code == 201


# ============================================================ sign-up works

def test_signup_creates_the_student_logs_them_in_and_spends_the_code(admin: TestClient, db: Session) -> None:
    code = make_codes(admin, batch="Section A")[0]
    anon = new_device()
    r = signup(anon, code)

    assert r.status_code == 201
    body = r.json()
    assert body["username"] == "maria.s" and body["full_name"] == "Maria Santos"
    assert body["student_no"] == "2026-0001" and body["role"] == "student" and body["is_active"] is True
    assert not {"password", "password_hash", "email"} & set(body)
    cookie = r.headers["set-cookie"].lower()
    assert settings.COOKIE_NAME in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert anon.get(f"{API}/auth/me").json()["username"] == "maria.s"  # already signed in

    user = user_by_name(db, "maria.s")
    assert user.password_hash.startswith("$argon2") and user.current_session_id and user.is_active
    assert code_rows(db) == 0  # the code was deleted

    again = signup(new_device(), code, username="someone.else", student_no="2026-0002")
    assert again.status_code == 400 and again.json() == INVALID  # a used code is just an invalid code


def test_the_new_student_can_log_in_later_and_signing_in_elsewhere_ends_the_first_session(
        admin: TestClient, db: Session) -> None:
    first = new_device()
    signup(first, make_codes(admin)[0])
    second = new_device()
    assert login(second, "maria.s", "Sup3rSecret").status_code == 200
    r = first.get(f"{API}/auth/me")  # the sign-up session obeys the one-device rule like any other
    assert r.status_code == 401 and r.json()["code"] == "SESSION_REPLACED"


def test_the_new_student_can_join_a_class(admin: TestClient, db: Session) -> None:
    teacher = login_as(db, Role.INSTRUCTOR, "teach1")
    invite = new_code(teacher, new_class(teacher))["code"]
    student = new_device()
    signup(student, make_codes(admin)[0])
    assert student.post(f"{API}/enroll", json={"code": invite}).status_code == 201


@pytest.mark.parametrize("typed", [lambda c: c, lambda c: canonical(c), lambda c: c.lower(),
                                   lambda c: f"  {c.lower()}  ", lambda c: c[:3] + " " + c[3:]])
def test_the_code_may_be_typed_loosely(admin: TestClient, typed) -> None:
    code = make_codes(admin)[0]
    assert signup(new_device(), typed(code)).status_code == 201


def test_input_is_normalised(admin: TestClient, db: Session) -> None:
    r = signup(new_device(), make_codes(admin)[0], username="  Maria.S  ", student_no="  2026-0001 ",
               full_name="  Maria   Santos  ")
    assert r.status_code == 201
    user = user_by_name(db, "maria.s")
    assert (user.username, user.student_no, user.full_name) == ("maria.s", "2026-0001", "Maria   Santos")


def test_a_name_prefilled_by_the_admin_is_used(admin: TestClient, db: Session) -> None:
    code = make_codes(admin, student_no="2026-0001", full_name="Maria Santos Reyes")[0]
    r = signup(new_device(), code, full_name="mari santos")
    assert r.status_code == 201 and r.json()["full_name"] == "Maria Santos Reyes"


def test_a_code_bound_to_a_student_number_works_for_that_student(admin: TestClient, db: Session) -> None:
    code = make_codes(admin, student_no="2026-0042")[0]
    r = signup(new_device(), code, student_no=" 2026-0042 ")
    assert r.status_code == 201 and r.json()["student_no"] == "2026-0042"


# ==================================== every bad code: the same answer, no hint

def error_of(r) -> tuple[int, dict]:
    return r.status_code, r.json()


def test_expired_revoked_wrong_malformed_and_mismatched_codes_all_fail_identically(
        admin: TestClient, db: Session) -> None:
    expired, revoked, mismatched, used = make_codes(admin, count=1, batch="E")[0], None, None, None
    db.expire_all()
    db.scalars(select(RegistrationCode)).one().expires_at = utcnow() - timedelta(minutes=1)
    db.commit()

    revoked = make_codes(admin, batch="R")[0]
    revoked_id = admin.get(f"{API}/registration-codes", params={"batch": "R"}).json()["items"][0]["id"]
    assert admin.delete(f"{API}/registration-codes/{revoked_id}").status_code == 204

    mismatched = make_codes(admin, batch="M", student_no="2026-0042")[0]
    used = make_codes(admin, batch="U")[0]
    assert signup(new_device(), used, username="first.user", student_no="2026-0100").status_code == 201

    attempts = {
        "expired": signup(new_device(), expired),
        "revoked": signup(new_device(), revoked),
        "never existed": signup(new_device(), "ABCDE-FGHJK"),
        "malformed": signup(new_device(), "not a code"),
        "too short": signup(new_device(), "ABC"),
        "used": signup(new_device(), used, username="second.user", student_no="2026-0101"),
        "wrong student number": signup(new_device(), mismatched, student_no="2026-0099"),
    }
    for name, r in attempts.items():
        assert error_of(r) == (400, INVALID), name
    assert all(r.text == attempts["expired"].text for r in attempts.values())  # byte-for-byte identical

    assert user_by_name(db, "maria.s") is None  # nobody was created by any of the failures
    # the code that failed on the student number is still good for the right student
    assert signup(new_device(), mismatched, student_no="2026-0042").status_code == 201


def test_a_student_number_mismatch_is_case_insensitive_only_in_the_obvious_way(admin: TestClient) -> None:
    code = make_codes(admin, student_no="ab-123")[0]
    assert signup(new_device(), code, student_no="AB-123").status_code == 201


# ============================================= a failed sign-up keeps the code

def test_a_taken_username_gives_409_and_the_code_survives(admin: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "maria.s", student_no="2026-0777")
    code = make_codes(admin)[0]
    r = signup(new_device(), code)
    assert r.status_code == 409 and r.json()["code"] == "USERNAME_TAKEN"
    assert "username" in r.json()["detail"].lower() and "taken" in r.json()["detail"].lower()
    assert code_rows(db) == 1
    assert signup(new_device(), code, username="maria.s2").status_code == 201  # same code, another username
    assert code_rows(db) == 0


def test_a_taken_student_number_gives_409_and_the_code_survives(admin: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "someone", student_no="2026-0001")
    code = make_codes(admin)[0]
    r = signup(new_device(), code)
    assert r.status_code == 409 and r.json()["code"] == "STUDENT_NO_TAKEN"
    assert "student number" in r.json()["detail"].lower()
    assert code_rows(db) == 1
    assert signup(new_device(), code, student_no="2026-0002").status_code == 201


def test_invalid_form_fields_do_not_consume_the_code(admin: TestClient, db: Session) -> None:
    code = make_codes(admin)[0]
    bad = [{"username": "abc"}, {"username": "UPPER space"}, {"password": "short"}, {"student_no": "   "},
           {"full_name": ""}, {"username": "bad-dash"}]
    for over in bad:
        r = signup(new_device(), code, **over)
        assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR", over
        assert code not in r.text
    assert code_rows(db) == 1 and signup(new_device(), code).status_code == 201


def test_the_username_is_checked_only_after_the_code(admin: TestClient, db: Session) -> None:
    """With a bad code, a taken username must not be revealed."""
    make_user(db, Role.STUDENT, "maria.s", student_no="2026-0777")
    assert error_of(signup(new_device(), "ABCDE-FGHJK")) == (400, INVALID)


# ----------------------------------------------------- the sign-up rules

@pytest.mark.parametrize("username", ["abc", "a" * 33, "has space", "bad-dash", "üser12", "emoji\U0001F600", "a/b/c/d"])
def test_bad_usernames(admin: TestClient, username: str) -> None:
    r = signup(new_device(), make_codes(admin)[0], username=username)
    assert r.status_code == 422 and "username" in r.json()["detail"]


@pytest.mark.parametrize("username", ["abcd", "a" * 32, "m.s_1.2", "UPPER.Case"])
def test_good_usernames(admin: TestClient, db: Session, username: str) -> None:
    assert signup(new_device(), make_codes(admin)[0], username=username).status_code == 201
    assert user_by_name(db, username.lower()) is not None  # always stored lowercase


def test_password_must_be_at_least_8_characters(admin: TestClient) -> None:
    code = make_codes(admin)[0]
    assert signup(new_device(), code, password="1234567").status_code == 422
    assert signup(new_device(), code, password="12345678").status_code == 201


@pytest.mark.parametrize("field,value", [("student_no", "x" * 33), ("full_name", "x" * 151), ("student_no", ""),
                                         ("full_name", "   ")])
def test_student_no_and_full_name_are_required_and_bounded(admin: TestClient, field: str, value: str) -> None:
    assert signup(new_device(), make_codes(admin)[0], **{field: value}).status_code == 422


def test_missing_fields_are_rejected(admin: TestClient) -> None:
    code = make_codes(admin)[0]
    for missing in ("code", "student_no", "full_name", "username", "password"):
        body = {"code": code, "student_no": "1", "full_name": "N", "username": "abcd", "password": "12345678"}
        body.pop(missing)
        assert new_device().post(f"{API}/auth/register", json=body).status_code == 422, missing


# ================================================================ concurrency

def test_one_code_used_at_the_same_moment_creates_exactly_one_user(admin: TestClient, db: Session) -> None:
    code = make_codes(admin)[0]

    def attempt(i: int):
        return signup(new_device(), code, username=f"racer{i:02d}", student_no=f"2026-{i:04d}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))

    assert sorted(r.status_code for r in results) == [201] + [400] * 7
    assert all(r.json() == INVALID for r in results if r.status_code == 400)
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(User).where(User.username.like("racer%"))) == 1
    assert code_rows(db) == 0


def test_two_codes_racing_for_one_username_lose_only_the_unlucky_code(admin: TestClient, db: Session) -> None:
    codes = make_codes(admin, count=5)

    def attempt(i: int):
        return signup(new_device(), codes[i], username="same.name", student_no=f"2026-{i:04d}")

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(attempt, range(5)))
    assert sorted(r.status_code for r in results) == [201] + [409] * 4
    assert {r.json()["code"] for r in results if r.status_code == 409} <= {"USERNAME_TAKEN", "DUPLICATE_USER"}
    assert code_rows(db) == 4  # only the winner's code was spent


# ============================================== admin only, and never the code

ADMIN_CALLS = [
    ("post", f"{API}/registration-codes", {"json": {"count": 1, "batch_name": "X"}}),
    ("get", f"{API}/registration-codes", {}),
    ("get", f"{API}/registration-codes/batches", {}),
    ("delete", f"{API}/registration-codes/1", {}),
    ("delete", f"{API}/registration-codes?batch=Batch A", {}),
]


@pytest.mark.parametrize("role", [Role.STUDENT, Role.INSTRUCTOR])
def test_non_admins_cannot_generate_list_or_revoke(admin: TestClient, db: Session, role: Role) -> None:
    make_codes(admin, count=2)
    other = login_as(db, role, "intruder")
    for method, url, kw in ADMIN_CALLS:
        r = getattr(other, method)(url, **kw)
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN_ROLE", (method, url)
    assert code_rows(db) == 2  # nothing was created or revoked


def test_anonymous_users_cannot_manage_codes(admin: TestClient, db: Session) -> None:
    make_codes(admin)
    anon = new_device()
    for method, url, kw in ADMIN_CALLS:
        assert getattr(anon, method)(url, **kw).status_code == 401, (method, url)
    assert code_rows(db) == 1


def test_listing_never_exposes_codes(admin: TestClient) -> None:
    codes = make_codes(admin, count=3, batch="Section A", expires_at="2099-01-01T00:00:00Z")
    page = admin.get(f"{API}/registration-codes").json()
    assert page["total"] == 3 and page["page"] == 1
    for item in page["items"]:
        assert set(item) == {"id", "hint", "batch_name", "student_no", "expires_at", "created_at"}
        assert len(item["hint"]) == 4 and item["batch_name"] == "Section A"
        assert item["expires_at"] == "2099-01-01T00:00:00Z" and item["created_at"].endswith("Z")
    assert {i["hint"] for i in page["items"]} == {canonical(c)[-4:] for c in codes}
    assert not any(canonical(c) in json.dumps(page) for c in codes)


def test_listing_filters_by_batch_and_paginates(admin: TestClient) -> None:
    make_codes(admin, count=5, batch="One")
    make_codes(admin, count=2, batch="Two", )
    assert admin.get(f"{API}/registration-codes").json()["total"] == 7
    assert admin.get(f"{API}/registration-codes", params={"batch": "Two"}).json()["total"] == 2
    assert admin.get(f"{API}/registration-codes", params={"batch": "Nope"}).json()["items"] == []
    page2 = admin.get(f"{API}/registration-codes", params={"batch": "One", "page": 2, "size": 2}).json()
    assert page2["total"] == 5 and len(page2["items"]) == 2 and page2["page"] == 2
    assert admin.get(f"{API}/registration-codes", params={"size": 100}).status_code == 200
    assert admin.get(f"{API}/registration-codes", params={"size": 101}).status_code == 422


def test_listing_shows_only_unused_codes(admin: TestClient) -> None:
    codes = make_codes(admin, count=3)
    signup(new_device(), codes[0])
    page = admin.get(f"{API}/registration-codes").json()
    assert page["total"] == 2 and {i["hint"] for i in page["items"]} == {canonical(c)[-4:] for c in codes[1:]}


def test_batches_with_counts(admin: TestClient) -> None:
    make_codes(admin, count=3, batch="Section A")
    make_codes(admin, count=2, batch="Section B")
    batches = admin.get(f"{API}/registration-codes/batches").json()
    assert {b["batch_name"]: b["count"] for b in batches} == {"Section A": 3, "Section B": 2}
    assert batches[0]["batch_name"] == "Section B" and set(batches[0]) == {"batch_name", "count"}  # newest first
    signup(new_device(), make_codes(admin, batch="Section C")[0])
    assert "Section C" not in {b["batch_name"] for b in admin.get(f"{API}/registration-codes/batches").json()}


# =================================================================== revoking

def test_revoke_one_code(admin: TestClient, db: Session) -> None:
    code, keep = make_codes(admin, count=2)
    items = admin.get(f"{API}/registration-codes").json()["items"]
    target = next(i for i in items if i["hint"] == canonical(code)[-4:])
    assert admin.delete(f"{API}/registration-codes/{target['id']}").status_code == 204
    assert code_rows(db) == 1
    assert error_of(signup(new_device(), code)) == (400, INVALID)
    assert admin.delete(f"{API}/registration-codes/{target['id']}").json()["code"] == "REGISTRATION_CODE_NOT_FOUND"
    assert admin.delete(f"{API}/registration-codes/99999").status_code == 404


def test_revoke_a_whole_batch(admin: TestClient, db: Session) -> None:
    gone = make_codes(admin, count=4, batch="Cancelled")
    kept = make_codes(admin, count=2, batch="Keep me")
    r = admin.delete(f"{API}/registration-codes", params={"batch": "Cancelled"})
    assert r.status_code == 200 and r.json() == {"revoked": 4}
    assert code_rows(db) == 2
    assert all(error_of(signup(new_device(), c, username=f"user{i}x", student_no=f"S{i}")) == (400, INVALID)
               for i, c in enumerate(gone))
    assert signup(new_device(), kept[0]).status_code == 201
    assert admin.delete(f"{API}/registration-codes", params={"batch": "Cancelled"}).json() == {"revoked": 0}
    assert admin.delete(f"{API}/registration-codes").status_code == 422  # the batch name is required


# ============================================================ expiry + cleanup

def test_expired_codes_are_hidden_and_the_daily_job_deletes_them(admin: TestClient, db: Session, tasks_module) -> None:
    make_codes(admin, count=2, batch="Old")
    make_codes(admin, count=1, batch="Fresh", expires_at="2099-01-01T00:00:00Z")
    make_codes(admin, count=1, batch="Forever")
    db.expire_all()
    for row in db.scalars(select(RegistrationCode).where(RegistrationCode.batch_name == "Old")):
        row.expires_at = utcnow() - timedelta(days=1)
    db.commit()

    assert admin.get(f"{API}/registration-codes").json()["total"] == 2  # expired ones no longer listed
    assert {b["batch_name"] for b in admin.get(f"{API}/registration-codes/batches").json()} == {"Fresh", "Forever"}
    assert code_rows(db) == 4  # but still stored until the job runs

    assert tasks_module.delete_expired_registration_codes() == 2
    assert code_rows(db) == 2
    assert {r.batch_name for r in db.scalars(select(RegistrationCode))} == {"Fresh", "Forever"}
    assert registration_service.delete_expired(db) == 0  # nothing left to remove


def test_the_cleanup_job_runs_daily() -> None:
    from celery.schedules import crontab

    from app.worker.celery_app import celery_app

    entry = celery_app.conf.beat_schedule["delete-expired-registration-codes"]
    assert entry["task"] == "app.worker.tasks.delete_expired_registration_codes"
    assert entry["schedule"] == crontab(hour=3, minute=0)  # once a day


# ===================================================================== audit

def test_audit_trail(admin: TestClient, db: Session) -> None:
    codes = make_codes(admin, count=2, batch="Audit batch")
    code_id = admin.get(f"{API}/registration-codes").json()["items"][0]["id"]
    admin.delete(f"{API}/registration-codes/{code_id}")
    admin.delete(f"{API}/registration-codes", params={"batch": "Audit batch"})
    TestClient(new_device().app, client=("172.28.0.10", 50000)).post(  # through Nginx: the header is believed
        f"{API}/auth/register", headers={"X-Real-IP": "10.9.8.7"},
                      json={"code": "ZZZZZ-ZZZZZ", "student_no": "1", "full_name": "N",
                            "username": "abcd", "password": "12345678"})
    ok_code = make_codes(admin, batch="Success batch")[0]
    signup(new_device(), ok_code)

    db.expire_all()
    admin_id = user_by_name(db, "admin").id
    student_id = user_by_name(db, "maria.s").id
    logs = list(db.scalars(select(ActivityLog).order_by(ActivityLog.id)))
    by_action = lambda a: [l for l in logs if l.action == a]  # noqa: E731

    gen_logs = by_action("registration_codes_generate")
    assert gen_logs[0].details == {"count": 2, "batch": "Audit batch"} and gen_logs[0].user_id == admin_id
    revoke_logs = by_action("registration_code_revoke")
    assert revoke_logs[0].details == {"id": code_id, "batch": "Audit batch"}
    assert revoke_logs[1].details == {"batch": "Audit batch", "count": 1}

    failed = by_action("register_failed")
    assert len(failed) == 1 and failed[0].details is None and failed[0].user_id is None  # IP only
    assert failed[0].ip_address == "10.9.8.7"

    success = by_action("register")
    assert len(success) == 1 and success[0].user_id == student_id and success[0].details == {"batch": "Success batch"}
    assert any(l.action == "login" and l.user_id == student_id for l in logs)  # signed in by the sign-up

    blob = json.dumps([[l.action, str(l.details), str(l.user_id)] for l in logs])
    assert not any(canonical(c) in blob or c in blob for c in codes + [ok_code, "ZZZZZ-ZZZZZ"])


# ================================================= no email, anywhere

def test_there_is_no_email_in_users_schemas_or_endpoints() -> None:
    for table in Base.metadata.tables.values():
        assert not [c.name for c in table.columns if "mail" in c.name.lower()], table.name
    spec = json.dumps(app.openapi()).lower()
    assert "email" not in spec and "e-mail" not in spec


def test_nginx_limits_sign_up_to_5_per_minute_per_ip() -> None:
    from pathlib import Path

    conf = Path("nginx/nginx.conf").read_text()
    assert re.search(r"limit_req_zone\s+\$binary_remote_addr\s+zone=register_zone:10m\s+rate=5r/m", conf)
    assert re.search(r"location = /api/v1/auth/register \{\s*limit_req zone=register_zone burst=3", conf)
