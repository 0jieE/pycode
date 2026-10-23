from typing import Optional

from pydantic import BaseModel

from app.models.execution import ExecutionStatus
from app.schemas.common import UTCDatetime
from app.schemas.enrollment import StudentBrief


class LastRun(BaseModel):
    execution_id: int
    entry_path: str
    status: ExecutionStatus
    duration_ms: Optional[int]
    queued_at: Optional[UTCDatetime]
    finished_at: Optional[UTCDatetime]


class LastTest(BaseModel):
    """The student's most recent finished Test (the "Test" button) in this lab session."""

    execution_id: int
    activity_id: Optional[int]
    passed: int
    total: int
    score: int
    max_score: int
    finished_at: Optional[UTCDatetime]


class StudentMonitor(BaseModel):
    student: StudentBrief
    online: bool
    last_run: Optional[LastRun]  # most recent plain Run during this lab session (a Test is last_test, not a run)
    last_test: Optional[LastTest]  # most recent finished Test during this lab session; null if none
    last_save: Optional[UTCDatetime]  # last time the student saved a file (starter files don't count)
    submitted: bool  # has submitted something since the session started
    last_submitted_at: Optional[UTCDatetime]


class MonitorSnapshot(BaseModel):
    session_id: int
    class_id: int
    is_open: bool
    generated_at: UTCDatetime
    online_count: int
    students: list[StudentMonitor]
