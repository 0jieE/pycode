from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.test_case import MatchMode
from app.schemas.activity import StarterFile

# NB: classes are not called Test*, so pytest never mistakes them for test classes.


class CaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    stdin: str = ""  # sizes are checked in bytes by the service (20 KB each)
    expected_output: str = ""
    is_hidden: bool = False
    points: int = Field(default=1, ge=0, le=100_000)
    match_mode: MatchMode = MatchMode.TRIM
    require_input_read: bool = True   # with stdin: pass only if the program read all of it

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class CaseUpdate(BaseModel):
    """Send only what changes."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    stdin: Optional[str] = None
    expected_output: Optional[str] = None
    is_hidden: Optional[bool] = None
    points: Optional[int] = Field(default=None, ge=0, le=100_000)
    match_mode: Optional[MatchMode] = None
    require_input_read: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class CaseOrder(BaseModel):
    order: list[int] = Field(min_length=1, max_length=20)  # every case id of the activity, in the wanted order


class CaseOut(BaseModel):
    """What the instructor sees: everything."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    activity_id: int
    name: str
    stdin: Optional[str]
    expected_output: Optional[str]
    is_hidden: bool
    points: int
    match_mode: MatchMode
    sort_order: int
    require_input_read: bool


class StudentCaseSample(BaseModel):
    """A visible case: the student may see the input and the expected output."""

    id: int
    name: str
    points: int
    is_hidden: Literal[False] = False
    stdin: str
    expected_output: str
    match_mode: MatchMode


class StudentCaseHidden(BaseModel):
    """A hidden case. There are deliberately NO stdin / expected_output fields here, so they cannot leak."""

    id: int
    name: str
    points: int
    is_hidden: Literal[True] = True


StudentCase = Annotated[Union[StudentCaseSample, StudentCaseHidden], Field(discriminator="is_hidden")]


class TryRequest(BaseModel):
    files: Optional[list[StarterFile]] = None  # default: the activity's starter files


class TestJobRequest(BaseModel):
    __test__ = False

    activity_id: int
    entry_path: str


class RegradeResult(BaseModel):
    queued: int
    skipped: int  # submissions that already have a grading job waiting or running
