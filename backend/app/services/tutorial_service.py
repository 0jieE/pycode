"""The built-in Python tutorial: what a student sees (and may open), their progress, running and checking an
exercise, the instructor's progress matrix, and editing lessons.

Locking: when ANY class the student is approved in has tutorial_unlock_in_order, a lesson is locked until the
previous visible lesson is passed (the first is never locked). Hidden lessons do not exist for students."""
import logging
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.execution import ExecutionKind, ExecutionMode
from app.models.tutorial import TutorialLesson, TutorialProgress
from app.models.user import Role, User
from app.schemas.enrollment import StudentBrief
from app.schemas.execution import RunResponse
from app.schemas.tutorial import (CheckRequest, CodeSave, ExerciseSpec, LessonCreate, LessonDetail, LessonFull,
                                  LessonHeader, LessonListItem, LessonUpdate, ProgressCell, ProgressOut,
                                  StudentExercise, StudentRow, StudentTestHidden, StudentTestSample,
                                  TutorialMatrix, TutorialRunRequest)
from app import tutorial_content
from app.services import audit_service, class_service, execution_service, grading_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------------- lookups

def _lessons(db: Session, include_hidden: bool) -> list[TutorialLesson]:
    stmt = select(TutorialLesson).order_by(TutorialLesson.sort_order, TutorialLesson.id)
    if not include_hidden:
        stmt = stmt.where(TutorialLesson.is_hidden.is_(False))
    return list(db.scalars(stmt))


def _lesson(db: Session, slug: str, include_hidden: bool) -> TutorialLesson:
    lesson = db.scalar(select(TutorialLesson).where(TutorialLesson.slug == slug))
    if lesson is None or (lesson.is_hidden and not include_hidden):
        raise NotFoundError("Lesson not found", "LESSON_NOT_FOUND")
    return lesson


def _progress_of(db: Session, student_id: int) -> dict[int, TutorialProgress]:
    return {p.lesson_id: p for p in db.scalars(select(TutorialProgress).where(TutorialProgress.student_id == student_id))}


def _progress_row(db: Session, student_id: int, lesson_id: int) -> TutorialProgress:
    row = db.scalar(select(TutorialProgress).where(TutorialProgress.student_id == student_id,
                                                   TutorialProgress.lesson_id == lesson_id))
    if row is None:
        row = TutorialProgress(student_id=student_id, lesson_id=lesson_id, attempts=0)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:  # two requests created it at the same moment
            db.rollback()
            row = db.scalar(select(TutorialProgress).where(TutorialProgress.student_id == student_id,
                                                           TutorialProgress.lesson_id == lesson_id))
    return row


def unlock_in_order(db: Session, student: User) -> bool:
    if student.role != Role.STUDENT:
        return False
    return db.scalar(select(func.count()).select_from(Enrollment)
                     .join(Classroom, Classroom.id == Enrollment.class_id)
                     .where(Enrollment.student_id == student.id, Enrollment.status == EnrollmentStatus.APPROVED,
                            Classroom.tutorial_unlock_in_order.is_(True))) > 0


def _locked_slugs(lessons: list[TutorialLesson], progress: dict[int, TutorialProgress], enforce: bool) -> set[str]:
    """Visible lessons in order: each one is locked until the previous one is passed."""
    if not enforce:
        return set()
    locked, previous_passed = set(), True
    for lesson in lessons:
        if not previous_passed:
            locked.add(lesson.slug)
        row = progress.get(lesson.id)
        previous_passed = row is not None and row.passed_at is not None
    return locked


def _require_open(db: Session, student: User, slug: str) -> TutorialLesson:
    """The lesson, if the student may work on it (visible and not locked)."""
    lessons = _lessons(db, include_hidden=False)
    lesson = next((l for l in lessons if l.slug == slug), None)
    if lesson is None:
        raise NotFoundError("Lesson not found", "LESSON_NOT_FOUND")
    if slug in _locked_slugs(lessons, _progress_of(db, student.id), unlock_in_order(db, student)):
        raise ForbiddenError("Finish the previous lesson first", "TUTORIAL_LOCKED")
    return lesson


