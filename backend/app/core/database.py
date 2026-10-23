from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, create_engine, text
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.types import Text

from app.core.config import settings

# DATETIME(6): microsecond precision, needed for the optimistic-lock check on file saves.
UTCDateTime = DateTime().with_variant(mysql.DATETIME(fsp=6), "mysql")
# MEDIUMTEXT (16 MB) on MySQL; plain TEXT elsewhere.
MediumText = Text().with_variant(mysql.MEDIUMTEXT(), "mysql")

TABLE_OPTS = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_unicode_ci",
}


def utcnow() -> datetime:
    """Naive UTC datetime — every DATETIME column in the database is UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """id + created_at + updated_at, present on every table."""

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, server_default=text("CURRENT_TIMESTAMP(6)"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=utcnow,
        onupdate=utcnow,
        server_default=text("CURRENT_TIMESTAMP(6)"),
        nullable=False,
    )


engine = create_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    pool_recycle=1800,
    # Each statement sees the latest committed data (no stale per-transaction snapshot). Write paths that
    # must be serialised take an explicit row lock (SELECT ... FOR UPDATE) instead.
    isolation_level="READ COMMITTED",
    connect_args={"init_command": "SET time_zone = '+00:00'"},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
