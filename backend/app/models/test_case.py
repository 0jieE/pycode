import enum
from typing import Optional

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin
from app.models.user import enum_values


class MatchMode(str, enum.Enum):
    TRIM = "trim"                # ignore \r\n vs \n, trailing spaces on each line, and trailing blank lines
    EXACT = "exact"              # byte for byte
    IGNORE_CASE = "ignore_case"  # trim + case-insensitive
    CONTAINS = "contains"        # trim, then the expected text must appear somewhere in the output


class TestCase(TimestampMixin, Base):
    """One automatic check of an activity: run the student's program with `stdin` and compare its output."""

    __test__ = False  # not a pytest test class, despite the name
    __tablename__ = "test_cases"
    __table_args__ = (
        Index("ix_test_cases_activity_sort", "activity_id", "sort_order"),
        CheckConstraint("points >= 0", name="ck_test_cases_points_nonneg"),
        TABLE_OPTS,
    )

    activity_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    stdin: Mapped[Optional[str]] = mapped_column(Text)
    # Never sent to the sandbox and never shown to students for hidden cases.
    expected_output: Mapped[Optional[str]] = mapped_column(Text)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    points: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    match_mode: Mapped[MatchMode] = mapped_column(
        Enum(MatchMode, values_callable=enum_values), default=MatchMode.TRIM,
        server_default=MatchMode.TRIM.value, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # With stdin: the case passes only if the program read every input line (no hardcoded answers).
    require_input_read: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
