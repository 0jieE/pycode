import jwt
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from tests.conftest import PASSWORD, login, make_user, new_device


def actions(db: Session) -> list[str]:
    db.expire_all()
    return list(db.scalars(select(ActivityLog.action).order_by(ActivityLog.id)))


def test_login_success_sets_httponly_cookie_and_me_works(client: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "alice", full_name="Alice")
    r = login(client, "alice")
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "alice" and body["role"] == "student"
    assert "password_hash" not in body and "current_session_id" not in body

    set_cookie = r.headers["set-cookie"].lower()
    assert settings.COOKIE_NAME in set_cookie and "httponly" in set_cookie and "samesite=lax" in set_cookie

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200 and me.json()["username"] == "alice"
    assert me.json()["created_at"].endswith("Z")  # timestamps are explicit UTC


def test_password_is_stored_as_argon2_hash(db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    assert user.password_hash.startswith("$argon2")
    assert PASSWORD not in user.password_hash


def test_wrong_password_rejected_and_audited(client: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "alice")
    r = login(client, "alice", "wrong-password")
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid username or password", "code": "INVALID_CREDENTIALS"}
    assert client.get("/api/v1/auth/me").status_code == 401
    assert actions(db) == ["user_create", "login_failed"]


def test_unknown_user_gets_same_error_as_wrong_password(client: TestClient, db: Session) -> None:
    r = login(client, "nobody")
    assert r.status_code == 401
    assert r.json()["code"] == "INVALID_CREDENTIALS"
    assert actions(db) == ["login_failed"]


def test_failed_login_audit_never_stores_the_password(client: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "alice")
    login(client, "alice", "super-secret-guess")
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "login_failed")).one()
    assert "super-secret-guess" not in str(log.details)


def test_inactive_user_cannot_login(client: TestClient, db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    user.is_active = False
    db.commit()
    r = login(client, "alice")
    assert r.status_code == 403
    assert r.json()["code"] == "ACCOUNT_DISABLED"
    assert "login_failed" in actions(db)


def test_inactive_user_with_wrong_password_gets_generic_error(client: TestClient, db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    user.is_active = False
    db.commit()
    assert login(client, "alice", "wrong").json()["code"] == "INVALID_CREDENTIALS"


def test_second_login_kicks_the_first_device(db: Session) -> None:
    make_user(db, Role.STUDENT, "alice")
    pc1, pc2 = new_device(), new_device()
    assert login(pc1, "alice").status_code == 200
    assert pc1.get("/api/v1/auth/me").status_code == 200

    assert login(pc2, "alice").status_code == 200  # same account, another PC

    kicked = pc1.get("/api/v1/auth/me")
    assert kicked.status_code == 401
    assert kicked.json() == {"detail": "Signed in on another device", "code": "SESSION_REPLACED"}
    assert pc2.get("/api/v1/auth/me").status_code == 200


def test_logout_ends_session_and_is_audited(client: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "alice")
    login(client, "alice")
    token = client.cookies.get(settings.COOKIE_NAME)

    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401  # cookie cleared

    client.cookies.set(settings.COOKIE_NAME, token)  # replaying the old token must fail too
    assert client.get("/api/v1/auth/me").json()["code"] == "SESSION_ENDED"
    assert actions(db) == ["user_create", "login", "logout"]


def test_login_is_audited_with_ip(client: TestClient, db: Session) -> None:
    make_user(db, Role.STUDENT, "alice")
    through_nginx = TestClient(client.app, client=("172.28.0.10", 50000))  # the only peer whose header is believed
    through_nginx.post("/api/v1/auth/login", json={"username": "alice", "password": PASSWORD},
                       headers={"X-Real-IP": "10.0.0.7"})
    log = db.scalars(select(ActivityLog).where(ActivityLog.action == "login")).one()
    assert log.ip_address == "10.0.0.7"


def test_no_cookie_is_401(client: TestClient) -> None:
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401 and r.json()["code"] == "NOT_AUTHENTICATED"


def test_tampered_and_expired_tokens_rejected(client: TestClient, db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    login(client, "alice")
    db.refresh(user)

    forged = jwt.encode({"sub": str(user.id), "sid": user.current_session_id, "exp": 9999999999},
                        "not-the-real-secret-but-long-enough-for-hs256", algorithm="HS256")
    client.cookies.set(settings.COOKIE_NAME, forged)
    assert client.get("/api/v1/auth/me").json()["code"] == "INVALID_TOKEN"

    expired = create_access_token(user.id, user.current_session_id, expires_minutes=-1)
    client.cookies.set(settings.COOKIE_NAME, expired)
    assert client.get("/api/v1/auth/me").json()["code"] == "INVALID_TOKEN"

    client.cookies.set(settings.COOKIE_NAME, "garbage")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_deactivated_user_with_live_session_is_blocked(client: TestClient, db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    login(client, "alice")
    user.is_active = False
    db.commit()
    assert client.get("/api/v1/auth/me").status_code == 403


def test_deleted_user_token_rejected(client: TestClient, db: Session) -> None:
    user = make_user(db, Role.STUDENT, "alice")
    login(client, "alice")
    db.delete(db.get(User, user.id))
    db.commit()
    assert client.get("/api/v1/auth/me").json()["code"] == "INVALID_TOKEN"


def test_a_token_issued_a_moment_in_the_future_is_accepted(client: TestClient, db: Session) -> None:
    """Clock steps (VM time sync, NTP) must not reject a fresh token as 'not yet valid'."""
    from datetime import datetime, timedelta, timezone

    user = make_user(db, Role.STUDENT, "alice")
    login(client, "alice")
    db.refresh(user)
    future = datetime.now(timezone.utc) + timedelta(seconds=5)
    token = jwt.encode({"sub": str(user.id), "sid": user.current_session_id, "iat": future,
                        "exp": future + timedelta(hours=1)}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    client.cookies.set(settings.COOKIE_NAME, token)
    assert client.get("/api/v1/auth/me").status_code == 200

    way_off = datetime.now(timezone.utc) + timedelta(minutes=10)  # but a badly wrong clock is still refused
    token = jwt.encode({"sub": str(user.id), "sid": user.current_session_id, "iat": way_off,
                        "exp": way_off + timedelta(hours=1)}, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    client.cookies.set(settings.COOKIE_NAME, token)
    assert client.get("/api/v1/auth/me").json()["code"] == "INVALID_TOKEN"
