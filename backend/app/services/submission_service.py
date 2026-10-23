import logging
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.core.errors import AppError, ForbiddenError, NotFoundError
from app.models.activity import Activity
from app.models.submission import Submission, SubmissionFile, SubmissionStatus
from app.models.user import Role, User
from app.models.workspace import Workspace, WorkspaceFile
from app.schemas.enrollment import StudentBrief
from app.schemas.submission import (
    MySubmissionOut,
    SubmissionDetail,
    SubmissionFileOut,
    SubmissionListItem,
    SubmissionOut,
)
from app.services import audit_service, class_service, execution_service, monitor_service, workspace_service

logger = logging.getLogger(__name__)


def _file_count(db: Session, submission_id: int) -> int:
    return db.scalar(select(func.count()).select_from(SubmissionFile)
                     .where(SubmissionFile.submission_id == submission_id)) or 0


def submit(db: Session, student: User, activity_id: int, ip: Optional[str]) -> SubmissionOut:
    """Freezes a copy of every file under the activity folder. Resubmitting replaces the old snapshot.

    Not blocked by a closed lab: a student may submit until the due date. From due_at on it is refused
    (403 ACTIVITY_PAST_DUE); the instructor gives more time by moving due_at. New submissions are therefore never
    late; rows marked 'late' before this rule stay as they are.
    """
    activity = db.get(Activity, activity_id)
    if activity is None or not activity.is_published or activity.is_archived:
        raise NotFoundError("Activity not found", "ACTIVITY_NOT_FOUND")
    class_service.get_class_for_member(db, activity.class_id, student)  # approved students only
    if activity.due_at is not None and utcnow() >= activity.due_at:
        raise ForbiddenError(f"'{activity.title}' was due on {workspace_service.display_time(activity.due_at)}: "
                             f"submissions are closed", "ACTIVITY_PAST_DUE")
    workspace = workspace_service.ensure_workspace(db, student.id, activity.class_id)

    folder = activity.title
    files = db.scalars(
        select(WorkspaceFile).where(
            WorkspaceFile.workspace_id == workspace.id,
            WorkspaceFile.is_folder.is_(False),
            workspace_service.under(folder),
        ).order_by(WorkspaceFile.path)
    ).all()
    if not files:
        raise AppError(400, f"There are no files in the '{folder}' folder to submit", "EMPTY_SUBMISSION")

    now = utcnow()
    status = SubmissionStatus.SUBMITTED

    # One row per (activity, student): insert it, or refresh it if this is a resubmission.
    stmt = mysql_insert(Submission).values(activity_id=activity.id, student_id=student.id,
                                           submitted_at=now, status=status)
    # A resubmission invalidates the old score: it is cleared here and filled in again by the new grading job.
    db.execute(stmt.on_duplicate_key_update(submitted_at=stmt.inserted.submitted_at, status=stmt.inserted.status,
                                            tests_passed=None, tests_total=None, score=None, max_score=None,
                                            graded_at=None, hardcode_suspected=False, hardcode_tests=None))
    submission = db.scalars(
        select(Submission).where(Submission.activity_id == activity.id, Submission.student_id == student.id)
        .with_for_update()
    ).one()
    db.execute(delete(SubmissionFile).where(SubmissionFile.submission_id == submission.id))
    db.add_all(SubmissionFile(submission_id=submission.id, path=f.path, content=f.content) for f in files)

    audit_service.record(db, audit_service.SUBMIT, user_id=student.id,
                         details={"activity_id": activity.id, "submission_id": submission.id,
                                  "files": len(files), "status": status.value}, ip_address=ip)
    db.commit()
    db.refresh(submission)
    monitor_service.emit_for_class(db, activity.class_id, "submitted", student.id, student.full_name,
                                   activity_id=activity.id, submission_id=submission.id,
                                   status=status.value, files=len(files))
    # Automatic grading of the frozen snapshot (not of the live workspace); never blocks or fails the submit.
    execution_service.queue_grading(db, activity, student.id, workspace.id)
    return SubmissionOut(id=submission.id, activity_id=activity.id, student_id=student.id,
                         status=submission.status, submitted_at=submission.submitted_at,
                         file_count=len(files))


