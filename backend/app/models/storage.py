from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Enum, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, UTCDateTime
from app.models.user import Role, enum_values


class StorageLimit(Base):
    """The workspace storage limits of a role (student, instructor), set by an admin. They apply to EACH workspace of
    a user (every class workspace and the Practice workspace); a user can have their own (users.storage_*). No row =
    the built-in defaults (app.services.storage_service.DEFAULTS)."""

    __tablename__ = "storage_limits"
    __table_args__ = (TABLE_OPTS,)

    role: Mapped[Role] = mapped_column(Enum(Role, values_callable=enum_values), primary_key=True)
    max_file_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    max_workspace_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    max_files: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    updated_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL",
                                                                              name="fk_storage_limits_updated_by"))