# ------------------------------------------------------------------------------ student side

def list_lessons(db: Session, user: User) -> list[LessonListItem]:
    lessons = _lessons(db, include_hidden=False)
    progress = _progress_of(db, user.id) if user.role == Role.STUDENT else {}
    locked = _locked_slugs(lessons, progress, unlock_in_order(db, user))
    out = []
    for lesson in lessons:
        row = progress.get(lesson.id)
        out.append(LessonListItem(slug=lesson.slug, title=lesson.title, order=lesson.sort_order, summary=lesson.summary,
                                  passed=row is not None and row.passed_at is not None,
                                  viewed=row is not None and row.viewed_at is not None,
                                  attempts=row.attempts if row else 0, locked=lesson.slug in locked))
    return out


def student_exercise(exercise: dict[str, Any]) -> StudentExercise:
    """The exercise WITHOUT the reference solution and without hidden tests' input and expected output."""
    spec = ExerciseSpec.model_validate(exercise)
    tests: list[StudentTestSample | StudentTestHidden] = []
    for t in spec.tests:
        if t.is_hidden:
            tests.append(StudentTestHidden(name=t.name, points=t.points))
        else:
            tests.append(StudentTestSample(name=t.name, stdin=t.stdin, expected_output=t.expected_output,
                                           match_mode=t.match_mode, points=t.points))
    return StudentExercise(prompt=spec.prompt, starter_code=spec.starter_code, starter_files=spec.starter_files,
                           entry=spec.entry, ignore_input_prompts=spec.ignore_input_prompts, tests=tests)


def get_lesson(db: Session, user: User, slug: str) -> LessonDetail:
    lessons = _lessons(db, include_hidden=False)
    lesson = next((l for l in lessons if l.slug == slug), None)
    if lesson is None:
        raise NotFoundError("Lesson not found", "LESSON_NOT_FOUND")
    progress = _progress_of(db, user.id) if user.role == Role.STUDENT else {}
    locked = slug in _locked_slugs(lessons, progress, unlock_in_order(db, user))
    if locked:
        raise ForbiddenError("Finish the previous lesson first", "TUTORIAL_LOCKED")
    row = progress.get(lesson.id)
    return LessonDetail(
        slug=lesson.slug, title=lesson.title, order=lesson.sort_order, summary=lesson.summary, body_md=lesson.body_md,
        examples=lesson.examples, exercise=student_exercise(lesson.exercise), locked=False,
        progress=ProgressOut(viewed_at=row.viewed_at if row else None, passed_at=row.passed_at if row else None,
                             attempts=row.attempts if row else 0, last_code=row.last_code if row else None))


def mark_viewed(db: Session, student: User, slug: str) -> ProgressOut:
    lesson = _require_open(db, student, slug)
    row = _progress_row(db, student.id, lesson.id)
    if row.viewed_at is None:
        row.viewed_at = utcnow()
    db.commit()
    return ProgressOut(viewed_at=row.viewed_at, passed_at=row.passed_at, attempts=row.attempts)


def save_code(db: Session, student: User, slug: str, data: CodeSave) -> ProgressOut:
    lesson = _require_open(db, student, slug)
    row = _progress_row(db, student.id, lesson.id)
    row.last_code = data.code
    if row.viewed_at is None:
        row.viewed_at = utcnow()
    db.commit()
    return ProgressOut(viewed_at=row.viewed_at, passed_at=row.passed_at, attempts=row.attempts)


def run(db: Session, user: User, data: TutorialRunRequest, ip: Optional[str]) -> RunResponse:
    """A single-file run (main.py = the code) on the practice / interactive queues, never blocked by lab sessions.
    Same per-student limits as any run."""
    files = [{"path": "main.py", "content": data.code, "is_folder": False}]
    return execution_service.start_adhoc_run(db, user, files, "main.py", data.stdin, data.mode,
                                             audit_details={"tutorial": True}, ip=ip)


