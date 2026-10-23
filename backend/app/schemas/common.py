from datetime import datetime, timezone
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, PlainSerializer

T = TypeVar("T")


def _to_utc_iso(value: datetime) -> str:
    """DB datetimes are naive UTC; the API must say so ('Z'), or browsers read them as local time."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# Use for every datetime in a response schema.
UTCDatetime = Annotated[datetime, PlainSerializer(_to_utc_iso, return_type=str, when_used="json")]


def _to_naive_utc(value: datetime) -> datetime:
    """Request datetimes: timezone-aware values are converted to UTC; naive values are taken as UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


# Use for every datetime in a request schema (matches what the database stores).
InUTCDatetime = Annotated[datetime, AfterValidator(_to_naive_utc)]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    size: int
