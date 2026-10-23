"""Instructor management of an activity's automatic test cases, plus the student-safe view of them."""
import logging
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, NotFoundError
from app.models.activity import Activity
from app.models.test_case import MatchMode, TestCase
from app.models.user import User
from app.schemas.execution import RunResponse
from app.schemas.test_case import (
    CaseCreate,
    CaseUpdate,
    RegradeResult,
    StudentCase,
    StudentCaseHidden,
    StudentCaseSample,
)
from app.services import activity_service, audit_service, execution_service, grading_service

logger = logging.getLogger(__name__)


def _check_texts(stdin: str, expected: str, mode: MatchMode) -> None:
    for label, text in (("stdin", stdin), ("expected_output", expected)):
        if len(text.encode("utf-8")) > grading_service.MAX_TEXT_BYTES:
            raise AppError(413, f"{label} is larger than {grading_service.MAX_TEXT_BYTES // 1024} KB",
                           "TEST_CASE_TOO_LARGE")
    if mode == MatchMode.CONTAINS and not grading_service.normalize_trim(expected):
        raise AppError(400, "A 'contains' test needs some expected text (empty text is contained in everything)",
                       "EMPTY_EXPECTED_OUTPUT")


def _cases(db: Session, activity_id: int) -> list[TestCase]:
    return list(db.scalars(select(TestCase).where(TestCase.activity_id == activity_id)
                           .order_by(TestCase.sort_order, TestCase.id)))


def _owned_case(db: Session, case_id: int, instructor: User) -> tuple[TestCase, Activity]:
    case = db.get(TestCase, case_id)
    if case is None:
        raise NotFoundError("Test case not found", "TEST_CASE_NOT_FOUND")
    return case, activity_service.get_owned_activity(db, case.activity_id, instructor)


def _audit(db: Session, instructor: User, op: str, activity_id: int, case_id: Optional[int],
           ip: Optional[str]) -> None:
    audit_service.record(db, audit_service.TEST_CASE_CHANGE, user_id=instructor.id,
                         details={"op": op, "activity_id": activity_id, "case_id": case_id}, ip_address=ip)


# ------------------------------------------------------------------ instructor

def list_cases(db: Session, instructor: User, activity_id: int) -> list[TestCase]:
    activity = activity_service.get_owned_activity(db, activity_id, instructor)
    return _cases(db, activity.id)


def create_case(db: Session, instructor: User, activity_id: int, data: CaseCreate, ip: Optional[str]) -> TestCase:
    activity = activity_service.get_owned_activity(db, activity_id, instructor)
    _check_texts(data.stdin, data.expected_output, data.match_mode)

    # Lock the activity row so two simultaneous creates cannot both slip past the limit.
    db.execute(select(Activity.id).where(Activity.id == activity.id).with_for_update()).one()
    count, last = db.execute(select(func.count(), func.coalesce(func.max(TestCase.sort_order), -1))
                             .where(TestCase.activity_id == activity.id)).one()
    if count >= grading_service.MAX_TEST_CASES:
        raise AppError(400, f"An activity can have at most {grading_service.MAX_TEST_CASES} test cases",
                       "TOO_MANY_TEST_CASES")
    case = TestCase(activity_id=activity.id, name=data.name, stdin=data.stdin, expected_output=data.expected_output,
                    is_hidden=data.is_hidden, points=data.points, match_mode=data.match_mode, sort_order=last + 1,
                    require_input_read=data.require_input_read)
    db.add(case)
    db.flush()
    _audit(db, instructor, "create", activity.id, case.id, ip)
    db.commit()
    return case


def update_case(db: Session, instructor: User, case_id: int, data: CaseUpdate, ip: Optional[str]) -> TestCase:
    case, activity = _owned_case(db, case_id, instructor)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    _check_texts(changes.get("stdin", case.stdin or ""), changes.get("expected_output", case.expected_output or ""),
                 changes.get("match_mode", case.match_mode))
    for field, value in changes.items():  # allowed at any time, even after the activity is published
        setattr(case, field, value)
    _audit(db, instructor, "update", activity.id, case.id, ip)
    db.commit()
    return case


def delete_case(db: Session, instructor: User, case_id: int, ip: Optional[str]) -> None:
    case, activity = _owned_case(db, case_id, instructor)
    db.delete(case)
    _audit(db, instructor, "delete", activity.id, case_id, ip)
    db.commit()


def reorder(db: Session, instructor: User, activity_id: int, order: list[int], ip: Optional[str]) -> list[TestCase]:
    activity = activity_service.get_owned_activity(db, activity_id, instructor)
    cases = {c.id: c for c in _cases(db, activity.id)}
    if sorted(order) != sorted(cases) or len(set(order)) != len(order):
        raise AppError(400, "order must list every test case of the activity exactly once", "INVALID_ORDER")
    for position, case_id in enumerate(order):
        cases[case_id].sort_order = position
    _audit(db, instructor, "reorder", activity.id, None, ip)
    db.commit()
    return _cases(db, activity.id)


def try_case(db: Session, instructor: User, case_id: int, files: Optional[list], ip: Optional[str]) -> RunResponse:
    """Queues a check of ONE case against the given files (default: the activity's starter files), so the
    instructor can confirm the expected output is what a correct program really prints."""
    case, activity = _owned_case(db, case_id, instructor)
    if files is None:
        use = [{"path": f["path"], "content": f.get("content", "")} for f in activity.starter_files or []]
    else:
        use = activity_service.validate_starter_files(db, activity.title, files)
    return execution_service.start_try(db, instructor, activity, case, use, ip)


def regrade(db: Session, instructor: User, activity_id: int, ip: Optional[str]) -> RegradeResult:
    activity = activity_service.get_owned_activity(db, activity_id, instructor)
    queued, skipped = execution_service.regrade_activity(db, instructor, activity, ip)
    return RegradeResult(queued=queued, skipped=skipped)


# --------------------------------------------------------------------- student

def student_view(db: Session, student: User, activity_id: int) -> list[StudentCase]:
    """What a student may know: samples with their input and expected output; hidden cases only as a name and
    points. The hidden cases' stdin and expected output are never even read into the response objects."""
    activity = activity_service.get_visible_activity(db, activity_id, student)
    out: list[StudentCase] = []
    for c in _cases(db, activity.id):
        if c.is_hidden:
            out.append(StudentCaseHidden(id=c.id, name=c.name, points=c.points))
        else:
            out.append(StudentCaseSample(id=c.id, name=c.name, points=c.points, stdin=c.stdin or "",
                                         expected_output=c.expected_output or "", match_mode=c.match_mode))
    return out