def check(db: Session, student: User, slug: str, data: CheckRequest, ip: Optional[str]) -> RunResponse:
    """Runs the exercise's tests against the student's files: a test job of the same engine as activities. The
    worker records the attempt and, when every test passes, the pass (see tasks._run_test_job)."""
    lesson = _require_open(db, student, slug)
    spec = ExerciseSpec.model_validate(lesson.exercise)
    files = [{"path": f.path.strip(), "content": f.content, "is_folder": False} for f in data.files]
    paths = [f["path"] for f in files]
    if spec.entry not in paths:
        raise AppError(400, f"There is no '{spec.entry}' among the files", "ENTRY_NOT_FOUND")
    if len(set(paths)) != len(paths) or any("/" in p or p.startswith(".") or ".." in p or not p for p in paths):
        raise AppError(400, "File names must be simple names (no folders)", "INVALID_PATH")
    for f in files:
        if len(f["content"].encode("utf-8")) > 100 * 1024:
            raise AppError(400, f"{f['path']} is larger than 100 KB", "FILE_TOO_LARGE")
    return execution_service.start_tutorial_check(db, student, lesson, files, spec.entry, len(spec.tests), ip)


def cases_of(lesson: TutorialLesson) -> tuple[list[grading_service.CaseData], bool]:
    """The exercise's tests as the grading engine wants them (ids are the test's position, from 1)."""
    spec = ExerciseSpec.model_validate(lesson.exercise)
    cases = [grading_service.CaseData(id=i, name=t.name, stdin=t.stdin, expected=t.expected_output,
                                      is_hidden=t.is_hidden, points=t.points, match_mode=t.match_mode)
             for i, t in enumerate(spec.tests, start=1)]
    return cases, spec.ignore_input_prompts


def record_check(db: Session, student_id: int, lesson_id: int, passed_all: bool) -> None:
    """Called by the worker after a check: one more attempt; the first all-pass sets passed_at."""
    row = _progress_row(db, student_id, lesson_id)
    row.attempts += 1
    if passed_all and row.passed_at is None:
        row.passed_at = utcnow()
    db.commit()


# --------------------------------------------------------------------------- instructor side

def progress_matrix(db: Session, instructor: User, class_id: int) -> TutorialMatrix:
    classroom = class_service.get_owned_class(db, class_id, instructor)
    lessons = _lessons(db, include_hidden=False)
    students = list(db.scalars(
        select(User).join(Enrollment, Enrollment.student_id == User.id)
        .where(Enrollment.class_id == class_id, Enrollment.status == EnrollmentStatus.APPROVED)
        .order_by(User.full_name, User.id)))
    by_id = {l.id: l for l in lessons}
    rows = db.scalars(select(TutorialProgress).where(TutorialProgress.student_id.in_([s.id for s in students]))) \
        if students else []
    cells: dict[int, dict[str, ProgressCell]] = {s.id: {} for s in students}
    for p in rows:
        lesson = by_id.get(p.lesson_id)
        if lesson is None:
            continue
        cells[p.student_id][lesson.slug] = ProgressCell(
            passed_at=p.passed_at, attempts=p.attempts,
            last_activity=max(t for t in (p.viewed_at, p.passed_at, p.updated_at) if t is not None))
    return TutorialMatrix(
        class_id=class_id, unlock_in_order=classroom.tutorial_unlock_in_order,
        lessons=[LessonHeader(slug=l.slug, title=l.title, order=l.sort_order) for l in lessons],
        students=[StudentRow(student=StudentBrief(id=s.id, username=s.username, full_name=s.full_name,
                                                  student_no=s.student_no),
                             lessons=cells[s.id],
                             passed_count=sum(1 for c in cells[s.id].values() if c.passed_at is not None))
                  for s in students],
        generated_at=utcnow())


# ------------------------------------------------------------------------- editing (staff)

def _full(lesson: TutorialLesson, files: Optional[dict] = None) -> LessonFull:
    files = tutorial_content.lesson_files() if files is None else files
    return LessonFull(id=lesson.id, slug=lesson.slug, title=lesson.title, order=lesson.sort_order,
                      summary=lesson.summary, body_md=lesson.body_md, examples=lesson.examples,
                      exercise=lesson.exercise, is_hidden=lesson.is_hidden, has_default=lesson.slug in files,
                      updated_at=lesson.updated_at)


