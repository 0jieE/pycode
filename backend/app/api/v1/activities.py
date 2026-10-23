from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import PageParams, client_ip, get_db, pagination, require_role
from app.models.activity import Activity
from app.models.user import Role, User
from app.schemas.activity import ActivityCreate, ActivityOut, ActivityUpdate, Requirements
from app.schemas.common import Page
from app.schemas.submission import MySubmissionOut, SubmissionDetail, SubmissionListItem, SubmissionOut
from app.services import activity_service, submission_service

router = APIRouter(tags=["activities"])
instructor_only = require_role(Role.INSTRUCTOR)
class_member = require_role(Role.INSTRUCTOR, Role.STUDENT)  # students see published activities only


@router.get("/classes/{class_id}/activities", response_model=Page[ActivityOut])
def list_activities(class_id: int, params: PageParams = Depends(pagination), include_archived: bool = False,
                    user: User = Depends(class_member), db: Session = Depends(get_db)) -> Page[ActivityOut]:
    """Students: published, not archived. Instructor: everything but archived ones, unless include_archived."""
    items, total = activity_service.list_activities(db, class_id, user, params.offset, params.size,
                                                    include_archived=include_archived)
    return Page[ActivityOut](items=[ActivityOut.model_validate(a) for a in items],
                             total=total, page=params.page, size=params.size)


@router.post("/classes/{class_id}/activities", response_model=ActivityOut, status_code=201)
def create_activity(class_id: int, body: ActivityCreate, request: Request,
                    user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> Activity:
    return activity_service.create_activity(db, class_id, user, body, client_ip(request))


@router.get("/activities/{activity_id}", response_model=ActivityOut)
def get_activity(activity_id: int, user: User = Depends(class_member), db: Session = Depends(get_db)) -> Activity:
    return activity_service.get_activity(db, activity_id, user)


@router.patch("/activities/{activity_id}", response_model=ActivityOut)
def update_activity(activity_id: int, body: ActivityUpdate, request: Request,
                    user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> Activity:
    return activity_service.update_activity(db, activity_id, user, body, client_ip(request))


@router.delete("/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int, request: Request, user: User = Depends(instructor_only),
                    db: Session = Depends(get_db)) -> Response:
    """Drafts only. A published activity is 409 ACTIVITY_PUBLISHED: archive it instead (PATCH is_archived)."""
    activity_service.delete_activity(db, activity_id, user, client_ip(request))
    return Response(status_code=204)


@router.post("/activities/{activity_id}/publish", response_model=ActivityOut)
def publish_activity(activity_id: int, request: Request, user: User = Depends(instructor_only),
                     db: Session = Depends(get_db)) -> Activity:
    return activity_service.publish_activity(db, activity_id, user, client_ip(request))


# ---------------------------------------------------------------- submissions

@router.post("/activities/{activity_id}/submit", response_model=SubmissionOut)
def submit(activity_id: int, request: Request, user: User = Depends(require_role(Role.STUDENT)),
           db: Session = Depends(get_db)) -> SubmissionOut:
    return submission_service.submit(db, user, activity_id, client_ip(request))


@router.get("/classes/{class_id}/my-submissions", response_model=list[MySubmissionOut])
def my_submissions(class_id: int, user: User = Depends(require_role(Role.STUDENT)),
                   db: Session = Depends(get_db)) -> list[MySubmissionOut]:
    """The signed-in student's latest submission per activity in this class (not paginated)."""
    return submission_service.my_submissions(db, user, class_id)


@router.get("/activities/{activity_id}/submissions", response_model=Page[SubmissionListItem])
def list_submissions(activity_id: int, params: PageParams = Depends(pagination),
                     user: User = Depends(instructor_only), db: Session = Depends(get_db)) -> Page[SubmissionListItem]:
    items, total = submission_service.list_submissions(db, activity_id, user, params.offset, params.size)
    return Page[SubmissionListItem](items=items, total=total, page=params.page, size=params.size)


@router.get("/submissions/{submission_id}", response_model=SubmissionDetail)
def get_submission(submission_id: int, user: User = Depends(class_member),
                   db: Session = Depends(get_db)) -> SubmissionDetail:
    """The class's instructor or the student who submitted."""
    return submission_service.get_submission(db, submission_id, user)


# --------------------------------------------------------------------------------- code requirements

@router.get("/activities/{activity_id}/requirements", response_model=Requirements)
def get_requirements(activity_id: int, user: User = Depends(instructor_only),
                     db: Session = Depends(get_db)) -> Requirements:
    """The activity's code requirements (empty lists = none). Students see them in the activity itself."""
    return activity_service.get_requirements(db, activity_id, user)


@router.put("/activities/{activity_id}/requirements", response_model=Requirements)
def set_requirements(activity_id: int, body: Requirements, request: Request, user: User = Depends(instructor_only),
                     db: Session = Depends(get_db)) -> Requirements:
    """Replace them: {must_define_functions, must_use, must_not_use_calls, must_not_use_imports}. Checked on the
    activity folder before the tests run; a violation fails every test with status "requirement_failed"."""
    return activity_service.set_requirements(db, activity_id, user, body, client_ip(request))


@router.delete("/activities/{activity_id}/requirements", status_code=204)
def clear_requirements(activity_id: int, request: Request, user: User = Depends(instructor_only),
                       db: Session = Depends(get_db)) -> Response:
    activity_service.set_requirements(db, activity_id, user, Requirements(), client_ip(request))
    return Response(status_code=204)
