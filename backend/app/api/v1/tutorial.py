"""The built-in Python tutorial: lessons and progress (students), the class matrix (instructors), editing (staff)."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.deps import client_ip, get_db, require_role
from app.models.user import Role, User
from app.schemas.execution import RunResponse
from app.schemas.tutorial import (CheckRequest, CodeSave, LessonCreate, LessonDetail, LessonFull, LessonListItem,
                                  LessonOrder, LessonUpdate, ProgressOut, SeedResult, TutorialMatrix,
                                  TutorialRunRequest)
from app.services import tutorial_service

router = APIRouter(prefix="/tutorial", tags=["tutorial"])
anyone = require_role(Role.STUDENT, Role.INSTRUCTOR, Role.ADMIN)
student_only = require_role(Role.STUDENT)
runners = require_role(Role.STUDENT, Role.INSTRUCTOR)
staff = require_role(Role.ADMIN, Role.INSTRUCTOR)
instructor_only = require_role(Role.INSTRUCTOR)


# ------------------------------------------------------------------- editing (declared first: "manage" is no slug)

@router.get("/manage/lessons", response_model=list[LessonFull])
def manage_list(user: User = Depends(staff), db: Session = Depends(get_db)) -> list[LessonFull]:
    """Every lesson, hidden ones too, with hidden tests and reference solutions."""
    return tutorial_service.manage_list(db)


@router.post("/manage/lessons", response_model=LessonFull, status_code=201)
def create_lesson(body: LessonCreate, request: Request, user: User = Depends(staff),
                  db: Session = Depends(get_db)) -> LessonFull:
    return tutorial_service.create_lesson(db, user, body, client_ip(request))


@router.patch("/manage/lessons/order", response_model=list[LessonFull])
def reorder(body: LessonOrder, request: Request, user: User = Depends(staff),
            db: Session = Depends(get_db)) -> list[LessonFull]:
    return tutorial_service.reorder(db, user, body.order, client_ip(request))


@router.post("/manage/lessons/seed", response_model=SeedResult)
def seed_defaults(request: Request, user: User = Depends(require_role(Role.ADMIN)),
                  db: Session = Depends(get_db)) -> SeedResult:
    """Loads / updates every default lesson from content/tutorial (what `python -m app.tutorial_content` does)."""
    from app import tutorial_content

    try:
        return tutorial_content.load_all(db)
    except tutorial_content.ContentError as exc:
        from app.core.errors import AppError
        raise AppError(500, f"A default lesson file is invalid: {exc}", "CONTENT_ERROR")


@router.get("/manage/lessons/{slug}", response_model=LessonFull)
def manage_get(slug: str, user: User = Depends(staff), db: Session = Depends(get_db)) -> LessonFull:
    return tutorial_service.manage_get(db, slug)


@router.patch("/manage/lessons/{slug}", response_model=LessonFull)
def update_lesson(slug: str, body: LessonUpdate, request: Request, user: User = Depends(staff),
                  db: Session = Depends(get_db)) -> LessonFull:
    """Edit the text, examples, exercise (with its tests) or hide / show the lesson. Send only what changes."""
    return tutorial_service.update_lesson(db, user, slug, body, client_ip(request))


@router.delete("/manage/lessons/{slug}", status_code=204)
def delete_lesson(slug: str, request: Request, user: User = Depends(staff), db: Session = Depends(get_db)) -> Response:
    """Delete a lesson created by hand. A default lesson (has_default) is 409 LESSON_IS_DEFAULT: hide it instead."""
    tutorial_service.delete_lesson(db, user, slug, client_ip(request))
    return Response(status_code=204)


@router.post("/manage/lessons/{slug}/reset", response_model=LessonFull)
def reset_lesson(slug: str, request: Request, user: User = Depends(staff),
                 db: Session = Depends(get_db)) -> LessonFull:
    """Reset to default: the lesson as its content/tutorial file says."""
    return tutorial_service.reset_lesson(db, user, slug, client_ip(request))


# -------------------------------------------------------------------------- students

@router.get("/lessons", response_model=list[LessonListItem])
def list_lessons(user: User = Depends(anyone), db: Session = Depends(get_db)) -> list[LessonListItem]:
    """Visible lessons in order, with the student's own progress and whether each is locked."""
    return tutorial_service.list_lessons(db, user)


@router.post("/run", response_model=RunResponse, status_code=202)
def run(body: TutorialRunRequest, request: Request, user: User = Depends(runners),
        db: Session = Depends(get_db)) -> RunResponse:
    """Runs `code` as main.py (interactive or batch), never blocked by lab sessions. Follow it on /ws/run/{id}."""
    return tutorial_service.run(db, user, body, client_ip(request))


@router.get("/lessons/{slug}", response_model=LessonDetail)
def get_lesson(slug: str, user: User = Depends(anyone), db: Session = Depends(get_db)) -> LessonDetail:
    """The lesson text, examples and exercise (sample tests in full; hidden tests only by name)."""
    return tutorial_service.get_lesson(db, user, slug)


@router.post("/lessons/{slug}/view", response_model=ProgressOut)
def mark_viewed(slug: str, user: User = Depends(student_only), db: Session = Depends(get_db)) -> ProgressOut:
    return tutorial_service.mark_viewed(db, user, slug)


@router.put("/lessons/{slug}/code", response_model=ProgressOut)
def save_code(slug: str, body: CodeSave, user: User = Depends(student_only),
              db: Session = Depends(get_db)) -> ProgressOut:
    """Autosave of the student's exercise code."""
    return tutorial_service.save_code(db, user, slug, body)


@router.post("/lessons/{slug}/check", response_model=RunResponse, status_code=202)
def check(slug: str, body: CheckRequest, request: Request, user: User = Depends(student_only),
          db: Session = Depends(get_db)) -> RunResponse:
    """Runs the exercise's tests on `files` (a test job: results at GET /executions/{id} / on /ws/run/{id}).
    Passing every test marks the lesson passed."""
    return tutorial_service.check(db, user, slug, body, client_ip(request))


# ------------------------------------------------------------------------ instructors

matrix_router = APIRouter(tags=["tutorial"])


@matrix_router.get("/classes/{class_id}/tutorial-progress", response_model=TutorialMatrix)
def progress_matrix(class_id: int, user: User = Depends(instructor_only),
                    db: Session = Depends(get_db)) -> TutorialMatrix:
    """Student x lesson: passed, attempts, last activity."""
    return tutorial_service.progress_matrix(db, user, class_id)