def _audit(db: Session, user: User, op: str, slug: str, ip: Optional[str], **details) -> None:
    audit_service.record(db, audit_service.TUTORIAL_CHANGE, user_id=user.id,
                         details={"op": op, "slug": slug, **details}, ip_address=ip)


def manage_list(db: Session) -> list[LessonFull]:
    files = tutorial_content.lesson_files()
    return [_full(l, files) for l in _lessons(db, include_hidden=True)]


def manage_get(db: Session, slug: str) -> LessonFull:
    return _full(_lesson(db, slug, include_hidden=True))


def create_lesson(db: Session, user: User, data: LessonCreate, ip: Optional[str]) -> LessonFull:
    if db.scalar(select(TutorialLesson.id).where(TutorialLesson.slug == data.slug)) is not None:
        raise ConflictError("A lesson with this slug already exists", "SLUG_TAKEN")
    last = db.scalar(select(func.max(TutorialLesson.sort_order))) or 0
    lesson = TutorialLesson(slug=data.slug, title=data.title, summary=data.summary, body_md=data.body_md,
                            examples=[e.model_dump() for e in data.examples], exercise=data.exercise.model_dump(),
                            is_hidden=data.is_hidden, sort_order=last + 1)
    db.add(lesson)
    db.flush()
    _audit(db, user, "create", lesson.slug, ip)
    db.commit()
    return _full(lesson)


def update_lesson(db: Session, user: User, slug: str, data: LessonUpdate, ip: Optional[str]) -> LessonFull:
    lesson = _lesson(db, slug, include_hidden=True)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for field in ("title", "summary", "body_md", "is_hidden"):
        if field in changes:
            setattr(lesson, field, changes[field])
    if "examples" in changes:
        lesson.examples = changes["examples"]
    if "exercise" in changes:
        lesson.exercise = changes["exercise"]
    _audit(db, user, "update", slug, ip, fields=sorted(changes))
    db.commit()
    return _full(lesson)


def delete_lesson(db: Session, user: User, slug: str, ip: Optional[str]) -> None:
    """Only a lesson created by hand: a default one would come back with the next load, so it can only be hidden.
    Progress rows go with it (FK cascade); executions keep their row with tutorial_lesson_id NULL (FK SET NULL).
    Locks need no update: they are computed from the remaining visible lessons on every request."""
    lesson = _lesson(db, slug, include_hidden=True)
    if slug in tutorial_content.lesson_files():
        raise ConflictError("Lessons that come with the system can be hidden, not deleted", "LESSON_IS_DEFAULT")
    db.delete(lesson)
    _audit(db, user, "delete", slug, ip)
    db.commit()


def reorder(db: Session, user: User, order: list[str], ip: Optional[str]) -> list[LessonFull]:
    lessons = {l.slug: l for l in _lessons(db, include_hidden=True)}
    if sorted(order) != sorted(lessons) or len(set(order)) != len(order):
        raise AppError(400, "order must list every lesson's slug exactly once", "INVALID_ORDER")
    for position, slug in enumerate(order, start=1):
        lessons[slug].sort_order = position
    _audit(db, user, "reorder", "*", ip)
    db.commit()
    return manage_list(db)


def reset_lesson(db: Session, user: User, slug: str, ip: Optional[str]) -> LessonFull:
    """Back to the repo file's content (is_hidden is kept)."""
    _lesson(db, slug, include_hidden=True)
    try:
        lesson = tutorial_content.load_one(db, slug)
    except tutorial_content.ContentError as exc:
        raise AppError(500, f"The default lesson file is invalid: {exc}", "CONTENT_ERROR")
    if lesson is None:
        raise NotFoundError("This lesson has no default file to reset to", "NO_DEFAULT")
    _audit(db, user, "reset", slug, ip)
    db.commit()
    return _full(lesson)
