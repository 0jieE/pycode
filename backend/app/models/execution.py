import enum
from datetime import datetime
from typing import Optional

from typing import Any

from sqlalchemy import JSON, BigInteger, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, MediumText, TimestampMixin, UTCDateTime
from app.models.user import enum_values


class ExecutionStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout"
    MEMORY_EXCEEDED = "memory_exceeded"
    OUTPUT_LIMIT = "output_limit"
    SYSTEM_ERROR = "system_error"
    STOPPED = "stopped"                # the student pressed Stop (interactive run)
    INPUT_TIMEOUT = "input_timeout"    # an interactive run waited too long for the student to type


class ExecutionKind(str, enum.Enum):
    RUN = "run"      # a plain Run (lab or practice)
    TEST = "test"    # a student (or an instructor's "try") running the activity's test cases
    GRADE = "grade"  # automatic grading of a submission snapshot


class ExecutionMode(str, enum.Enum):
    INTERACTIVE = "interactive"  # the program pauses at input() and the student types live
    BATCH = "batch"              # all input is given up front (the old behaviour); tests and grading always use it


class Execution(TimestampMixin, Base):
    __tablename__ = "executions"
    __table_args__ = (
        Index("ix_executions_student_created", "student_id", "created_at"),
        Index("ix_executions_status", "status"),
        TABLE_OPTS,
    )

    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    # NULL only for an instructor's "try this test case" job, which has no workspace.
    workspace_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("workspaces.id"))
    activity_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("activities.id", ondelete="SET NULL")
    )
    lab_session_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("lab_sessions.id", ondelete="SET NULL")
    )
    entry_path: Mapped[str] = mapped_column(String(255), nullable=False)
    stdin: Mapped[Optional[str]] = mapped_column(Text)
    output: Mapped[Optional[str]] = mapped_column(MediumText)
    exit_code: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[ExecutionStatus] = mapped_column(
        Enum(ExecutionStatus, values_callable=enum_values),
        default=ExecutionStatus.QUEUED,
        server_default=ExecutionStatus.QUEUED.value,
        nullable=False,
    )
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    kind: Mapped[ExecutionKind] = mapped_column(
        Enum(ExecutionKind, values_callable=enum_values), default=ExecutionKind.RUN,
        server_default=ExecutionKind.RUN.value, nullable=False)
    mode: Mapped[ExecutionMode] = mapped_column(
        Enum(ExecutionMode, values_callable=enum_values), default=ExecutionMode.BATCH,
        server_default=ExecutionMode.BATCH.value, nullable=False)
    # A tutorial exercise check: whose tests to run and whose progress to record (NULL for everything else).
    tutorial_lesson_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("tutorial_lessons.id", ondelete="SET NULL"))
    # Per test case: case_id, passed, points_awarded, status, duration_ms, actual_output (<= 4 KB)
    test_results: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON)
    queued_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    started_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
