from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime


class InviteCode(TimestampMixin, Base):
    __tablename__ = "invite_codes"
    __table_args__ = (TABLE_OPTS,)

    class_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("classes.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False)
    valid_from: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    valid_until: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    max_uses: Mapped[Optional[int]] = mapped_column(Integer)
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
