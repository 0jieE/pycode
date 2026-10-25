import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import Role
from app.schemas.common import UTCDatetime
from app.schemas.preferences import Preferences

USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
PASSWORD_MIN = 8
PASSWORD_MAX = 128


def validate_username(v: str) -> str:
    v = v.strip()
    if not USERNAME_RE.match(v):
        raise ValueError("username must be 3-64 characters: letters, digits, dot, underscore or dash")
    return v


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    student_no: Optional[str]
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: UTCDatetime



class MeOut(UserOut):
    """The signed-in user's own account: UserOut plus their preferences. Only the /auth endpoints return it, so an
    admin's user list never shows anyone's preferences."""

    preferences: Preferences


class UserCreate(BaseModel):
    username: str
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    full_name: str = Field(min_length=1, max_length=150)
    role: Role
    student_no: Optional[str] = Field(default=None, min_length=1, max_length=32)

    _check_username = field_validator("username")(validate_username)


class UserUpdate(BaseModel):
    """Role changes are not allowed after creation (would leave enrollments/classes dangling): `role` is accepted only
    to refuse it clearly (admin: 403 ADMIN_ROLE_RESERVED, another role: 400 ROLE_CHANGE_NOT_ALLOWED)."""

    role: Optional[Role] = None
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    student_no: Optional[str] = Field(default=None, min_length=1, max_length=32)
    is_active: Optional[bool] = None


class ResetPasswordRequest(BaseModel):
    # Omit to have the server generate a temporary password.
    new_password: Optional[str] = Field(default=None, min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class ResetPasswordResponse(BaseModel):
    temporary_password: str


class ImportRowError(BaseModel):
    row: int  # 1 = header row, so the first student is row 2 (matches a spreadsheet)
    username: Optional[str]
    detail: str


class ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[ImportRowError]


class UserCounts(BaseModel):
    """GET /users/counts: the accounts the admin manages (the administrator itself is not counted)."""

    instructors: int
    students: int


class MyNameUpdate(BaseModel):
    """PATCH /me: my own full name."""

    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=150)
