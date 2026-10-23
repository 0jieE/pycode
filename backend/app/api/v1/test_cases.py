"""Automatic grading: test cases (instructor), their student-safe view, and the student's "run the tests" button."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models.test_case import TestCase
from app.models.user import Role, User
from app.schemas.execution import RunResponse
from app.schemas.test_case import (
    CaseCreate,
    CaseOrder,
    CaseOut,
    CaseUpdate,
    RegradeResult,
    StudentCase,
    TestJobRequest,
    TryRequest,
)
from app.services import execution_service, test_case_service

router = APIRouter(tags=["test cases"])
instructor_only = require_role(Role.INSTRUCTOR)
student_only = require_role(Role.STUDENT)


# ------------------------------------------------------------------ instructor

@router.get("/activities/{activity_id}/test-cases", response_model=list[CaseOut])
def list_cases(activity_id: int, user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> list[TestCase]:
    return test_case_service.list_cases(db, user, activity_id)


@router.post("/activities/{activity_id}/test-cases", response_model=CaseOut, status_code=201)
def create_case(activity_id: int, body: CaseCreate, request: Request, user: User = Depends(instructor_only),
                db: Session = Depends(get_db)) -> TestCase:
    return test_case_service.create_case(db, user, activity_id, body, client_ip(request))


# Declared before the student route and the {case_id} routes so "order" / "student" are never read as ids.
@router.patch("/activities/{activity_id}/test-cases/order", response_model=list[CaseOut])
def reorder_cases(activity_id: int, body: CaseOrder, request: Request, user: User = Depends(instructor_only),
                  db: Session = Depends(get_db)) -> list[TestCase]:
    return test_case_service.reorder(db, user, activity_id, body.order, client_ip(request))


@router.patch("/test-cases/{case_id}", response_model=CaseOut)
def update_case(case_id: int, body: CaseUpdate, request: Request, user: User = Depends(instructor_only),
                db: Session = Depends(get_db)) -> TestCase:
    return test_case_service.update_case(db, user, case_id, body, client_ip(request))


@router.delete("/test-cases/{case_id}", status_code=204)
def delete_case(case_id: int, request: Request, user: User = Depends(instructor_only),
                db: Session = Depends(get_db)) -> Response:
    test_case_service.delete_case(db, user, case_id, client_ip(request))
    return Response(status_code=204)


@router.post("/test-cases/{case_id}/try", response_model=RunResponse, status_code=202)
def try_case(case_id: int, request: Request, body: TryRequest = TryRequest(),
             user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> RunResponse:
    """Runs one case against the starter files (or `files`). Read the result at GET /executions/{id} or stream it
    on /ws/run/{id}."""
    return test_case_service.try_case(db, user, case_id, body.files, client_ip(request))


@router.post("/activities/{activity_id}/regrade", response_model=RegradeResult)
def regrade(activity_id: int, request: Request, user: User = Depends(instructor_only),
            db: Session = Depends(get_db)) -> RegradeResult:
    """Queues automatic grading again for every submission of the activity."""
    return test_case_service.regrade(db, user, activity_id, client_ip(request))


# --------------------------------------------------------------------- student

@router.get("/activities/{activity_id}/test-cases/student", response_model=list[StudentCase])
def student_cases(activity_id: int, user: User = Depends(student_only), db: Session = Depends(get_db)):
    """Sample cases with input and expected output; hidden cases only as id, name and points."""
    return test_case_service.student_view(db, user, activity_id)


@router.post("/workspace/{class_id}/test", response_model=RunResponse, status_code=202)
def run_tests(class_id: int, body: TestJobRequest, request: Request, user: User = Depends(student_only),
              db: Session = Depends(get_db)) -> RunResponse:
    """Runs the activity's test cases against the student's own files (same guards as Run)."""
    return execution_service.start_test(db, user, class_id, body, client_ip(request))
