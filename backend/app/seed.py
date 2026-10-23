"""Demo data: 1 admin, 2 instructors, 40 students, 1 class + active invite code, 1 published activity,
and one batch of 5 student registration codes.

Run:  python -m app.seed
Safe to re-run: accounts that already exist are left alone (their passwords are NOT changed).
"""
import sys
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, utcnow
from app.core.security import generate_invite_code, generate_temp_password, hash_password
from app.models.activity import Activity
from app.models.classroom import Classroom
from app.models.invite_code import InviteCode
from app.models.registration_code import RegistrationCode
from app.models.user import Role, User
from app.schemas.registration import RegistrationCodeCreate
from app.services import registration_service

STUDENT_COUNT = 40
DEMO_BATCH = "Demo batch"
DEMO_CODE_COUNT = 5


@dataclass
class SeedResult:
    # (username, role, password or None when the account already existed)
    accounts: list[tuple[str, str, Optional[str]]] = field(default_factory=list)
    invite_code: Optional[str] = None
    # plaintext codes, only when they were created by THIS run (they are stored hashed and cannot be shown again)
    registration_codes: list[str] = field(default_factory=list)
    registration_codes_existed: bool = False


def _ensure_user(db: Session, result: SeedResult, username: str, full_name: str, role: Role,
                 student_no: Optional[str] = None) -> User:
    user = db.scalar(select(User).where(User.username == username))
    if user is not None:
        result.accounts.append((username, role.value, None))
        return user
    password = generate_temp_password()
    user = User(username=username, password_hash=hash_password(password), full_name=full_name,
                role=role, student_no=student_no)
    db.add(user)
    db.flush()
    result.accounts.append((username, role.value, password))
    return user


def _ensure_demo_registration_codes(db: Session, result: SeedResult, admin: User) -> None:
    """One batch of demo sign-up codes. Codes are stored hashed, so an existing batch cannot be printed again:
    re-running the seed leaves it alone (revoke it in the admin API to get a fresh one)."""
    if db.scalar(select(RegistrationCode.id).where(RegistrationCode.batch_name == DEMO_BATCH).limit(1)) is not None:
        result.registration_codes_existed = True
        return
    created = registration_service.create_codes(
        db, admin, RegistrationCodeCreate(count=DEMO_CODE_COUNT, batch_name=DEMO_BATCH), ip=None)
    result.registration_codes = created.codes


def seed(db: Session) -> SeedResult:
    result = SeedResult()
    admin = _ensure_user(db, result, "admin", "System Administrator", Role.ADMIN)
    instructor = _ensure_user(db, result, "instructor1", "Instructor One", Role.INSTRUCTOR)
    _ensure_user(db, result, "instructor2", "Instructor Two", Role.INSTRUCTOR)
    for i in range(1, STUDENT_COUNT + 1):
        _ensure_user(db, result, f"student{i:02d}", f"Student {i:02d}", Role.STUDENT,
                     student_no=f"2026-{i:04d}")

    classroom = db.scalar(select(Classroom).where(Classroom.instructor_id == instructor.id))
    if classroom is None:
        classroom = Classroom(instructor_id=instructor.id, name="Introduction to Programming",
                              year_and_section="BSIT 1A", school_year="2026-2027")
        db.add(classroom)
        db.flush()

    code = db.scalar(select(InviteCode).where(InviteCode.class_id == classroom.id))
    if code is None:
        now = utcnow()
        code = InviteCode(class_id=classroom.id, code=generate_invite_code(),
                          valid_from=now, valid_until=now + timedelta(days=30), is_active=True)
        db.add(code)
    result.invite_code = code.code

    if db.scalar(select(Activity).where(Activity.class_id == classroom.id)) is None:
        db.add(Activity(
            class_id=classroom.id,
            title="Hello World",
            instructions="Run main.py, then change it to greet your own name.",
            starter_files=[
                {"path": "main.py",
                 "content": "from helpers import greet\n\nname = input('Your name: ')\nprint(greet(name))\n"},
                {"path": "helpers.py", "content": "def greet(name):\n    return 'Hello, ' + name + '!'\n"},
            ],
            due_at=utcnow() + timedelta(days=7),
            is_published=True,
        ))
    db.commit()
    _ensure_demo_registration_codes(db, result, admin)
    return result


def main() -> None:
    from app import tutorial_content

    with SessionLocal() as db:
        result = seed(db)
        lessons = tutorial_content.load_all(db)   # the tutorial's default lessons (idempotent, by slug)
    out = sys.stdout
    out.write("\nSeed complete.\n\n")
    out.write(f"Tutorial lessons: {len(lessons.created)} created, {len(lessons.updated)} updated.\n\n")
    out.write(f"{'USERNAME':<14}{'ROLE':<12}PASSWORD\n")
    for username, role, password in result.accounts:
        out.write(f"{username:<14}{role:<12}{password or '(already existed - unchanged)'}\n")
    out.write(f"\nInvite code for 'Introduction to Programming': {result.invite_code}\n")
    if result.registration_codes:
        out.write(f"\nStudent registration codes ('{DEMO_BATCH}', one use each; shown ONLY now):\n")
        for code in result.registration_codes:
            out.write(f"  {code}\n")
    elif result.registration_codes_existed:
        out.write(f"\nRegistration codes: batch '{DEMO_BATCH}' already exists (codes are shown only once).\n")


if __name__ == "__main__":
    main()
