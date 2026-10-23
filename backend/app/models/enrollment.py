import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Enum, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime
from app.models.user import enum_values


class EnrollmentStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REMOVED = "removed"


class Enrollment(TimestampMixin, Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("class_id", "student_id", name="uq_enrollments_class_student"),
        Index("ix_enrollments_class_status", "class_id", "status"),
        TABLE_OPTS,
    )

    class_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("classes.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    status: Mapped[EnrollmentStatus] = mapped_column(
        Enum(EnrollmentStatus, values_callable=enum_values),
        default=EnrollmentStatus.PENDING,
        server_default=EnrollmentStatus.PENDING.value,
        nullable=False,
    )
    invite_code_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("invite_codes.id"))
    reviewed_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id"))
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
