from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import InUTCDatetime, UTCDatetime


class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    starts_at: InUTCDatetime
    ends_at: InUTCDatetime
    lab_id: int                            # the room: no class without one (it is booked, see booking_service)


class SessionUpdate(BaseModel):
    """Send only what changes (e.g. a later ends_at to extend a running session)."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    starts_at: Optional[InUTCDatetime] = None
    ends_at: Optional[InUTCDatetime] = None
    lab_id: Optional[int] = None           # move the session to another lab (it cannot be left without one)

    @field_validator("lab_id")
    @classmethod
    def _keep_a_lab(cls, v: Optional[int]) -> int:
        if v is None:
            raise ValueError("a lab session needs a lab; choose another lab instead")
        return v


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_id: int
    name: str
    starts_at: UTCDatetime
    ends_at: UTCDatetime
    is_open: bool
    opened_at: Optional[UTCDatetime]
    closed_at: Optional[UTCDatetime]
    lab_id: Optional[int] = None           # null only when its lab was deleted after the session ended
