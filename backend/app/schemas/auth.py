from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.registration import FULL_NAME_MAX, SELF_USERNAME_RE, _required_text
from app.schemas.user import PASSWORD_MAX, PASSWORD_MIN


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdate(BaseModel):
    """My own profile. Send only what changes. Unknown fields (role, student_no, is_active, ...) are a 422."""

    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(default=None, max_length=FULL_NAME_MAX * 2)  # an explicit null is rejected (type is str)
    username: str = Field(default=None, max_length=64)

    @field_validator("full_name")
    @classmethod
    def _full_name(cls, v: str) -> str:
        return _required_text(v, "full_name", FULL_NAME_MAX)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip().lower()  # same rule as sign-up; stored lowercase
        if not SELF_USERNAME_RE.match(v):
            raise ValueError("username must be 4-32 characters: lowercase letters, digits, '.' and '_'")
        return v


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX)
    new_password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
