"""Deleting an instructor or student (admin only): GET /users/{id}/delete-preview and DELETE /users/{id}.

A hard delete of the account and everything only theirs; refused for the administrator, an instructor who still owns
classes, and while one of the account's runs is in progress."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity_log import ActivityLog
from app.models.enrollment import Enrollment
from app.models.execution import Execution, ExecutionKind, ExecutionStatus
from app.models.lab import LoginEvent
from app.models.session_start import SessionStart
from app.models.submission import Submission, SubmissionFile, SubmissionStatus
from app.models.tutorial import TutorialLesson, TutorialProgress
from app.models.user import Role, User
from app.models.workspace import FileVersion, Workspace, WorkspaceFile
from tests.conftest import add_activity, approved_student, login_as

API = "/api/v1"


@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "admin")


def uid(db: Session, username: str) -> int:
    return db.scalar(select(User.id).where(User.username == username))


def count(db: Session, model, *where) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model).where(*where))


def give_student_history(db: Session, lab) -> int:
    """stu1 gets a saved file with a version, a run, a graded submission and tutorial progress."""
    sid = uid(db, "stu1")
    assert lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "notes.py", "content": "print(42)"}
                            ).status_code == 201
    file = db.scalar(select(WorkspaceFile).join(Workspace).where(Workspace.student_id == sid,
                                                                  WorkspaceFile.path == "notes.py"))
    activity = add_activity(db, lab.cid, "Lab 1")
    lesson = TutorialLesson(slug="t-delete", title="T", body_md="x", examples=[], exercise={})
    db.add(lesson)
    db.flush()
    submission = Submission(activity_id=activity.id, student_id=sid, submitted_at=utcnow(),
                            status=SubmissionStatus.SUBMITTED, score=8, max_score=10)
    db.add_all([
        FileVersion(file_id=file.id, content="print(41)", saved_at=utcnow()),
        Execution(student_id=sid, workspace_id=file.workspace_id, entry_path="notes.py",
                  status=ExecutionStatus.OK, kind=ExecutionKind.RUN, output="42\n"),
        submission,
        TutorialProgress(student_id=sid, lesson_id=lesson.id, attempts=2),
    ])
    db.flush()
    db.add(SubmissionFile(submission_id=submission.id, path="Lab 1/main.py", content="print(1)"))
    db.commit()
    lab.student.get(f"{API}/workspace/{lab.cid}/tree")       # records the session start
    return sid


# =========================================================================== who may do it

@pytest.mark.parametrize("role", [Role.STUDENT, Role.INSTRUCTOR])
def test_only_the_admin_may_delete(db: Session, role: Role) -> None:
    c = login_as(db, role, "someone")
    target = uid(db, "someone")
    assert c.get(f"{API}/users/{target}/delete-preview").status_code == 403
    assert c.delete(f"{API}/users/{target}").status_code == 403
    assert count(db, User, User.id == target) == 1


def test_anonymous_is_refused(client: TestClient, db: Session) -> None:
    assert client.delete(f"{API}/users/1").status_code == 401
    assert client.get(f"{API}/users/1/delete-preview").status_code == 401


def test_the_administrator_cannot_be_deleted(admin: TestClient, db: Session) -> None:
    me = uid(db, "admin")
    for r in (admin.get(f"{API}/users/{me}/delete-preview"), admin.delete(f"{API}/users/{me}")):
        assert r.status_code == 409 and r.json()["code"] == "ADMIN_PROTECTED"
    assert count(db, User, User.id == me) == 1
    assert admin.get(f"{API}/auth/me").status_code == 200


def test_an_unknown_user_is_404(admin: TestClient) -> None:
    assert admin.delete(f"{API}/users/999999").json()["code"] == "USER_NOT_FOUND"
    assert admin.get(f"{API}/users/999999/delete-preview").status_code == 404


# =========================================================================== a student

def test_the_preview_counts_what_would_be_lost(admin: TestClient, db: Session, lab) -> None:
    sid = give_student_history(db, lab)
    p = admin.get(f"{API}/users/{sid}/delete-preview").json()
    assert (p["username"], p["role"], p["classes"], p["enrollments"], p["submissions"], p["executions"]) == \
           ("stu1", "student", 0, 1, 1, 1)
    assert (p["workspaces"], p["workspace_files"], p["workspace_bytes"], p["tutorial_lessons"]) == (1, 1, 9, 1)
    assert p["in_open_session"] is True and p["blocked_by"] == []
    assert count(db, User, User.id == sid) == 1                       # a preview changes nothing


def test_deleting_a_student_removes_everything_that_was_theirs(admin: TestClient, db: Session, lab) -> None:
    sid = give_student_history(db, lab)
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    other_id = uid(db, "stu2")
    other.get(f"{API}/workspace/{lab.cid}/tree")
    sign_ins = count(db, ActivityLog, ActivityLog.user_id == sid)
    students_before = admin.get(f"{API}/users/counts").json()["students"]

    assert admin.delete(f"{API}/users/{sid}").status_code == 204

    assert count(db, User, User.id == sid) == 0
    for model, column in ((Workspace, Workspace.student_id), (Execution, Execution.student_id),
                          (Submission, Submission.student_id), (Enrollment, Enrollment.student_id),
                          (TutorialProgress, TutorialProgress.student_id), (LoginEvent, LoginEvent.user_id),
                          (SessionStart, SessionStart.student_id)):
        assert count(db, model, column == sid) == 0, model.__name__
    assert count(db, WorkspaceFile, WorkspaceFile.path == "notes.py") == 0
    assert count(db, FileVersion) == 0 and count(db, SubmissionFile) == 0
    # the classmate is untouched
    assert count(db, Enrollment, Enrollment.student_id == other_id) == 1
    assert count(db, Workspace, Workspace.student_id == other_id) == 1
    assert count(db, SessionStart, SessionStart.student_id == other_id) == 1
    # the audit trail stays, without the user id; the deletion itself is recorded
    assert sign_ins > 0 and count(db, ActivityLog, ActivityLog.user_id == sid) == 0
    entry = db.scalars(select(ActivityLog).where(ActivityLog.action == "user_delete")).one()
    assert entry.user_id == uid(db, "admin")
    assert entry.details == {"target_id": sid, "username": "stu1", "role": "student", "enrollments": 1,
                             "submissions": 1, "executions": 1, "workspace_files": 1}
    # counts, the monitor and the user list drop them
    assert admin.get(f"{API}/users/counts").json()["students"] == students_before - 1
    monitor = lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor").json()
    assert [s["student"]["username"] for s in monitor["students"]] == ["stu2"]
    assert admin.get(f"{API}/users/{sid}/delete-preview").status_code == 404


def test_the_deleted_student_is_signed_out_and_the_username_is_free(admin: TestClient, db: Session, lab) -> None:
    sid = uid(db, "stu1")
    assert lab.student.get(f"{API}/auth/me").status_code == 200
    assert admin.delete(f"{API}/users/{sid}").status_code == 204
    r = lab.student.get(f"{API}/auth/me")
    assert r.status_code == 401 and r.json()["code"] == "INVALID_TOKEN"
    assert admin.post(f"{API}/users", json={"username": "stu1", "password": "Sup3rSecret", "full_name": "New",
                                             "role": "student"}).status_code == 201


def test_no_open_session_is_only_a_warning(admin: TestClient, db: Session, lab) -> None:
    sid = uid(db, "stu1")
    assert admin.get(f"{API}/users/{sid}/delete-preview").json()["in_open_session"] is True
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    assert admin.get(f"{API}/users/{sid}/delete-preview").json()["in_open_session"] is False


# =========================================================================== blocked

def test_an_instructor_who_owns_classes_is_refused(admin: TestClient, db: Session, lab) -> None:
    tid = uid(db, "teach1")
    p = admin.get(f"{API}/users/{tid}/delete-preview").json()
    assert p["classes"] == 1 and [b["code"] for b in p["blocked_by"]] == ["USER_HAS_CLASSES"]
    assert "1 class." in p["blocked_by"][0]["message"]
    r = admin.delete(f"{API}/users/{tid}")
    body = r.json()
    assert r.status_code == 409 and body["code"] == "USER_HAS_CLASSES" and body["classes"] == 1
    assert body["detail"] == p["blocked_by"][0]["message"] and body["blocked_by"] == p["blocked_by"]
    assert count(db, User, User.id == tid) == 1
    assert lab.teacher.get(f"{API}/auth/me").status_code == 200          # nothing happened to them


@pytest.mark.parametrize("status", [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING])
def test_a_run_in_progress_blocks_until_it_ends(admin: TestClient, db: Session, lab, status) -> None:
    sid = uid(db, "stu1")
    run = Execution(student_id=sid, entry_path="main.py", status=status, kind=ExecutionKind.RUN)
    db.add(run)
    db.commit()
    r = admin.delete(f"{API}/users/{sid}")
    assert r.status_code == 409 and r.json()["code"] == "USER_RUN_ACTIVE"
    assert [b["code"] for b in admin.get(f"{API}/users/{sid}/delete-preview").json()["blocked_by"]] == \
           ["USER_RUN_ACTIVE"]
    run.status = ExecutionStatus.OK
    db.commit()
    assert admin.delete(f"{API}/users/{sid}").status_code == 204


# =========================================================================== an instructor without classes

def test_an_instructor_without_classes_is_deleted_with_their_practice_work(admin: TestClient, db: Session,
                                                                           lab) -> None:
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    tid = uid(db, "teach2")
    assert other.post(f"{API}/practice/files", json={"path": "try.py", "content": "x = 1"}).status_code == 201
    db.add(Execution(student_id=tid, entry_path="main.py", status=ExecutionStatus.OK, kind=ExecutionKind.TEST,
                     queued_at=utcnow() - timedelta(minutes=1)))
    enrollment = db.scalars(select(Enrollment)).one()
    enrollment.reviewed_by = tid                                        # as if they had reviewed one
    db.commit()
    p = admin.get(f"{API}/users/{tid}/delete-preview").json()
    assert (p["role"], p["classes"], p["workspaces"], p["executions"], p["blocked_by"]) == \
           ("instructor", 0, 1, 1, [])

    assert admin.delete(f"{API}/users/{tid}").status_code == 204
    assert count(db, User, User.id == tid) == 0
    assert count(db, Workspace, Workspace.student_id == tid) == 0
    assert count(db, Execution, Execution.student_id == tid) == 0
    db.refresh(enrollment)
    assert enrollment.reviewed_by is None and enrollment.student_id == uid(db, "stu1")   # kept, reviewer cleared
    assert other.get(f"{API}/auth/me").status_code == 401
