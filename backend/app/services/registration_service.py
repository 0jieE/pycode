"""Student self sign-up gated by admin-issued one-time registration codes.

Codes are random, shown to the admin ONCE, and stored only as a SHA-256 hash. Using a code deletes its row in the
same transaction that creates the account, so a code can never be used twice. Nothing here logs or audits a code.
"""
import logging
from typing import Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.security import (
    create_access_token,
    format_registration_code,
    generate_registration_code,
    hash_password,
    hash_registration_code,
    new_session_id,
    normalize_registration_code,
)
from app.models.registration_code import RegistrationCode
from app.models.user import Role, User
from app.schemas.registration import (
    BatchOut,
    RegisterRequest,
    RegistrationCodeCreate,
    RegistrationCodeOut,
    RegistrationCodesCreated,
)
from app.services import audit_service

logger = logging.getLogger(__name__)

INVALID_CODE_MESSAGE = "Invalid or expired code"  # the SAME for every reason, so it reveals nothing


def _unexpired():
    return or_(RegistrationCode.expires_at.is_(None), RegistrationCode.expires_at > utcnow())


# ---------------------------------------------------------------------- admin

def create_codes(db: Session, admin: User, data: RegistrationCodeCreate,
                 ip: Optional[str]) -> RegistrationCodesCreated:
    """Generates `count` codes and returns them in plaintext. This is the only time they are visible."""
    if data.expires_at is not None and data.expires_at <= utcnow():
        raise AppError(400, "expires_at must be in the future", "INVALID_EXPIRY")
    if data.student_no and db.scalar(select(User.id).where(User.student_no == data.student_no)) is not None:
        raise ConflictError("A student with this student number already has an account", "STUDENT_NO_TAKEN")

    for attempt in range(3):  # a hash collision is astronomically unlikely, but costs nothing to survive
        codes: set[str] = set()
        while len(codes) < data.count:
            codes.add(generate_registration_code())
        db.add_all(
            RegistrationCode(
                code_hash=hash_registration_code(c), code_hint=c[-4:], batch_name=data.batch_name,
                student_no=data.student_no, full_name=data.full_name, expires_at=data.expires_at,
                created_by=admin.id)
            for c in codes
        )
        audit_service.record(db, audit_service.REGISTRATION_CODES_GENERATE, user_id=admin.id,
                             details={"count": data.count, "batch": data.batch_name}, ip_address=ip)
        try:
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise AppError(500, "Could not generate unique codes, try again", "CODE_GENERATION_FAILED")
    return RegistrationCodesCreated(
        batch_name=data.batch_name, count=data.count, expires_at=data.expires_at,
        codes=[format_registration_code(c) for c in sorted(codes)])


def list_codes(db: Session, batch: Optional[str], offset: int,
               limit: int) -> tuple[list[RegistrationCodeOut], int]:
    """Unused, still-valid codes. Never contains the code."""
    stmt = select(RegistrationCode).where(_unexpired())
    if batch:
        stmt = stmt.where(RegistrationCode.batch_name == batch)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(RegistrationCode.created_at.desc(), RegistrationCode.id.desc())
                      .offset(offset).limit(limit)).all()
    return [RegistrationCodeOut(id=r.id, hint=r.code_hint, batch_name=r.batch_name, student_no=r.student_no,
                                expires_at=r.expires_at, created_at=r.created_at) for r in rows], total


def list_batches(db: Session) -> list[BatchOut]:
    rows = db.execute(
        select(RegistrationCode.batch_name, func.count(), func.max(RegistrationCode.created_at))
        .where(_unexpired()).group_by(RegistrationCode.batch_name)
        .order_by(func.max(RegistrationCode.created_at).desc())
    ).all()
    return [BatchOut(batch_name=name, count=n) for name, n, _ in rows]


