from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin


class ActivityLog(TimestampMixin, Base):
    """Audit trail. user_id is nullable so a failed login for an unknown username can be logged."""

    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_user_created", "user_id", "created_at"),
        TABLE_OPTS,
    )

    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45))