def my_submissions(db: Session, student: User, class_id: int) -> list[MySubmissionOut]:
    """The student's own submissions in a class: one row per activity (resubmitting replaces the row, so it is
    always the latest). Only approved students; anything else is 403, even for a class that does not exist."""
    if not class_service.is_approved_student(db, class_id, student.id):
        raise ForbiddenError("You are not a member of this class", "NOT_CLASS_MEMBER")
    rows = db.execute(
        select(Submission.activity_id, Submission.status, Submission.submitted_at)
        .join(Activity, Activity.id == Submission.activity_id)
        .where(Submission.student_id == student.id, Activity.class_id == class_id)
        .order_by(Submission.activity_id)
    ).all()
    return [MySubmissionOut(activity_id=a, status=s, submitted_at=t) for a, s, t in rows]


def list_submissions(db: Session, activity_id: int, instructor: User, offset: int,
                     limit: int) -> tuple[list[SubmissionListItem], int]:
    activity = db.get(Activity, activity_id)
    if activity is None:
        raise NotFoundError("Activity not found", "ACTIVITY_NOT_FOUND")
    class_service.get_owned_class(db, activity.class_id, instructor)

    where = Submission.activity_id == activity.id
    total = db.scalar(select(func.count()).select_from(Submission).where(where)) or 0
    file_counts = (select(SubmissionFile.submission_id, func.count().label("n"))
                   .group_by(SubmissionFile.submission_id).subquery())
    rows = db.execute(
        select(Submission, User, func.coalesce(file_counts.c.n, 0))
        .join(User, User.id == Submission.student_id)
        .outerjoin(file_counts, file_counts.c.submission_id == Submission.id)
        .where(where).order_by(Submission.submitted_at.desc(), Submission.id.desc())
        .offset(offset).limit(limit)
    ).all()
    return [
        SubmissionListItem(
            id=s.id, status=s.status, submitted_at=s.submitted_at, file_count=int(n),
            tests_passed=s.tests_passed, tests_total=s.tests_total, score=s.score, max_score=s.max_score,
            graded_at=s.graded_at, hardcode_suspected=s.hardcode_suspected, hardcode_tests=s.hardcode_tests,
            student=StudentBrief(id=u.id, username=u.username, full_name=u.full_name, student_no=u.student_no))
        for s, u, n in rows
    ], total


def get_submission(db: Session, submission_id: int, user: User) -> SubmissionDetail:
    """The class's instructor, or the student who made it. Nobody else."""
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise NotFoundError("Submission not found", "SUBMISSION_NOT_FOUND")
    activity = db.get(Activity, submission.activity_id)
    if user.role == Role.STUDENT:
        if submission.student_id != user.id:
            raise NotFoundError("Submission not found", "SUBMISSION_NOT_FOUND")
    elif user.role == Role.INSTRUCTOR:
        class_service.get_owned_class(db, activity.class_id, user)
    else:
        raise ForbiddenError("You do not have permission to do this", "FORBIDDEN_ROLE")

    student = db.get(User, submission.student_id)
    files = db.scalars(select(SubmissionFile).where(SubmissionFile.submission_id == submission.id)
                       .order_by(SubmissionFile.path)).all()
    return SubmissionDetail(
        id=submission.id, activity_id=submission.activity_id, student_id=submission.student_id,
        status=submission.status, submitted_at=submission.submitted_at, file_count=len(files),
        tests_passed=submission.tests_passed, tests_total=submission.tests_total, score=submission.score,
        max_score=submission.max_score, graded_at=submission.graded_at,
        # the hardcoding flag is for the instructor: a student never sees it
        hardcode_suspected=submission.hardcode_suspected if user.role == Role.INSTRUCTOR else None,
        hardcode_tests=submission.hardcode_tests if user.role == Role.INSTRUCTOR else None,
        student=StudentBrief(id=student.id, username=student.username, full_name=student.full_name,
                             student_no=student.student_no),
        files=[SubmissionFileOut(path=f.path, content=f.content or "") for f in files])
