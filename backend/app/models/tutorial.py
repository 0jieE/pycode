"""The built-in Python tutorial: lessons (loaded from content/tutorial/*.md, editable afterwards) and each student's
progress through them."""
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, MediumText, TimestampMixin, UTCDateTime


class TutorialLesson(TimestampMixin, Base):
    __tablename__ = "tutorial_lessons"
    __table_args__ = (TABLE_OPTS,)

    slug: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    summary: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    body_md: Mapped[str] = mapped_column(MediumText, nullable=False)
    # [{"title", "code"}]: runnable snippets shown in the lesson
    examples: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    # {prompt, starter_code, starter_files, entry, ignore_input_prompts, tests, reference_solution}
    # (app/schemas/tutorial.py: ExerciseSpec). reference_solution and hidden tests NEVER reach students.
    exercise: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)


class TutorialProgress(TimestampMixin, Base):
    __tablename__ = "tutorial_progress"
    __table_args__ = (UniqueConstraint("student_id", "lesson_id", name="uq_tutorial_progress"), TABLE_OPTS)

    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    lesson_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tutorial_lessons.id", ondelete="CASCADE"),
                                           nullable=False)
    viewed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    passed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)   # first time every test passed
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")  # checks run
    last_code: Mapped[Optional[str]] = mapped_column(MediumText)          # autosaved editor content
