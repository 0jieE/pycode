"""The tutorial's request / response models. Two views of a lesson exist on purpose: what a STUDENT gets (sample
tests only, hidden tests as a name, no reference solution) and what staff who edit lessons get (everything)."""
import re
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.test_case import MatchMode
from app.schemas.activity import StarterFile
from app.schemas.common import UTCDatetime
from app.schemas.enrollment import StudentBrief

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_TESTS = 20
MAX_TEXT = 20 * 1024          # stdin / expected output of one test, like activity test cases
MAX_CODE = 100 * 1024         # a code file, like a workspace file
MAX_EXAMPLES = 10


def _slug(v: str) -> str:
    v = v.strip().lower()
    if not SLUG_RE.match(v) or len(v) > 60:
        raise ValueError("slug must be lowercase letters, digits and single hyphens (max 60)")
    return v


# ------------------------------------------------------------------------- the content

class ExampleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=150)
    code: str = Field(max_length=MAX_CODE)


class TestSpec(BaseModel):
    """One test of the exercise, like an activity's test case (same match modes and limits)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=150)
    stdin: str = Field(default="", max_length=MAX_TEXT)
    expected_output: str = Field(default="", max_length=MAX_TEXT)
    is_hidden: bool = False
    match_mode: MatchMode = MatchMode.TRIM
    points: int = Field(default=1, ge=0, le=1000)


class ExerciseSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=MAX_CODE)
    starter_code: str = Field(default="", max_length=MAX_CODE)        # the content of `entry`
    starter_files: list[StarterFile] = Field(default_factory=list, max_length=20)  # other files (multi-file lessons)
    entry: str = "main.py"
    ignore_input_prompts: bool = True
    tests: list[TestSpec] = Field(min_length=1, max_length=MAX_TESTS)
    reference_solution: str = Field(min_length=1, max_length=MAX_CODE)  # the content of `entry` that passes

    @field_validator("entry")
    @classmethod
    def _entry(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*\.py", v):
            raise ValueError("entry must be a .py file name")
        return v

    @field_validator("tests")
    @classmethod
    def _tests(cls, v: list[TestSpec]) -> list[TestSpec]:
        for t in v:
            if t.match_mode == MatchMode.CONTAINS and not t.expected_output.strip():
                raise ValueError(f"test '{t.name}': a 'contains' test needs some expected text")
        return v


# --------------------------------------------------------------------- student views

class ProgressOut(BaseModel):
    viewed_at: Optional[UTCDatetime]
    passed_at: Optional[UTCDatetime]
    attempts: int
    last_code: Optional[str] = None   # only in the lesson detail


class LessonListItem(BaseModel):
    slug: str
    title: str
    order: int
    summary: str
    passed: bool
    viewed: bool
    attempts: int
    locked: bool


class StudentTestSample(BaseModel):
    name: str
    is_hidden: Literal[False] = False
    stdin: str
    expected_output: str
    match_mode: MatchMode
    points: int


class StudentTestHidden(BaseModel):
    """Deliberately NO stdin / expected_output fields: they cannot leak."""

    name: str
    is_hidden: Literal[True] = True
    points: int


class StudentExercise(BaseModel):
    prompt: str
    starter_code: str
    starter_files: list[StarterFile]
    entry: str
    ignore_input_prompts: bool
    tests: list[StudentTestSample | StudentTestHidden]


class LessonDetail(BaseModel):
    slug: str
    title: str
    order: int
    summary: str
    body_md: str
    examples: list[ExampleSpec]
    exercise: StudentExercise
    progress: ProgressOut
    locked: bool


class CodeSave(BaseModel):
    code: str = Field(max_length=MAX_CODE)


class TutorialRunRequest(BaseModel):
    code: str = Field(max_length=MAX_CODE)
    stdin: str = Field(default="", max_length=10_000)
    mode: Literal["interactive", "batch"] = "interactive"


class CheckRequest(BaseModel):
    files: list[StarterFile] = Field(min_length=1, max_length=20)


# --------------------------------------------------------------------- staff views

class LessonFull(BaseModel):
    """Everything, for the people who edit lessons."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    title: str
    order: int
    summary: str
    body_md: str
    examples: list[ExampleSpec]
    exercise: ExerciseSpec
    is_hidden: bool
    has_default: bool = False   # a content/tutorial file exists for this slug ("Reset to default" is possible)
    updated_at: UTCDatetime


class LessonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str
    title: str = Field(min_length=1, max_length=150)
    summary: str = Field(default="", max_length=300)
    body_md: str = Field(min_length=1, max_length=MAX_CODE)
    examples: list[ExampleSpec] = Field(default_factory=list, max_length=MAX_EXAMPLES)
    exercise: ExerciseSpec
    is_hidden: bool = False

    _slug = field_validator("slug")(_slug)


class LessonUpdate(BaseModel):
    """Send only what changes."""

    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = Field(default=None, min_length=1, max_length=150)
    summary: Optional[str] = Field(default=None, max_length=300)
    body_md: Optional[str] = Field(default=None, min_length=1, max_length=MAX_CODE)
    examples: Optional[list[ExampleSpec]] = Field(default=None, max_length=MAX_EXAMPLES)
    exercise: Optional[ExerciseSpec] = None
    is_hidden: Optional[bool] = None


class LessonOrder(BaseModel):
    order: list[str] = Field(min_length=1, max_length=200)   # every slug, in the wanted order


class SeedResult(BaseModel):
    created: list[str]
    updated: list[str]


# ------------------------------------------------------------ the instructor's matrix

class ProgressCell(BaseModel):
    passed_at: Optional[UTCDatetime]
    attempts: int
    last_activity: Optional[UTCDatetime]


class StudentRow(BaseModel):
    student: StudentBrief
    lessons: dict[str, ProgressCell]   # by slug; a lesson never opened is missing
    passed_count: int


class LessonHeader(BaseModel):
    slug: str
    title: str
    order: int


class TutorialMatrix(BaseModel):
    class_id: int
    unlock_in_order: bool
    lessons: list[LessonHeader]
    students: list[StudentRow]
    generated_at: datetime
