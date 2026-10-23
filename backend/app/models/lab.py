"""Computer labs (named rooms that lab sessions book) and the sign-in log of lab sessions."""
import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime
from app.models.user import enum_values


class LoginOutcome(str, enum.Enum):
    SUCCESS = "success"
    REPLACED_OTHER_SESSION = "replaced_other_session"  # signed the account out of the device it was signed in on


class Lab(TimestampMixin, Base):
    """A computer laboratory: a named room. A lab session books it from starts_at to ends_at (booking_service)."""

    __tablename__ = "labs"
    __table_args__ = (TABLE_OPTS,)

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)


class LoginEvent(Base):
    """Every sign-in, with the lab session the student was in (if one of their classes had a session open)."""

    __tablename__ = "login_events"
    __table_args__ = (
        Index("ix_login_events_session_created", "lab_session_id", "created_at"),
        Index("ix_login_events_user_created", "user_id", "created_at"),
        TABLE_OPTS,
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255))
    lab_session_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("lab_sessions.id", ondelete="SET NULL"))
    outcome: Mapped[LoginOutcome] = mapped_column(Enum(LoginOutcome, values_callable=enum_values), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
