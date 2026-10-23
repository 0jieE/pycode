"""Creates the data a load test needs: one instructor, one class with an OPEN lab session, N approved students
(load001..loadNNN, all with the same password) and a published activity in each student's workspace.

    docker compose exec api python -m loadtest.prepare_loadtest --students 120

Safe to repeat: existing accounts are kept; the session is re-opened if it was closed.
Load-test accounts stay in the database afterwards (they are prefixed `load`); `docker compose down -v` wipes everything.
"""
import argparse
import os
import sys
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, utcnow
from app.core.security import hash_password
from app.models.activity import Activity
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.lab import Lab
from app.models.lab_session import LabSession
from app.models.user import Role, User
from app.services import workspace_service

PASSWORD = os.getenv("LOAD_PASSWORD", "LoadTest#2026")
CLASS_NAME = "LOAD TEST"
ACTIVITY_TITLE = "Load Lab"
# A realistic little student program: a few milliseconds of work, a few lines of output.
MAIN_PY = ("total = sum(i * i for i in range(200_000))\n"
           "print('sum of squares:', total)\n"
           "for n in range(1, 6):\n"
           "    print('row', n, n * n)\n")


def prepare(db: Session, students: int) -> dict:
    password_hash = hash_password(PASSWORD)  # hashed once and shared: creating 120 accounts takes seconds
    teacher = db.scalar(select(User).where(User.username == "loadteacher"))
    if teacher is None:
        teacher = User(username="loadteacher", password_hash=password_hash, full_name="Load Teacher",
                       role=Role.INSTRUCTOR)
        db.add(teacher)
        db.flush()

    classroom = db.scalar(select(Classroom).where(Classroom.instructor_id == teacher.id, Classroom.name == CLASS_NAME))
    if classroom is None:
        classroom = Classroom(instructor_id=teacher.id, name=CLASS_NAME, year_and_section="LOAD", school_year="2026-2027")
        db.add(classroom)
        db.flush()

    now = utcnow()
    session = db.scalar(select(LabSession).where(LabSession.class_id == classroom.id).order_by(LabSession.id.desc()))
    if session is None:
        lab = db.scalar(select(Lab).where(Lab.name == "Load Lab"))
        if lab is None:
            lab = Lab(name="Load Lab")
            db.add(lab)
            db.flush()
        session = LabSession(class_id=classroom.id, name="Load session", starts_at=now, ends_at=now + timedelta(hours=6),
                             lab_id=lab.id)
        db.add(session)
    session.is_open, session.opened_at, session.closed_at = True, now, None
    session.ends_at = now + timedelta(hours=6)

    activity = db.scalar(select(Activity).where(Activity.class_id == classroom.id, Activity.title == ACTIVITY_TITLE))
    if activity is None:
        activity = Activity(class_id=classroom.id, title=ACTIVITY_TITLE, instructions="load test",
                            starter_files=[{"path": "main.py", "content": MAIN_PY}], is_published=True)
        db.add(activity)
    db.flush()

    created = 0
    for i in range(1, students + 1):
        username = f"load{i:03d}"
        student = db.scalar(select(User).where(User.username == username))
        if student is None:
            student = User(username=username, password_hash=password_hash, full_name=f"Load Student {i:03d}",
                           student_no=f"LOAD-{i:04d}", role=Role.STUDENT)
            db.add(student)
            db.flush()
            created += 1
        enrollment = db.scalar(select(Enrollment).where(Enrollment.class_id == classroom.id,
                                                        Enrollment.student_id == student.id))
        if enrollment is None:
            db.add(Enrollment(class_id=classroom.id, student_id=student.id, status=EnrollmentStatus.APPROVED,
                              reviewed_by=teacher.id, reviewed_at=now))
        elif enrollment.status != EnrollmentStatus.APPROVED:
            enrollment.status = EnrollmentStatus.APPROVED
        workspace = workspace_service.ensure_workspace(db, student.id, classroom.id)
        workspace_service.install_published_activities(db, workspace)
    db.commit()
    return {"class_id": classroom.id, "session_id": session.id, "students": students, "created": created,
            "password": PASSWORD}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--students", type=int, default=120)
    args = parser.parse_args()
    with SessionLocal() as db:
        info = prepare(db, args.students)
    sys.stdout.write(
        f"Load test data ready: class {info['class_id']}, open session {info['session_id']}, "
        f"{info['students']} students ({info['created']} new): load001..load{info['students']:03d}, "
        f"password from LOAD_PASSWORD (default 'LoadTest#2026').\n")


if __name__ == "__main__":
    main()
