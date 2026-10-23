import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import settings

_hasher = PasswordHasher()

# No ambiguous characters (no 0/O, 1/I/L). Used for invite codes and temporary passwords.
UNAMBIGUOUS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


# Verified against when the username doesn't exist, so response time doesn't reveal which usernames exist.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def create_access_token(user_id: int, session_id: str, expires_minutes: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    minutes = settings.JWT_EXPIRE_MINUTES if expires_minutes is None else expires_minutes
    claims = {
        "sub": str(user_id),
        "sid": session_id,
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Raises jwt.PyJWTError if the token is invalid, tampered with or expired."""
    return jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options={"require": ["exp", "sub", "sid"]},
        # Tolerate small clock differences/steps (VM time sync, NTP corrections): without it a token issued a
        # moment ago can be rejected as "not yet valid" ("iat" is in the future) when the clock steps back.
        leeway=settings.JWT_LEEWAY_SECONDS,
    )


def generate_invite_code(length: int = 8) -> str:
    return "".join(secrets.choice(UNAMBIGUOUS_ALPHABET) for _ in range(length))


REGISTRATION_CODE_LENGTH = 10


def generate_registration_code() -> str:
    """10 characters from the unambiguous alphabet (no 0/O/1/I/L), from the OS CSPRNG. Shown as XXXXX-XXXXX."""
    return "".join(secrets.choice(UNAMBIGUOUS_ALPHABET) for _ in range(REGISTRATION_CODE_LENGTH))


def format_registration_code(code: str) -> str:
    return f"{code[:5]}-{code[5:]}"


def normalize_registration_code(raw: str) -> str | None:
    """What a student typed -> the canonical 10 characters, or None if it cannot possibly be a code.
    Case, hyphens and spaces are ignored (so 'abcde fghjk' and 'ABCDE-FGHJK' are the same code)."""
    code = re.sub(r"[\s-]", "", raw).upper()
    if len(code) != REGISTRATION_CODE_LENGTH or any(ch not in UNAMBIGUOUS_ALPHABET for ch in code):
        return None
    return code


def hash_registration_code(code: str) -> str:
    """SHA-256 hex digest of the canonical code. The plaintext is never stored."""
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def generate_temp_password(length: int = 10) -> str:
    return "".join(secrets.choice(UNAMBIGUOUS_ALPHABET) for _ in range(length))
