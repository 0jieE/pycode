from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime


class RegistrationCode(TimestampMixin, Base):
    """A one-time code an admin hands to a student so they can create their own account.

    Only the SHA-256 of the code is stored (the plaintext is shown once, when it is generated). The row is
    DELETED when the code is used, so every row in this table is an unused code."""

    __tablename__ = "registration_codes"
    __table_args__ = (
        Index("ix_registration_codes_batch_name", "batch_name"),
        Index("ix_registration_codes_expires_at", "expires_at"),
        TABLE_OPTS,
    )

    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)  # SHA-256 hex digest
    code_hint: Mapped[str] = mapped_column(String(4), nullable=False)  # last 4 characters, for display only
    batch_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # If set, the code only works for this student number.
    student_no: Mapped[Optional[str]] = mapped_column(String(32))
    # Prefilled for single codes: becomes the new account's full name.
    full_name: Mapped[Optional[str]] = mapped_column(String(150))
    expires_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
