from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models.user import Role, User
from app.schemas.execution import ExecutionOut, RunRequest, RunResponse
from app.services import execution_service

router = APIRouter(tags=["run"])
student_only = require_role(Role.STUDENT)


@router.post("/workspace/{class_id}/run", response_model=RunResponse, status_code=202)
def run(class_id: int, body: RunRequest, request: Request, user: User = Depends(student_only),
        db: Session = Depends(get_db)) -> RunResponse:
    """Queues the entry file for execution. Output arrives over WebSocket /ws/run/{execution_id}."""
    return execution_service.start_run(db, user, class_id, body, client_ip(request))


@router.get("/executions/{execution_id}", response_model=ExecutionOut)
def get_execution(execution_id: int, user: User = Depends(require_role(Role.STUDENT, Role.INSTRUCTOR)),
                  db: Session = Depends(get_db)) -> ExecutionOut:
    """Your own run / test result. (Instructors can read their own "try this test case" results.)"""
    return execution_service.get_execution(db, user, execution_id)
