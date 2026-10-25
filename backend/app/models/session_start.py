from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, UTCDateTime


class SessionStart(Base):
    """When a student started working in a lab session: their first class-workspace access (the file tree, or a
    file opened) while the session was open. Written once; later loads never change it."""

    __tablename__ = "session_starts"
    __table_args__ = (UniqueConstraint("lab_session_id", "student_id", name="uq_session_starts"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lab_session_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lab_sessions.id", ondelete="CASCADE", name="fk_session_starts_session"),
        nullable=False)
    student_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE", name="fk_session_starts_student"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    # The first activity whose folder they opened a file in during the session (NULL until they do).
    first_activity_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("activities.id", ondelete="SET NULL", name="fk_session_starts_activity"))


class SessionActivityStart(Base):
    """When a student first opened a file inside an activity's folder during a lab session."""

    __tablename__ = "session_activity_starts"
    __table_args__ = (UniqueConstraint("lab_session_id", "student_id", "activity_id",
                                       name="uq_session_activity_starts"), TABLE_OPTS)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lab_session_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lab_sessions.id", ondelete="CASCADE", name="fk_activity_starts_session"),
        nullable=False)
    student_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE", name="fk_activity_starts_student"), nullable=False)
    activity_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("activities.id", ondelete="CASCADE", name="fk_activity_starts_activity"),
        nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
