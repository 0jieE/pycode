from sqlalchemy import BigInteger, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import TABLE_OPTS, Base, TimestampMixin


class Classroom(TimestampMixin, Base):
    __tablename__ = "classes"
    __table_args__ = (TABLE_OPTS,)

    instructor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    year_and_section: Mapped[str] = mapped_column(String(50), nullable=False)
    school_year: Mapped[str] = mapped_column(String(20), nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    # Tutorial lessons open one after the other for this class's students (a lesson needs the previous one passed).
    tutorial_unlock_in_order: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
