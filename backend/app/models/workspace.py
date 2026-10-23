from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, MediumText, TimestampMixin, UTCDateTime, utcnow


class Workspace(TimestampMixin, Base):
    """A student's files. class_id is NULL for the student's personal Practice workspace (not tied to any class).

    MySQL allows many NULLs in a unique key, so uniqueness of (student_id, class_id) does NOT cover practice
    workspaces: workspace_service.ensure_practice_workspace guarantees one per student."""

    __tablename__ = "workspaces"
    __table_args__ = (
        UniqueConstraint("student_id", "class_id", name="uq_workspaces_student_class"),
        TABLE_OPTS,
    )

    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    class_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("classes.id"), nullable=True)


class WorkspaceFile(TimestampMixin, Base):
    __tablename__ = "workspace_files"
    # UNIQUE(workspace_id, path) doubles as the required (workspace_id, path) lookup index.
    __table_args__ = (
        UniqueConstraint("workspace_id", "path", name="uq_workspace_files_workspace_path"),
        TABLE_OPTS,
    )

    workspace_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    is_folder: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    content: Mapped[Optional[str]] = mapped_column(MediumText)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class FileVersion(TimestampMixin, Base):
    """Manual-save history. Only the last 20 per file are kept (pruned by the service)."""

    __tablename__ = "file_versions"
    __table_args__ = (TABLE_OPTS,)

    file_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("workspace_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[Optional[str]] = mapped_column(MediumText)
    saved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
