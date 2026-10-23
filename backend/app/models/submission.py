import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, Boolean, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, MediumText, TimestampMixin, UTCDateTime, utcnow
from app.models.user import enum_values


class SubmissionStatus(str, enum.Enum):
    SUBMITTED = "submitted"
    LATE = "late"


class Submission(TimestampMixin, Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("activity_id", "student_id", name="uq_submissions_activity_student"),
        TABLE_OPTS,
    )

    activity_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("activities.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus, values_callable=enum_values), nullable=False
    )
    # Automatic grading result; all NULL until the grading job has run (and again after a resubmission).
    tests_passed: Mapped[Optional[int]] = mapped_column(Integer)
    tests_total: Mapped[Optional[int]] = mapped_column(Integer)
    score: Mapped[Optional[int]] = mapped_column(Integer)
    max_score: Mapped[Optional[int]] = mapped_column(Integer)
    graded_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    # Set by grading: the code holds a hidden case's expected output as a string (a flag for the instructor only).
    hardcode_suspected: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    hardcode_tests: Mapped[Optional[list[str]]] = mapped_column(JSON)   # names of those hidden cases


class SubmissionFile(TimestampMixin, Base):
    """Frozen snapshot of one file in the activity folder at submit time."""

    __tablename__ = "submission_files"
    __table_args__ = (TABLE_OPTS,)

    submission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[Optional[str]] = mapped_column(MediumText)
