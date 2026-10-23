"""Workspace storage limits: per role (student, instructor), and optionally per user. All sizes are in bytes."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import UTCDatetime

# What an admin may set. The upper bounds keep a workspace inside the sandbox: every Run copies the whole workspace
# into the container's /workspace, a 10 MB tmpfs that the program also writes to.
MIN_FILE_BYTES, MAX_FILE_BYTES = 1024, 1024 * 1024                        # 1 KB .. 1 MB per file
MIN_WORKSPACE_BYTES, MAX_WORKSPACE_BYTES = 10 * 1024, 8 * 1024 * 1024     # 10 KB .. 8 MB per workspace
MIN_FILES, MAX_FILES = 1, 500                                             # files per workspace


class Limits(BaseModel):
    max_file_bytes: int
    max_workspace_bytes: int
    max_files: int


class Bound(BaseModel):
    min: int
    max: int


class Bounds(BaseModel):
    max_file_bytes: Bound
    max_workspace_bytes: Bound
    max_files: Bound


BOUNDS = Bounds(max_file_bytes=Bound(min=MIN_FILE_BYTES, max=MAX_FILE_BYTES),
                max_workspace_bytes=Bound(min=MIN_WORKSPACE_BYTES, max=MAX_WORKSPACE_BYTES),
                max_files=Bound(min=MIN_FILES, max=MAX_FILES))


class RoleLimits(Limits):
    updated_at: Optional[UTCDatetime] = None    # null = never changed (the built-in defaults)
    updated_by: Optional[int] = None


class StorageLimitsOut(BaseModel):
    """GET /storage-limits: each role's limits and what may be set."""

    student: RoleLimits
    instructor: RoleLimits
    bounds: Bounds


class LimitsUpdate(BaseModel):
    """PATCH /storage-limits/{role}: send only what changes."""

    model_config = ConfigDict(extra="forbid")

    max_file_bytes: Optional[int] = Field(default=None, ge=MIN_FILE_BYTES, le=MAX_FILE_BYTES)
    max_workspace_bytes: Optional[int] = Field(default=None, ge=MIN_WORKSPACE_BYTES, le=MAX_WORKSPACE_BYTES)
    max_files: Optional[int] = Field(default=None, ge=MIN_FILES, le=MAX_FILES)

    @field_validator("max_file_bytes", "max_workspace_bytes", "max_files")
    @classmethod
    def _not_null(cls, v: Optional[int]) -> int:
        if v is None:
            raise ValueError("a role always has a limit; leave the field out to keep it")
        return v


class LimitsOverride(BaseModel):
    """PUT /users/{id}/storage: this user's own limits. null (or left out) = the role's limit for that field."""

    model_config = ConfigDict(extra="forbid")

    max_file_bytes: Optional[int] = Field(default=None, ge=MIN_FILE_BYTES, le=MAX_FILE_BYTES)
    max_workspace_bytes: Optional[int] = Field(default=None, ge=MIN_WORKSPACE_BYTES, le=MAX_WORKSPACE_BYTES)
    max_files: Optional[int] = Field(default=None, ge=MIN_FILES, le=MAX_FILES)


class WorkspaceUsage(BaseModel):
    workspace_id: int
    class_id: Optional[int]          # null = the Practice workspace
    class_name: Optional[str]
    files: int
    bytes: int


class ClearResult(BaseModel):
    """POST /users/{id}/workspaces/{workspace_id}/clear."""

    workspace_id: int
    class_id: Optional[int]             # null = the Practice workspace
    files_deleted: int
    bytes_deleted: int
    starter_files_restored: int         # the published activities' starter files, put back fresh


class UserStorageOut(BaseModel):
    """GET/PUT /users/{id}/storage: the role's limits, this user's own (null = the role's), what applies, and how
    much each of their workspaces uses."""

    user_id: int
    role: str
    role_limits: Limits
    override: LimitsOverride
    effective: Limits
    workspaces: list[WorkspaceUsage]
