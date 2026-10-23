from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.lab import LoginOutcome
from app.schemas.common import UTCDatetime
from app.schemas.enrollment import StudentBrief


# ------------------------------------------------------------------------------------------------ labs

class LabCreate(BaseModel):
    """POST /labs and PATCH /labs/{id}: a lab is just a named room."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


LabUpdate = LabCreate


class LabOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


# ----------------------------------------------------------------- the sign-in log of a session

class LoginOut(BaseModel):
    id: int
    at: UTCDatetime
    student: StudentBrief
    outcome: LoginOutcome


# ----------------------------------------------------------------- the lab's schedule (bookings)

class BookingClass(BaseModel):
    id: int
    name: str
    year_and_section: str


class BookingInstructor(BaseModel):
    id: int
    full_name: str


class LabBooking(BaseModel):
    """A session that books a lab. Also the `conflict` of a LAB_BOOKED / LAB_IN_USE refusal."""

    model_config = ConfigDict(populate_by_name=True)

    session_id: int
    name: str
    starts_at: UTCDatetime
    ends_at: UTCDatetime
    is_open: bool                  # running: open and before ends_at
    class_: BookingClass = Field(alias="class")
    instructor: BookingInstructor
    mine: bool                     # a session of the viewer's own class
