from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.enrollment import EnrollmentStatus
from app.models.user import Role, User
from app.schemas.common import Page
from app.schemas.enrollment import (
    EnrollmentOut,
    EnrollmentReview,
    EnrollRequest,
    EnrollResponse,
    MyClassOut,
)
from app.services import enrollment_service

router = APIRouter(tags=["enrollments"])


@router.post("/enroll", response_model=EnrollResponse, status_code=201)
def enroll(body: EnrollRequest, request: Request, response: Response,
           user: User = Depends(require_role(Role.STUDENT)), db: Session = Depends(get_db)):
    result, created = enrollment_service.join_class(db, user, body.code, client_ip(request))
    if not created:
        response.status_code = 200  # already enrolled: the existing row is returned
    return result


@router.get("/my/classes", response_model=Page[MyClassOut])
def my_classes(params: PageParams = Depends(pagination), user: User = Depends(require_role(Role.STUDENT)),
               db: Session = Depends(get_db)) -> Page[MyClassOut]:
    items, total = enrollment_service.my_classes(db, user, params.offset, params.size)
    return Page[MyClassOut](items=items, total=total, page=params.page, size=params.size)


@router.get("/classes/{class_id}/enrollments", response_model=Page[EnrollmentOut])
def list_enrollments(
    class_id: int,
    status: Optional[EnrollmentStatus] = None,
    params: PageParams = Depends(pagination),
    user: User = Depends(require_role(Role.INSTRUCTOR)),
    db: Session = Depends(get_db),
) -> Page[EnrollmentOut]:
    items, total = enrollment_service.list_enrollments(db, class_id, user, status, params.offset, params.size)
    return Page[EnrollmentOut](items=items, total=total, page=params.page, size=params.size)


@router.patch("/enrollments/{enrollment_id}", response_model=EnrollmentOut)
def review_enrollment(enrollment_id: int, body: EnrollmentReview, request: Request,
                      user: User = Depends(require_role(Role.INSTRUCTOR)), db: Session = Depends(get_db)):
    return enrollment_service.review_enrollment(db, enrollment_id, user, body.action, client_ip(request))
