import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import InUTCDatetime, UTCDatetime
from app.schemas.user import PASSWORD_MAX, PASSWORD_MIN

# Self-registration is stricter than the admin-created accounts: 4-32 characters, lowercase letters, digits, . and _
SELF_USERNAME_RE = re.compile(r"^[a-z0-9._]{4,32}$")
STUDENT_NO_MAX = 32
FULL_NAME_MAX = 150


def _required_text(value: str, label: str, max_length: int) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{label} is required")
    if len(value) > max_length:
        raise ValueError(f"{label} must be at most {max_length} characters")
    return value


# ------------------------------------------------------------------ admin side

class RegistrationCodeCreate(BaseModel):
    count: int = Field(ge=1, le=200)
    batch_name: str = Field(min_length=1, max_length=100)
    expires_at: Optional[InUTCDatetime] = None
    student_no: Optional[str] = None  # bind the code to one student number (single codes only)
    full_name: Optional[str] = None  # prefilled name (single codes only)

    @field_validator("batch_name")
    @classmethod
    def _batch(cls, v: str) -> str:
        return _required_text(v, "batch_name", 100)

    @field_validator("student_no")
    @classmethod
    def _student_no(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _required_text(v, "student_no", STUDENT_NO_MAX)

    @field_validator("full_name")
    @classmethod
    def _full_name(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _required_text(v, "full_name", FULL_NAME_MAX)

    @model_validator(mode="after")
    def _single_only(self) -> "RegistrationCodeCreate":
        if self.count != 1 and (self.student_no is not None or self.full_name is not None):
            raise ValueError("student_no and full_name can only be set when count is 1")
        return self


class RegistrationCodesCreated(BaseModel):
    """The ONLY response that ever contains the codes. They cannot be retrieved again."""

    batch_name: str
    count: int
    expires_at: Optional[UTCDatetime]
    codes: list[str]  # shown as XXXXX-XXXXX


class RegistrationCodeOut(BaseModel):
    """An unused code, without the code itself."""

    id: int
    hint: str  # last 4 characters
    batch_name: str
    student_no: Optional[str]
    expires_at: Optional[UTCDatetime]
    created_at: UTCDatetime


class BatchOut(BaseModel):
    batch_name: str
    count: int


class RevokeResult(BaseModel):
    revoked: int


# ----------------------------------------------------------------- public side

class RegisterRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    student_no: str
    full_name: str
    username: str
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

    @field_validator("student_no")
    @classmethod
    def _student_no(cls, v: str) -> str:
        return _required_text(v, "student_no", STUDENT_NO_MAX)

    @field_validator("full_name")
    @classmethod
    def _full_name(cls, v: str) -> str:
        return _required_text(v, "full_name", FULL_NAME_MAX)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()  # stored lowercase, so "Maria.S" and "maria.s" are the same account
        if not SELF_USERNAME_RE.match(v):
            raise ValueError("username must be 4-32 characters: lowercase letters, digits, '.' and '_'")
        return v
