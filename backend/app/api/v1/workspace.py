from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, get_db, pagination, require_role
from app.models.user import Role, User
from app.schemas.common import Page
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
from app.services import workspace_service

router = APIRouter(tags=["workspace"])
student_only = require_role(Role.STUDENT)
instructor_only = require_role(Role.INSTRUCTOR)


# ------------------------------------------------------------------ student

@router.get("/workspace/{class_id}/tree", response_model=TreeOut)
def tree(class_id: int, user: User = Depends(student_only), db: Session = Depends(get_db)) -> TreeOut:
    return workspace_service.get_tree(db, user, class_id)


@router.get("/workspace/files/{file_id}", response_model=FileOut)
def get_file(file_id: int, user: User = Depends(student_only), db: Session = Depends(get_db)) -> FileOut:
    return workspace_service.get_file(db, user, file_id)


@router.post("/workspace/{class_id}/files", response_model=FileOut, status_code=201)
def create_entry(class_id: int, body: CreateEntryRequest, user: User = Depends(student_only),
                 db: Session = Depends(get_db)) -> FileOut:
    return workspace_service.create_entry(db, user, class_id, body)


@router.put("/workspace/files/{file_id}", response_model=FileMeta)
def save_file(file_id: int, body: SaveFileRequest, version: bool = False,
              user: User = Depends(student_only), db: Session = Depends(get_db)) -> FileMeta:
    """Autosave sends no `version`; a manual save sends `?version=true` and also keeps a history entry."""
    return workspace_service.save_file(db, user, file_id, body, make_version=version)


@router.patch("/workspace/files/{file_id}", response_model=FileMeta)
def rename_entry(file_id: int, body: RenameRequest, user: User = Depends(student_only),
                 db: Session = Depends(get_db)) -> FileMeta:
    return workspace_service.rename_entry(db, user, file_id, body.new_path)


@router.delete("/workspace/files/{file_id}", status_code=204)
def delete_entry(file_id: int, user: User = Depends(student_only), db: Session = Depends(get_db)) -> Response:
    workspace_service.delete_entry(db, user, file_id)
    return Response(status_code=204)


@router.get("/workspace/files/{file_id}/versions", response_model=Page[VersionMeta])
def list_versions(file_id: int, params: PageParams = Depends(pagination), user: User = Depends(student_only),
                  db: Session = Depends(get_db)) -> Page[VersionMeta]:
    items, total = workspace_service.list_versions(db, user, file_id, params.offset, params.size)
    return Page[VersionMeta](items=items, total=total, page=params.page, size=params.size)


@router.get("/workspace/versions/{version_id}", response_model=VersionOut)
def get_version(version_id: int, user: User = Depends(student_only), db: Session = Depends(get_db)) -> VersionOut:
    return workspace_service.get_version(db, user, version_id)


# --------------------------------------------- instructor (read-only views)

@router.get("/classes/{class_id}/students/{student_id}/workspace", response_model=TreeOut)
def student_tree(class_id: int, student_id: int, user: User = Depends(instructor_only),
                 db: Session = Depends(get_db)) -> TreeOut:
    return workspace_service.instructor_tree(db, user, class_id, student_id)


@router.get("/classes/{class_id}/students/{student_id}/workspace/files/{file_id}", response_model=FileOut)
def student_file(class_id: int, student_id: int, file_id: int, user: User = Depends(instructor_only),
                 db: Session = Depends(get_db)) -> FileOut:
    return workspace_service.instructor_file(db, user, class_id, student_id, file_id)
