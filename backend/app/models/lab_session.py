from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime


class LabSession(TimestampMixin, Base):
    __tablename__ = "lab_sessions"
    __table_args__ = (TABLE_OPTS,)

    class_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("classes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)          # e.g. "Week 3"
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    opened_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    closed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    # The room the session books (required by the API). NULL only when the lab was deleted after the session ended.
    lab_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("labs.id", ondelete="SET NULL"))
