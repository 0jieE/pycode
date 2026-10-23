from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, BigInteger, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin, UTCDateTime


class Activity(TimestampMixin, Base):
    __tablename__ = "activities"
    __table_args__ = (TABLE_OPTS,)

    class_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("classes.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    instructions: Mapped[Optional[str]] = mapped_column(Text)
    # list of {"path": str, "content": str}
    starter_files: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON)
    due_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # Archived (published activities only): gone from students' view, its folder read-only in their workspaces;
    # submissions and grades are kept and the instructor still sees everything.
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # Automatic grading: the program inside the activity folder that is run for every test case ...
    entry_file: Mapped[str] = mapped_column(String(255), default="main.py", server_default="main.py", nullable=False)
    # ... and whether the text passed to input() is left out of the output being compared.
    ignore_input_prompts: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    # Code requirements checked before the tests run (schemas.activity.Requirements); NULL = none.
    requirements: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON)
