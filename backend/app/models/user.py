import enum
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin


class Role(str, enum.Enum):
    ADMIN = "admin"
    INSTRUCTOR = "instructor"
    STUDENT = "student"


def enum_values(e: type[enum.Enum]) -> list[str]:
    return [m.value for m in e]


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (TABLE_OPTS,)

    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    student_no: Mapped[Optional[str]] = mapped_column(String(32), unique=True)
    role: Mapped[Role] = mapped_column(Enum(Role, values_callable=enum_values), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    # True after an admin reset or a CSV import gave this account a temporary password: until the user changes it,
    # only /auth/me, /auth/change-password and /auth/logout work.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # The user's own settings (theme, ...). NULL or partial = defaults; see app/schemas/preferences.py.
    preferences: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)
    # This user's own workspace storage limits (bytes, bytes, count); NULL = the role's (storage_limits).
    storage_max_file_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    storage_max_workspace_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    storage_max_files: Mapped[Optional[int]] = mapped_column(Integer)
    # Random id of the latest login; a token carrying an older id is rejected (single device).
    current_session_id: Mapped[Optional[str]] = mapped_column(String(64))