def revoke_code(db: Session, admin: User, code_id: int, ip: Optional[str]) -> None:
    row = db.get(RegistrationCode, code_id)
    if row is None:
        raise NotFoundError("Registration code not found", "REGISTRATION_CODE_NOT_FOUND")
    audit_service.record(db, audit_service.REGISTRATION_CODE_REVOKE, user_id=admin.id,
                         details={"id": row.id, "batch": row.batch_name}, ip_address=ip)
    db.delete(row)
    db.commit()


def revoke_batch(db: Session, admin: User, batch: str, ip: Optional[str]) -> int:
    revoked = db.execute(delete(RegistrationCode).where(RegistrationCode.batch_name == batch)).rowcount
    audit_service.record(db, audit_service.REGISTRATION_CODE_REVOKE, user_id=admin.id,
                         details={"batch": batch, "count": revoked}, ip_address=ip)
    db.commit()
    return revoked


def delete_expired(db: Session) -> int:
    """Daily beat job: expired codes are useless, so they are removed."""
    removed = db.execute(delete(RegistrationCode).where(
        RegistrationCode.expires_at.is_not(None), RegistrationCode.expires_at <= utcnow())).rowcount
    db.commit()
    if removed:
        logger.info("deleted expired registration codes", extra={"count": removed})
    return removed


# --------------------------------------------------------------------- public

def _fail(db: Session, ip: Optional[str], error: AppError) -> AppError:
    """Undo everything (the code stays unused) and record the failed attempt: IP only, never the code."""
    db.rollback()
    audit_service.record(db, audit_service.REGISTER_FAILED, ip_address=ip)
    db.commit()
    return error


def _invalid_code() -> AppError:
    return AppError(400, INVALID_CODE_MESSAGE, "INVALID_REGISTRATION_CODE")


def register(db: Session, data: RegisterRequest, ip: Optional[str]) -> tuple[User, str]:
    """Creates a student account with a registration code and signs them in. Returns (user, jwt).

    One transaction: lock the code row, check it, create the user, delete the code. If two people use the same code
    at the same moment, the second waits for the first to finish, then finds no code: exactly one succeeds. Any
    failure rolls everything back, so a failed sign-up never consumes the code."""
    canonical = normalize_registration_code(data.code)
    if canonical is None:  # cannot be a code at all
        raise _fail(db, ip, _invalid_code())

    row = db.scalar(select(RegistrationCode).where(
        RegistrationCode.code_hash == hash_registration_code(canonical)).with_for_update())
    if row is None:
        raise _fail(db, ip, _invalid_code())
    if row.expires_at is not None and row.expires_at <= utcnow():
        raise _fail(db, ip, _invalid_code())
    if row.student_no is not None and row.student_no.strip().lower() != data.student_no.lower():
        raise _fail(db, ip, _invalid_code())  # same message: nothing says WHICH part was wrong

    # The code is genuine from here on, so it is fine to tell the student what is wrong with the rest.
    if db.scalar(select(User.id).where(User.username == data.username)) is not None:
        raise _fail(db, ip, ConflictError("That username is already taken. Please choose another.", "USERNAME_TAKEN"))
    if db.scalar(select(User.id).where(User.student_no == data.student_no)) is not None:
        raise _fail(db, ip, ConflictError("An account with this student number already exists.", "STUDENT_NO_TAKEN"))

    user = User(
        username=data.username, password_hash=hash_password(data.password),
        full_name=row.full_name or data.full_name,  # a name the admin prefilled is authoritative
        student_no=data.student_no, role=Role.STUDENT, is_active=True, current_session_id=new_session_id(),
    )
    batch = row.batch_name
    db.add(user)
    try:
        db.flush()
        db.delete(row)  # the code is spent
        audit_service.record(db, audit_service.REGISTER, user_id=user.id, details={"batch": batch}, ip_address=ip)
        audit_service.record(db, audit_service.LOGIN, user_id=user.id, ip_address=ip)
        db.commit()
    except IntegrityError:  # someone took the username / student number a moment ago
        raise _fail(db, ip, ConflictError("That username or student number is already in use.", "DUPLICATE_USER"))
    return user, create_access_token(user.id, user.current_session_id)
