import logging
from typing import Optional

import jwt
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ForbiddenError, UnauthorizedError
from app.core.redis import get_redis
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    decode_access_token,
    hash_password,
    new_session_id,
    verify_password,
)
from app.models.lab import LoginOutcome
from app.models.user import Role, User
from app.schemas.auth import ProfileUpdate
from app.services import audit_service, login_log_service, user_service

logger = logging.getLogger(__name__)


def login(db: Session, username: str, password: str, ip: Optional[str],
          user_agent: Optional[str] = None) -> tuple[User, str]:
    """Verifies credentials and starts a new session. Returns (user, jwt).

    Replacing current_session_id is what signs the user out everywhere else (one active session per account). The
    sign-in log records whether this login signed another session of the account out ("replaced_other_session").
    The address goes to the audit log only.
    """
    username = username.strip()
    user = db.scalar(select(User).where(User.username == username))

    # Always run one argon2 verification so unknown usernames cost the same as wrong passwords.
    password_ok = verify_password(password, user.password_hash if user else DUMMY_HASH)

    if user is None or not password_ok:
        audit_service.record(
            db, audit_service.LOGIN_FAILED, user_id=user.id if user else None,
            details={"username": username[:64], "reason": "bad_credentials"}, ip_address=ip,
        )
        db.commit()
        raise AppError(401, "Invalid username or password", "INVALID_CREDENTIALS")

    if not user.is_active:
        audit_service.record(
            db, audit_service.LOGIN_FAILED, user_id=user.id,
            details={"username": username[:64], "reason": "inactive"}, ip_address=ip,
        )
        db.commit()
        raise ForbiddenError("This account is disabled", "ACCOUNT_DISABLED")

    replaced = user.current_session_id is not None          # another session of this account gets signed out
    user.current_session_id = new_session_id()
    login_log_service.log_login(db, user, user_agent,
                                LoginOutcome.REPLACED_OTHER_SESSION if replaced else LoginOutcome.SUCCESS)
    audit_service.record(db, audit_service.LOGIN, user_id=user.id, ip_address=ip)
    db.commit()
    return user, create_access_token(user.id, user.current_session_id)


def logout(db: Session, user: User, ip: Optional[str]) -> None:
    user.current_session_id = None
    audit_service.record(db, audit_service.LOGOUT, user_id=user.id, ip_address=ip)
    db.commit()


def authenticate_token(db: Session, token: str, allow_password_change_pending: bool = False) -> User:
    """Resolves a JWT to its user. Shared by HTTP dependencies and WebSockets. A user who still has to change a
    temporary password is refused (403 PASSWORD_CHANGE_REQUIRED) unless the caller is one of the few endpoints that
    let them do that."""
    try:
        claims = decode_access_token(token)
        user_id = int(claims["sub"])
    except (jwt.PyJWTError, ValueError) as exc:
        logger.warning(f"token rejected: {type(exc).__name__}")  # never log the token itself
        raise UnauthorizedError("Invalid or expired session", "INVALID_TOKEN")

    user = db.get(User, user_id)
    if user is None:
        logger.warning("token rejected", extra={"reason": "user_not_found", "user_id": user_id})
        raise UnauthorizedError("Invalid or expired session", "INVALID_TOKEN")
    if not user.is_active:
        raise ForbiddenError("This account is disabled", "ACCOUNT_DISABLED")
    if user.current_session_id is None:
        raise UnauthorizedError("You have been signed out", "SESSION_ENDED")
    if user.current_session_id != claims["sid"]:
        raise UnauthorizedError("Signed in on another device", "SESSION_REPLACED")
    if user.must_change_password and not allow_password_change_pending:
        raise ForbiddenError("You must change your temporary password first", "PASSWORD_CHANGE_REQUIRED")
    return user


# ------------------------------------------------------------ my own account

PASSWORD_ATTEMPT_LIMIT = 5         # attempts to change the password ...
PASSWORD_ATTEMPT_WINDOW = 15 * 60  # ... per user in this many seconds (a stolen cookie cannot guess the password)


def update_profile(db: Session, user: User, data: ProfileUpdate, ip: Optional[str]) -> User:
    """Changes the signed-in user's own name and/or username. Role, student number and active flag are not here."""
    changes = data.model_dump(exclude_unset=True)
    changed: list[str] = []
    if "username" in changes and changes["username"] != user.username.lower():
        user_service.assert_username_free(db, changes["username"], exclude_id=user.id)
        user.username = changes["username"]
        changed.append("username")
    if "full_name" in changes and changes["full_name"] != user.full_name:
        user.full_name = changes["full_name"]
        changed.append("full_name")
    if changed:
        audit_service.record(db, audit_service.PROFILE_UPDATE, user_id=user.id,
                             details={"fields": sorted(changed)}, ip_address=ip)  # field names only, never values
        user_service.commit_or_conflict(db)
    return user


def change_password(db: Session, user: User, current_password: str, new_password: str,
                    ip: Optional[str]) -> str:
    """Sets the user's own new password. Returns a token for a NEW session: every other device is signed out, this
    one stays in."""
    key = f"pwchange:attempts:{user.id}"
    try:
        r = get_redis()
        attempts = r.incr(key)  # one atomic command: concurrent guesses cannot slip past the limit
        if attempts == 1:
            r.expire(key, PASSWORD_ATTEMPT_WINDOW)
    except RedisError:
        logger.exception("redis unavailable while changing a password")
        raise AppError(503, "Server busy, try again", "SERVER_BUSY")
    if attempts > PASSWORD_ATTEMPT_LIMIT:
        raise AppError(429, "Too many attempts. Try again in a few minutes", "TOO_MANY_ATTEMPTS")

    if not verify_password(current_password, user.password_hash):
        audit_service.record(db, audit_service.PASSWORD_CHANGE_FAILED, user_id=user.id, ip_address=ip)
        db.commit()
        raise AppError(400, "Your current password is wrong", "INVALID_CURRENT_PASSWORD")
    if verify_password(new_password, user.password_hash):
        raise AppError(400, "The new password must be different from the current one", "PASSWORD_UNCHANGED")

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.current_session_id = new_session_id()
    audit_service.record(db, audit_service.PASSWORD_CHANGE, user_id=user.id, ip_address=ip)
    db.commit()
    try:
        get_redis().delete(key)
    except RedisError:
        logger.warning("could not reset the password attempt counter")
    return create_access_token(user.id, user.current_session_id)
