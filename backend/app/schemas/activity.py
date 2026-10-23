import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import InUTCDatetime, UTCDatetime


class StarterFile(BaseModel):
    path: str = Field(min_length=1, max_length=255)  # relative to the activity folder
    content: str = ""


class ActivityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    instructions: Optional[str] = Field(default=None, max_length=20000)
    starter_files: list[StarterFile] = Field(default_factory=list)
    due_at: Optional[InUTCDatetime] = None
    entry_file: str = Field(default="main.py", min_length=1, max_length=255)  # graded program, inside the folder
    ignore_input_prompts: bool = True  # leave the text given to input() out of the output being compared


class ActivityUpdate(BaseModel):
    """Send only what changes. `instructions: null` / `due_at: null` clear the value.
    title and starter_files can only change before the activity is published."""

    title: Optional[str] = Field(default=None, min_length=1, max_length=150)
    instructions: Optional[str] = Field(default=None, max_length=20000)
    starter_files: Optional[list[StarterFile]] = None
    due_at: Optional[InUTCDatetime] = None
    entry_file: Optional[str] = Field(default=None, min_length=1, max_length=255)
    is_archived: Optional[bool] = None  # published activities only
    ignore_input_prompts: Optional[bool] = None


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_CALL = re.compile(r"^\.?[A-Za-z_][A-Za-z0-9_]*$")
_MODULE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")


def _clean(values: list[str], pattern: re.Pattern, what: str) -> list[str]:
    out: list[str] = []
    for value in values:
        value = value.strip()
        if not pattern.match(value):
            raise ValueError(f"not a valid {what}: {value!r}")
        if value not in out:
            out.append(value)
    return out


class Requirements(BaseModel):
    """Code requirements of an activity, checked (with ast) on the activity folder before its tests run. Any
    violation fails every test with status "requirement_failed". Empty lists = no requirement of that kind."""

    model_config = ConfigDict(extra="forbid")

    must_define_functions: list[str] = Field(default_factory=list, max_length=20)   # e.g. ["average"]
    must_use: list[Literal["for", "while", "if", "def", "class"]] = Field(default_factory=list, max_length=5)
    must_not_use_calls: list[str] = Field(default_factory=list, max_length=20)      # ".index" (method), "sorted"
    must_not_use_imports: list[str] = Field(default_factory=list, max_length=20)    # "statistics", "math"

    @field_validator("must_define_functions")
    @classmethod
    def _functions(cls, v: list[str]) -> list[str]:
        return _clean(v, _IDENTIFIER, "function name")

    @field_validator("must_use")
    @classmethod
    def _keywords(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))

    @field_validator("must_not_use_calls")
    @classmethod
    def _calls(cls, v: list[str]) -> list[str]:
        return _clean(v, _CALL, "call (name or .method)")

    @field_validator("must_not_use_imports")
    @classmethod
    def _imports(cls, v: list[str]) -> list[str]:
        return _clean(v, _MODULE, "module name")

    def is_empty(self) -> bool:
        return not (self.must_define_functions or self.must_use or self.must_not_use_calls
                    or self.must_not_use_imports)


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    class_id: int
    title: str
    instructions: Optional[str]
    starter_files: list[StarterFile]
    due_at: Optional[UTCDatetime]
    is_published: bool
    is_archived: bool = False
    entry_file: str
    ignore_input_prompts: bool
    requirements: Optional[Requirements] = None     # null = none (students see them too: they are instructions)
    created_at: UTCDatetime
