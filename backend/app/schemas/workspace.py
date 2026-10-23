from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.common import InUTCDatetime, UTCDatetime


class FileMeta(BaseModel):
    """Everything about a file except its content (what the tree and save responses carry)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    path: str
    is_folder: bool
    size_bytes: int
    updated_at: UTCDatetime  # echo this exactly as `last_updated_at` when saving
    # A starter file of an activity, the activity's folder, or a folder holding starter files: it can be edited
    # (files) but not deleted, renamed or moved.
    protected: bool = False
    # Why this entry cannot be changed right now (its activity is past due or archived), or null.
    read_only_reason: Optional[str] = None


class FileOut(FileMeta):
    content: Optional[str]  # null for folders


class Usage(BaseModel):
    files: int
    folders: int
    bytes: int
    max_files: int
    max_folders: int
    max_bytes: int
    max_file_bytes: int


class TreeOut(BaseModel):
    workspace_id: int
    class_id: Optional[int]  # null for the personal Practice workspace
    entries: list[FileMeta]  # paths and metadata only, never content
    usage: Usage


class CreateEntryRequest(BaseModel):
    path: str  # validated by workspace_service.normalize_path (so errors use the INVALID_PATH code)
    is_folder: bool = False
    content: str = ""


class SaveFileRequest(BaseModel):
    content: str
    last_updated_at: InUTCDatetime


class RenameRequest(BaseModel):
    new_path: str


class VersionMeta(BaseModel):
    id: int
    file_id: int
    saved_at: UTCDatetime
    size_bytes: int


class VersionOut(VersionMeta):
    content: Optional[str]
