from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import InUTCDatetime, UTCDatetime


class ClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    year_and_section: str = Field(min_length=1, max_length=50)
    school_year: str = Field(min_length=1, max_length=20)


class ClassUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    year_and_section: Optional[str] = Field(default=None, min_length=1, max_length=50)
    school_year: Optional[str] = Field(default=None, min_length=1, max_length=20)
    is_archived: Optional[bool] = None
    tutorial_unlock_in_order: Optional[bool] = None


class ClassOut(BaseModel):
    id: int
    instructor_id: int
    name: str
    year_and_section: str
    school_year: str
    is_archived: bool
    tutorial_unlock_in_order: bool = False
    created_at: UTCDatetime
    approved_count: int
    pending_count: int


class InviteCodeCreate(BaseModel):
    valid_from: Optional[InUTCDatetime] = None  # defaults to now
    valid_until: InUTCDatetime
    max_uses: Optional[int] = Field(default=None, ge=1)


class InviteCodeUpdate(BaseModel):
    """Only send what changes. `max_uses: null` removes the limit."""

    is_active: Optional[bool] = None
    valid_from: Optional[InUTCDatetime] = None
    valid_until: Optional[InUTCDatetime] = None
    max_uses: Optional[int] = Field(default=None, ge=1)


class InviteCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_id: int
    code: str
    valid_from: UTCDatetime
    valid_until: UTCDatetime
    is_active: bool
    max_uses: Optional[int]
    use_count: int
