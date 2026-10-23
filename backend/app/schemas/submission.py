from typing import Optional

from pydantic import BaseModel

from app.models.submission import SubmissionStatus
from app.schemas.common import UTCDatetime
from app.schemas.enrollment import StudentBrief


class SubmissionOut(BaseModel):
    id: int
    activity_id: int
    student_id: int
    status: SubmissionStatus
    submitted_at: UTCDatetime
    file_count: int
    # Automatic grading (null until graded, and again after a resubmission)
    tests_passed: Optional[int] = None
    tests_total: Optional[int] = None
    score: Optional[int] = None
    max_score: Optional[int] = None
    graded_at: Optional[UTCDatetime] = None
    # For the instructor only (null for the student): the code holds a hidden case's expected output as a string.
    hardcode_suspected: Optional[bool] = None
    hardcode_tests: Optional[list[str]] = None


class MySubmissionOut(BaseModel):
    """One row of the student's own submission summary (one per activity)."""

    activity_id: int
    status: SubmissionStatus
    submitted_at: UTCDatetime


class SubmissionListItem(BaseModel):
    id: int
    student: StudentBrief
    status: SubmissionStatus
    submitted_at: UTCDatetime
    file_count: int
    tests_passed: Optional[int] = None
    tests_total: Optional[int] = None
    score: Optional[int] = None
    max_score: Optional[int] = None
    graded_at: Optional[UTCDatetime] = None
    hardcode_suspected: bool = False
    hardcode_tests: Optional[list[str]] = None


class SubmissionFileOut(BaseModel):
    path: str
    content: str


class SubmissionDetail(SubmissionOut):
    student: StudentBrief
    files: list[SubmissionFileOut]
