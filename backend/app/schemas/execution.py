from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.models.execution import ExecutionKind, ExecutionMode, ExecutionStatus
from app.schemas.common import UTCDatetime


class RunRequest(BaseModel):
    entry_path: str  # validated by workspace_service.normalize_file_path
    # The executions.stdin column is TEXT (65,535 bytes); 10,000 characters is at most 40 KB even in UTF-8.
    stdin: str = Field(default="", max_length=10_000)
    # "interactive": the program pauses at input() and the student types the value live (over /ws/run/{id}); `stdin`
    # is ignored. "batch": all input is given up front in `stdin`, as before. Test cases and grading are always batch.
    mode: Literal["interactive", "batch"] = "interactive"


class RunResponse(BaseModel):
    execution_id: int
    queue_position: int  # 1 = next to run


class TestSummary(BaseModel):
    __test__ = False

    passed: int
    total: int
    score: int
    max_score: int


class ExecutionOut(BaseModel):
    id: int
    class_id: Optional[int]  # null for a Practice run
    practice: bool
    kind: ExecutionKind = ExecutionKind.RUN
    mode: ExecutionMode = ExecutionMode.BATCH
    # What was typed (interactive) or given up front (batch), one line per input: "Run again with the same inputs".
    stdin: Optional[str] = None
    activity_id: Optional[int] = None
    tutorial_lesson_id: Optional[int] = None  # a tutorial exercise check
    # kind "test"/"grade": one entry per test case (case_id, name, is_hidden, passed, points_awarded, status,
    # duration_ms, actual_output). For a student, actual_output of a hidden case is always null.
    test_results: Optional[list[dict[str, Any]]] = None
    test_summary: Optional[TestSummary] = None
    entry_path: str
    status: ExecutionStatus
    exit_code: Optional[int]
    output: Optional[str]
    duration_ms: Optional[int]
    queued_at: Optional[UTCDatetime]
    started_at: Optional[UTCDatetime]
    finished_at: Optional[UTCDatetime]
