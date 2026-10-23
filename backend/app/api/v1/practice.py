"""A personal Practice workspace for every student AND every instructor: not tied to any class, never locked by lab
sessions, never submitted, private to its owner (an instructor never sees a student's, and vice versa). Mirrors the
class workspace endpoints (same rules, extensions and quotas)."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.execution import RunRequest, RunResponse
from app.schemas.workspace import (
    CreateEntryRequest,
    FileMeta,
    FileOut,
    RenameRequest,
    SaveFileRequest,
    TreeOut,
    VersionMeta,
    VersionOut,
)
from app.services import execution_service, workspace_service

router = APIRouter(prefix="/practice", tags=["practice"])
practice_user = require_role(Role.STUDENT, Role.INSTRUCTOR)


@router.get("/tree", response_model=TreeOut)
def tree(user: User = Depends(practice_user), db: Session = Depends(get_db)) -> TreeOut:
    """Paths + metadata + quota usage. The workspace is created on first access."""
    return workspace_service.get_practice_tree(db, user)


@router.post("/files", response_model=FileOut, status_code=201)
def create_entry(body: CreateEntryRequest, user: User = Depends(practice_user),
                 db: Session = Depends(get_db)) -> FileOut:
    return workspace_service.create_practice_entry(db, user, body)


@router.get("/files/{file_id}", response_model=FileOut)
def get_file(file_id: int, user: User = Depends(practice_user), db: Session = Depends(get_db)) -> FileOut:
    return workspace_service.get_file(db, user, file_id, practice=True)


@router.put("/files/{file_id}", response_model=FileMeta)
def save_file(file_id: int, body: SaveFileRequest, version: bool = False,
              user: User = Depends(practice_user), db: Session = Depends(get_db)) -> FileMeta:
    return workspace_service.save_file(db, user, file_id, body, make_version=version, practice=True)


@router.patch("/files/{file_id}", response_model=FileMeta)
def rename_entry(file_id: int, body: RenameRequest, user: User = Depends(practice_user),
                 db: Session = Depends(get_db)) -> FileMeta:
    return workspace_service.rename_entry(db, user, file_id, body.new_path, practice=True)


@router.delete("/files/{file_id}", status_code=204)
def delete_entry(file_id: int, user: User = Depends(practice_user), db: Session = Depends(get_db)) -> Response:
    workspace_service.delete_entry(db, user, file_id, practice=True)
    return Response(status_code=204)


@router.get("/files/{file_id}/versions", response_model=Page[VersionMeta])
def list_versions(file_id: int, params: PageParams = Depends(pagination), user: User = Depends(practice_user),
                  db: Session = Depends(get_db)) -> Page[VersionMeta]:
    items, total = workspace_service.list_versions(db, user, file_id, params.offset, params.size, practice=True)
    return Page[VersionMeta](items=items, total=total, page=params.page, size=params.size)


@router.get("/versions/{version_id}", response_model=VersionOut)
def get_version(version_id: int, user: User = Depends(practice_user), db: Session = Depends(get_db)) -> VersionOut:
    return workspace_service.get_version(db, user, version_id, practice=True)


@router.post("/run", response_model=RunResponse, status_code=202)
def run(body: RunRequest, request: Request, user: User = Depends(practice_user),
        db: Session = Depends(get_db)) -> RunResponse:
    """Queue a run of a Practice file. Poll GET /executions/{id} or stream /ws/run/{id}, as for lab runs."""
    return execution_service.start_practice_run(db, user, body, client_ip(request))
