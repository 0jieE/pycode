from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from app.models.enrollment import EnrollmentStatus
from app.schemas.common import UTCDatetime


class EnrollRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class EnrollResponse(BaseModel):
    enrollment_id: int
    class_id: int
    class_name: str
    status: EnrollmentStatus


class StudentBrief(BaseModel):
    id: int
    username: str
    full_name: str
    student_no: Optional[str]


class EnrollmentOut(BaseModel):
    id: int
    class_id: int
    status: EnrollmentStatus
    student: StudentBrief
    requested_at: UTCDatetime
    reviewed_by: Optional[int]
    reviewed_at: Optional[UTCDatetime]


class EnrollmentAction(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    REMOVE = "remove"


class EnrollmentReview(BaseModel):
    action: EnrollmentAction


class MyClassOut(BaseModel):
    enrollment_id: int
    status: EnrollmentStatus
    class_id: int
    class_name: str
    year_and_section: str
    school_year: str
    instructor_name: str
    is_archived: bool
    lab_open: bool  # is a lab session open right now
