"""Accounts for the frontend's Playwright tests, in the SEPARATE e2e stack (docker-compose.e2e.yml):

    docker compose -f docker-compose.yml -f docker-compose.e2e.yml exec api python -m app.e2e_seed

Creates (or resets) admin, instructor1, instructor2 and student01-student29 ("Instructor One", "Student 01", ...)
with NEW random passwords on every run, makes sure the labs "E2E Lab 1" and "E2E Lab 2" exist (every lab session
needs a lab), loads the tutorial lessons, and writes backend/e2e_credentials.txt as
"username  role  password" lines (plus the labs' ids). Every other row of the e2e database is left alone.

It refuses to run unless E2E=1 (set only by docker-compose.e2e.yml): in the main stack it would reset the demo's
`admin` password.
"""
import os
import sys
from pathlib import Path

from sqlalchemy import select

from app import tutorial_content
from app.core.database import SessionLocal
from app.core.security import generate_temp_password, hash_password
from app.models.lab import Lab
from app.models.user import Role, User

CREDENTIALS = Path(__file__).resolve().parent.parent / "e2e_credentials.txt"

ACCOUNTS = [("admin", "System Administrator", Role.ADMIN),
            ("instructor1", "Instructor One", Role.INSTRUCTOR),
            ("instructor2", "Instructor Two", Role.INSTRUCTOR),
            *[(f"student{n:02d}", f"Student {n:02d}", Role.STUDENT) for n in range(1, 30)]]
LABS = ["E2E Lab 1", "E2E Lab 2"]


def ensure_labs(db) -> list[Lab]:
    """The e2e labs, created when missing (an existing one is left as the tests changed it)."""
    labs = []
    for name in LABS:
        lab = db.scalar(select(Lab).where(Lab.name == name))
        if lab is None:
            lab = Lab(name=name)
            db.add(lab)
        labs.append(lab)
    db.flush()
    return labs


def main() -> int:
    if os.environ.get("E2E") != "1":
        print("Refusing to run: this resets the passwords of admin, instructor1, ... and is meant for the e2e stack "
              "only.\n  docker compose -f docker-compose.yml -f docker-compose.e2e.yml exec api python -m app.e2e_seed",
              file=sys.stderr)
        return 2
    lines = ["# E2E test accounts (written by app.e2e_seed; new passwords on every run). Not for the demo.",
             f"{'USERNAME':<14}{'ROLE':<12}PASSWORD"]
    with SessionLocal() as db:
        for username, full_name, role in ACCOUNTS:
            password = generate_temp_password()
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                user = User(username=username, role=role)
                db.add(user)
            # a known, usable state: active, not locked behind a temporary password, signed out everywhere
            user.full_name, user.role, user.password_hash = full_name, role, hash_password(password)
            user.is_active, user.must_change_password, user.current_session_id = True, False, None
            if role == Role.STUDENT:
                user.student_no = user.student_no or f"E2E-{username[-2:]}"
            lines.append(f"{username:<14}{role.value:<12}{password}")
        labs = ensure_labs(db)
        lines.append("# Labs (lab_id for new sessions): " + ", ".join(f"{lab.name} = {lab.id}" for lab in labs))
        db.commit()
        lessons = tutorial_content.load_all(db)
    CREDENTIALS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(ACCOUNTS)} accounts and {len(LABS)} labs ready, "
          f"{len(lessons.created) + len(lessons.updated)} tutorial lessons loaded.")
    print(f"Credentials: {CREDENTIALS.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
