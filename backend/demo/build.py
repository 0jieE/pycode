"""Replaces EVERYTHING in the database with demo data for a presentation.

    docker compose exec worker python -m demo.build --yes     (the worker: grading needs the Docker socket)

What it makes (first semester of SY 2026-2027, classes from 10 August 2026; "today" is the day it runs, or --today):
  * 1 admin, 3 instructors, 130 BSIT students in 5 sections (1A, 1B, 1C, 2A, 2B; 26 each), 6 irregular students and
    2 late enrollees who signed up with a registration code (still waiting for approval)
  * 15 classes, 5 per instructor: every section takes the 3 courses of its year (demo/content.py)
  * per class: an active invite code (and an expired one), approved students, a few pending / rejected requests,
    3 published activities with 4 test cases each, a weekly 3-hour lab session up to today and 2 upcoming ones
  * every student submitted every activity (a few late), graded by the real engine; their workspace holds the work,
    with saved versions of main.py for some
  * two computer labs (named rooms the sessions book)
  * the logs: sessions opening and closing themselves (some by hand, some extended), every sign-in of each session
    (failed passwords, a shared account signed out of its first PC), runs (interactive and batch) and Test, Practice
    runs, logouts, first-login password changes, an admin password reset, a deactivated account, storage limits (and
    one student's own), a cleared Practice workspace, tutorial progress and an edited lesson: a complete audit trail
The passwords are random and written to seed_credentials.txt (and printed).

Before anything is deleted, every version of every activity (correct / partial / wrong) is graded in the real sandbox;
if a correct solution fails, nothing is touched.
"""
import argparse
import random
import secrets
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import tutorial_content
from app.core.database import SessionLocal, engine
from app.core.redis import get_redis
from app.core.security import generate_invite_code, generate_registration_code, generate_temp_password, hash_password
from app.models.activity import Activity
from app.models.activity_log import ActivityLog
from app.models.classroom import Classroom
from app.models.enrollment import Enrollment, EnrollmentStatus
from app.models.execution import Execution, ExecutionKind, ExecutionMode, ExecutionStatus
from app.models.invite_code import InviteCode
from app.models.lab import Lab, LoginEvent, LoginOutcome
from app.models.lab_session import LabSession
from app.models.registration_code import RegistrationCode
from app.models.storage import StorageLimit
from app.models.submission import Submission, SubmissionFile, SubmissionStatus
from app.models.test_case import MatchMode, TestCase
from app.models.tutorial import TutorialLesson, TutorialProgress
from app.models.user import Role, User
from app.models.workspace import FileVersion, Workspace, WorkspaceFile
from app.services import grading_service
from app.services.registration_service import hash_registration_code
from demo.content import COURSES

SCHOOL_YEAR = "2026-2027"
SEMESTER_START = datetime(2026, 8, 10)          # a Monday (Philippine time)
NOW_PH = datetime(2026, 10, 14, 9, 0)           # "today" for the timeline: set in main() (the real day, or --today)
PH = timedelta(hours=8)                         # the database stores UTC
CREDENTIALS = Path(__file__).resolve().parent.parent / "seed_credentials.txt"
LATE_BATCH = "BSIT late enrollees"

FIRST = ["Juan", "Maria", "Jose", "Ana", "Mark", "Angel", "John", "Kristine", "Paolo", "Patricia", "Carlo", "Nicole",
         "Miguel", "Andrea", "Rafael", "Camille", "Gabriel", "Bea", "Joshua", "Jasmine", "Christian", "Princess",
         "Kenneth", "Hannah", "Daniel", "Sofia", "Adrian", "Isabel", "Vincent", "Clarisse", "Ramon", "Liza", "Jerome",
         "Shiela", "Neil", "Trisha", "Aldrin", "Mae", "Rey", "Joy", "Dominic", "Faith", "Ivan", "Grace", "Lance",
         "Diane", "Renz", "Ella", "Jericho", "Rica"]
LAST = ["Dela Cruz", "Santos", "Reyes", "Garcia", "Mendoza", "Torres", "Flores", "Gonzales", "Bautista", "Villanueva",
        "Ramos", "Aquino", "Castillo", "Rivera", "Navarro", "Salazar", "Mercado", "Domingo", "Gutierrez", "Pascual",
        "Soriano", "Tolentino", "Manalo", "Fernandez", "Morales", "Valdez", "Lopez", "Cruz", "Alvarez", "Padilla",
        "Panganiban", "Macaraeg", "Dimaculangan", "Sarmiento", "Ocampo", "Rosales", "Lacson", "Abad", "Cabrera", "Sison"]
INSTRUCTORS = [("Prof. Elena Marquez", "elena.marquez"), ("Prof. Roberto Villafuerte", "roberto.villafuerte"),
               ("Prof. Teresa Cabanero", "teresa.cabanero")]
# section -> (year, instructor index per course of that year)
SECTIONS = {"1A": 1, "1B": 1, "1C": 1, "2A": 2, "2B": 2}
STUDENTS_PER_SECTION = 26
# (course code, section) -> instructor index: 5 classes each
TEACHES = {
    ("CC 101", "1A"): 0, ("CC 101", "1B"): 0, ("CC 101", "1C"): 0, ("IT 102", "1A"): 0, ("IT 102", "1B"): 0,
    ("IT 101", "1A"): 1, ("IT 101", "1B"): 1, ("IT 101", "1C"): 1, ("CC 104", "2A"): 1, ("CC 104", "2B"): 1,
    ("IT 102", "1C"): 2, ("IT 201", "2A"): 2, ("IT 201", "2B"): 2, ("IT 202", "2A"): 2, ("IT 202", "2B"): 2,
}
# weekday (0 = Monday) and start hour (PH) of each class's weekly 3-hour lab
SLOTS = [(0, 8), (0, 13), (1, 8), (1, 13), (2, 8), (2, 13), (3, 8), (3, 13), (4, 8), (4, 13), (0, 16), (1, 16),
         (2, 16), (3, 16), (4, 16)]
PRACTICE_SNIPPETS = {
    "hello.py": 'print("Hello from my practice workspace")\n',
    "guess.py": 'import random\n\nsecret = random.randint(1, 10)\nguess = int(input("Guess 1-10: "))\n'
                'print("Correct!" if guess == secret else f"No, it was {secret}")\n',
    "temperature.py": 'c = float(input("Celsius: "))\nprint(f"{c * 9 / 5 + 32:.1f} F")\n',
    "multiplication.py": 'for i in range(1, 11):\n    print(" ".join(f"{i * j:3}" for j in range(1, 11)))\n',
    "notes.md": "# My notes\n\n- input() always returns text\n- use int() to convert\n",
    "list_practice.py": 'fruits = ["mango", "banana", "apple"]\nfruits.sort()\nprint(fruits)\n',
}
# what a practice run of each snippet printed (interactive ones: the prompt, the typed answer, the result)
PRACTICE_OUTPUT = {
    "hello.py": ("Hello from my practice workspace\n", None),
    "guess.py": ("Guess 1-10: 7\nNo, it was 3\n", "7"),
    "temperature.py": ("Celsius: 37\n98.6 F\n", "37"),
    "multiplication.py": ("".join(" ".join(f"{i * j:3}" for j in range(1, 11)) + "\n" for i in range(1, 11)), None),
    "list_practice.py": ("['apple', 'banana', 'mango']\n", None),
}
STAFF_IP = "10.10.0.15"                         # the faculty room
LAPTOP_NET = "10.10.50."                        # students' own laptops on the school Wi-Fi
UA_LAB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
UA_STAFF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Edg/129.0"
UA_LAPTOPS = ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/17.6",
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"]


def utc(ph: datetime) -> datetime:
    return ph - PH


def ascii_slug(text_: str) -> str:
    plain = unicodedata.normalize("NFKD", text_).encode("ascii", "ignore").decode()
    return "".join(ch for ch in plain.lower() if ch.isalnum())


# =========================================================================== grading the versions

def grade_all() -> dict:
    """(course index, activity index, version) -> (results rows with case ids 1..4, Summary). Real sandbox runs."""
    from app.worker.sandbox import run_in_sandbox

    jobs = []
    for ci, course in enumerate(COURSES):
        for ai, act in enumerate(course["activities"]):
            for version, overrides in act["versions"].items():
                jobs.append((ci, ai, version, {**act["starter"], **overrides}, act))

    def run(job):
        ci, ai, version, files, act = job
        folder = act["title"]
        cases = [grading_service.CaseData(id=i, name=t_["name"], stdin=t_["stdin"], expected=t_["expected_output"],
                                          is_hidden=t_["is_hidden"], points=t_["points"],
                                          match_mode=MatchMode(t_["match_mode"]), require_input_read=True)
                 for i, t_ in enumerate(act["tests"], start=1)]
        nonce = secrets.token_hex(16)
        result = run_in_sandbox([{"path": f"{folder}/{p}", "content": c, "is_folder": False} for p, c in files.items()],
                                f"{folder}/main.py", tests=[{"id": c.id, "stdin": c.stdin} for c in cases], nonce=nonce,
                                ignore_input_prompts=True, timeout_sec=grading_service.overall_timeout(len(cases)))
        parsed = grading_service.parse_block(result.output, nonce)
        if parsed is None:
            raise SystemExit(f"sandbox gave no result for {folder} ({version}): {result.status}")
        return (ci, ai, version), grading_service.build_results(cases, parsed)

    with ThreadPoolExecutor(max_workers=6) as pool:
        graded = dict(pool.map(run, jobs))

    print(f"{'activity':<42}{'correct':>9}{'partial':>9}{'wrong':>7}")
    for ci, course in enumerate(COURSES):
        for ai, act in enumerate(course["activities"]):
            scores = {v: graded[(ci, ai, v)][1] for v in ("correct", "partial", "wrong")}
            print(f"{course['code'] + ' ' + act['title']:<42}"
                  + "".join(f"{f'{s.score}/{s.max_score}':>9}" for s in scores.values()))
            if scores["correct"].passed != scores["correct"].total:
                failed = [r["name"] for r in graded[(ci, ai, "correct")][0] if not r["passed"]]
                raise SystemExit(f"ABORTED, nothing changed: the correct version of {act['title']} fails {failed}")
    return graded


# ================================================================================ wiping

def wipe() -> None:
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in conn.execute(text("SHOW TABLES")).scalars().all():
            if table != "alembic_version":
                conn.execute(text(f"TRUNCATE TABLE `{table}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
    r = get_redis()
    # (active:* / seat_users:* / last_loc:* / last_ip:* are left over from the removed seat map)
    for pattern in ("active:*", "active_users:*", "seat_users:*", "last_loc:*", "last_ip:*", "online:*",
                    "run:cooldown:*", "exec_stop:*", "exec_in_count:*", "pwchange:attempts:*"):
        for key in r.scan_iter(pattern):
            r.delete(key)


# ================================================================================ building

class Builder:
    def __init__(self, db: Session, graded: dict, seed: int) -> None:
        self.db, self.graded, self.rng = db, graded, random.Random(seed)
        self.credentials: list[tuple[str, str, str, str]] = []   # (group, username, full name, password)
        self.usernames: set[str] = set()
        self.audit: list[ActivityLog] = []
        self.events: list[LoginEvent] = []
        self.signed_in_once: set[int] = set()

    # ------------------------------------------------------------------ helpers
    def log(self, when: datetime, action: str, user_id, ip=None, **details) -> None:
        self.audit.append(ActivityLog(user_id=user_id, action=action, details=details or None, ip_address=ip,
                                      created_at=when, updated_at=when))

    def user(self, role: Role, full_name: str, username: str, group: str, student_no=None, when=None) -> User:
        base, n = username, 1
        while username in self.usernames:
            n += 1
            username = f"{base}{n}"
        self.usernames.add(username)
        password = generate_temp_password()
        when = when or utc(SEMESTER_START - timedelta(days=20))
        u = User(username=username, password_hash=hash_password(password), full_name=full_name, role=role,
                 student_no=student_no, is_active=True, created_at=when, updated_at=when)
        if self.rng.random() < 0.2:
            u.preferences = {"theme": self.rng.choice(["light", "system"]), "editor_theme": "match"}
        self.db.add(u)
        self.credentials.append((group, username, full_name, password))
        return u

    def person(self) -> tuple[str, str]:
        first, last = self.rng.choice(FIRST), self.rng.choice(LAST)
        return f"{first} {last}", f"{ascii_slug(first)}.{ascii_slug(last)}"

    def sign_in(self, user: User, at: datetime, ip: str, session=None, outcome=LoginOutcome.SUCCESS,
                ua=UA_LAB) -> None:
        """A login_events row and the audit row the API writes (the address goes to the audit log only). A student's
        very first sign-in is followed by the change of the temporary password."""
        self.events.append(LoginEvent(user_id=user.id, user_agent=ua, lab_session_id=session.id if session else None,
                                      outcome=outcome, created_at=at))
        self.log(at, "login", user.id, ip=ip)
        if user.id not in self.signed_in_once:
            self.signed_in_once.add(user.id)
            if user.role == Role.STUDENT:
                self.log(at + timedelta(minutes=1, seconds=self.rng.randint(5, 50)), "password_change", user.id, ip=ip)

    # ------------------------------------------------------------------ people
    def people(self) -> None:
        self.admin = self.user(Role.ADMIN, "System Administrator", "admin", "Admin")
        self.instructors = [self.user(Role.INSTRUCTOR, name, username, "Instructors") for name, username in INSTRUCTORS]
        self.sections: dict[str, list[User]] = {}
        number = {1: 1, 2: 1}
        for section, year in SECTIONS.items():
            members = []
            for _ in range(STUDENTS_PER_SECTION):
                name, username = self.person()
                prefix = "2026" if year == 1 else "2025"
                members.append(self.user(Role.STUDENT, name, username, f"Students BSIT {section}",
                                         student_no=f"{prefix}-{number[year]:05d}"))
                number[year] += 1
            self.sections[section] = members
        self.irregulars = []
        for _ in range(6):
            name, username = self.person()
            self.irregulars.append(self.user(Role.STUDENT, name, username, "Students (irregular)",
                                             student_no=f"2024-{number[1] + 900:05d}"))
            number[1] += 1
        # two late enrollees signed themselves up with a registration code a few days ago
        self.late = []
        for k in range(2):
            name, username = self.person()
            joined = utc(NOW_PH - timedelta(days=3 - k, hours=self.rng.randint(1, 5)))
            self.late.append(self.user(Role.STUDENT, name, username, "Students (signed up with a code)",
                                       student_no=f"2026-{number[1]:05d}", when=joined))
            number[1] += 1
        self.db.flush()
        created = utc(SEMESTER_START - timedelta(days=20))
        for u in [self.admin, *self.instructors]:
            self.log(created, "user_create", self.admin.id, ip=STAFF_IP, target_id=u.id, username=u.username,
                     role=u.role.value)
        self.log(created + timedelta(minutes=20), "user_import", self.admin.id, ip=STAFF_IP,
                 created=sum(len(m) for m in self.sections.values()), skipped=0)
        for u in self.irregulars:
            self.log(created + timedelta(days=2), "user_create", self.admin.id, ip=STAFF_IP, target_id=u.id,
                     username=u.username, role=u.role.value)
        # sign-up codes for late enrollees (shown only here, stored hashed); two were used, the rest are unused
        self.registration_codes = []
        expires = utc(datetime(2026, 12, 19, 23, 59))
        generated = utc(NOW_PH - timedelta(days=9))
        for _ in range(10 - len(self.late)):
            code = generate_registration_code()
            self.registration_codes.append(f"{code[:5]}-{code[5:]}")
            self.db.add(RegistrationCode(code_hash=hash_registration_code(code), code_hint=code[-4:],
                                         batch_name=LATE_BATCH, expires_at=expires, created_by=self.admin.id,
                                         created_at=generated, updated_at=generated))
        self.log(generated, "registration_codes_generate", self.admin.id, ip=STAFF_IP, count=10, batch=LATE_BATCH)
        for u in self.late:
            ip = f"{LAPTOP_NET}{self.rng.randint(20, 200)}"
            self.log(u.created_at, "register", u.id, ip=ip, batch=LATE_BATCH)
            self.signed_in_once.add(u.id)       # they chose their own password when signing up
            self.sign_in(u, u.created_at + timedelta(seconds=2), ip, ua=self.rng.choice(UA_LAPTOPS))

    # ------------------------------------------------------------------ labs
    def labs(self) -> None:
        """Two computer labs: named rooms that the sessions book (first years in Lab 1, second years in Lab 2)."""
        self.lab_rooms = {}
        setup = utc(SEMESTER_START - timedelta(days=7))
        for year, name in {1: "Computer Laboratory 1", 2: "Computer Laboratory 2"}.items():
            lab = Lab(name=name, created_at=setup, updated_at=setup)
            self.db.add(lab)
            self.db.flush()
            self.lab_rooms[year] = lab
            self.log(setup + timedelta(minutes=year), "lab_change", self.admin.id, ip=STAFF_IP, op="create",
                     lab_id=lab.id)

    # ------------------------------------------------------------------ classes
    def classes(self) -> None:
        self.class_info = []   # dicts: classroom, course index, section, instructor, students, sessions, activities
        slot = 0
        for (code, section), teacher_index in TEACHES.items():
            ci = next(i for i, c in enumerate(COURSES) if c["code"] == code)
            course, teacher = COURSES[ci], self.instructors[teacher_index]
            created = utc(SEMESTER_START - timedelta(days=10, hours=slot))
            klass = Classroom(instructor_id=teacher.id, name=f"{code} {course['name']}",
                              year_and_section=f"BSIT {section}", school_year=SCHOOL_YEAR, is_archived=False,
                              tutorial_unlock_in_order=code == "CC 101", created_at=created, updated_at=created)
            self.db.add(klass)
            self.db.flush()
            self.log(created, "class_create", teacher.id, ip=STAFF_IP, class_id=klass.id)
            self.class_info.append({"class": klass, "ci": ci, "section": section, "teacher": teacher,
                                    "year": course["year"], "slot": SLOTS[slot]})
            slot += 1

    def enrollments(self) -> None:
        for n, info in enumerate(self.class_info):
            klass, teacher = info["class"], info["teacher"]
            start = utc(SEMESTER_START - timedelta(days=7))
            expired = InviteCode(class_id=klass.id, code=generate_invite_code(), valid_from=start - timedelta(days=14),
                                 valid_until=start - timedelta(days=1), is_active=False, max_uses=40, use_count=0,
                                 created_at=start - timedelta(days=14), updated_at=start - timedelta(days=1))
            active = InviteCode(class_id=klass.id, code=generate_invite_code(), valid_from=start,
                                valid_until=utc(datetime(2026, 12, 19, 23, 59)), is_active=True, max_uses=None,
                                use_count=0, created_at=start, updated_at=start)
            self.db.add_all([expired, active])
            self.db.flush()
            info["invite"] = active
            self.log(start - timedelta(days=14), "invite_code_create", teacher.id, ip=STAFF_IP, class_id=klass.id,
                     invite_code_id=expired.id)
            self.log(start - timedelta(days=1), "invite_code_update", teacher.id, ip=STAFF_IP,
                     invite_code_id=expired.id, fields=["is_active"])
            self.log(start, "invite_code_create", teacher.id, ip=STAFF_IP, class_id=klass.id, invite_code_id=active.id)
            students = list(self.sections[info["section"]])
            # irregular students: one approved here and there, others still waiting or turned down
            extra_pending, extra_rejected = [], []
            for k, irr in enumerate(self.irregulars):
                pick = (k + klass.id) % 7
                if pick == 0:
                    students.append(irr)
                elif pick == 1:
                    extra_pending.append(irr)
                elif pick == 2 and info["year"] == 2:
                    extra_rejected.append(irr)
            rows = []   # (enrollment, asked, reviewed or None, action or None)
            for s in students:
                asked = start + timedelta(hours=self.rng.randint(1, 72))
                reviewed = asked + timedelta(hours=self.rng.randint(1, 24))
                rows.append((Enrollment(class_id=klass.id, student_id=s.id, status=EnrollmentStatus.APPROVED,
                                        invite_code_id=active.id, reviewed_by=teacher.id, reviewed_at=reviewed,
                                        created_at=asked, updated_at=reviewed), asked, reviewed, "enrollment_approve"))
            for s in extra_pending:
                asked = utc(NOW_PH - timedelta(days=self.rng.randint(1, 4), hours=self.rng.randint(0, 6)))
                rows.append((Enrollment(class_id=klass.id, student_id=s.id, status=EnrollmentStatus.PENDING,
                                        invite_code_id=active.id, created_at=asked, updated_at=asked), asked, None, None))
            if n in (0, 5):   # the late enrollees asked to join a first-year class right after signing up
                for s in self.late:
                    asked = s.created_at + timedelta(minutes=self.rng.randint(3, 15) + 30 * (n == 5))
                    rows.append((Enrollment(class_id=klass.id, student_id=s.id, status=EnrollmentStatus.PENDING,
                                            invite_code_id=active.id, created_at=asked, updated_at=asked),
                                 asked, None, None))
            for s in extra_rejected:
                asked = start + timedelta(days=3)
                rows.append((Enrollment(class_id=klass.id, student_id=s.id, status=EnrollmentStatus.REJECTED,
                                        invite_code_id=active.id, reviewed_by=teacher.id,
                                        reviewed_at=asked + timedelta(hours=5), created_at=asked,
                                        updated_at=asked + timedelta(hours=5)), asked, asked + timedelta(hours=5),
                             "enrollment_reject"))
            self.db.add_all(r[0] for r in rows)
            self.db.flush()
            for e, asked, reviewed, action in rows:
                self.log(asked, "enroll_request", e.student_id, class_id=klass.id, invite_code_id=active.id)
                if action:
                    self.log(reviewed, action, teacher.id, ip=STAFF_IP, enrollment_id=e.id, class_id=klass.id,
                             student_id=e.student_id)
            active.use_count = len(rows)
            info["students"] = students
        self.db.flush()

    def pcs(self) -> None:
        """Each student's usual lab PC address, for the audit log (it records the address of every request)."""
        for info in self.class_info:
            subnet = info["year"]
            info["pc"] = {st.id: f"10.10.{subnet}.{1 + i % 29}" for i, st in enumerate(info["students"])}

    def sessions(self) -> None:
        """Weekly 3-hour sessions up to today, then 2 upcoming. Most opened and closed themselves on schedule; some
        instructors opened a few minutes early or closed early, and some 8 AM classes were extended by 30 minutes."""
        for info in self.class_info:
            weekday, hour = info["slot"]
            lab = self.lab_rooms[info["year"]]
            teacher, klass = info["teacher"], info["class"]
            info["sessions"] = []
            week = 0
            created = utc(SEMESTER_START - timedelta(days=5))
            while True:
                starts_ph = SEMESTER_START + timedelta(days=7 * week + weekday, hours=hour)
                past = starts_ph + timedelta(hours=3) <= NOW_PH
                if not past and sum(1 for s in info["sessions"] if s.ends_at > utc(NOW_PH)) >= 2:
                    break
                s = LabSession(class_id=klass.id, name=f"Week {week + 1}", starts_at=utc(starts_ph),
                               ends_at=utc(starts_ph + timedelta(hours=3)), is_open=False, lab_id=lab.id,
                               created_at=created, updated_at=created)
                self.db.add(s)
                info["sessions"].append(s)
                week += 1
            self.db.flush()

            for week, s in enumerate(info["sessions"]):
                self.log(created + timedelta(seconds=week * 4), "session_create", teacher.id, ip=STAFF_IP,
                         class_id=klass.id, session_id=s.id)
                if s.ends_at > utc(NOW_PH):
                    continue
                # extended: an 8 AM class (nothing follows it in the lab until 1 PM) ran 30 minutes longer
                if hour == 8 and week in (3, 7) and klass.id % 2 == 0:
                    self.log(s.ends_at - timedelta(minutes=12), "session_update", teacher.id, ip=STAFF_IP,
                             class_id=klass.id, session_id=s.id, fields=["ends_at"])
                    s.ends_at += timedelta(minutes=30)
                if self.rng.random() < 0.2:           # opened by hand a few minutes early
                    s.opened_at = s.starts_at - timedelta(minutes=self.rng.randint(3, 14), seconds=self.rng.randint(0, 59))
                    self.log(s.opened_at, "session_open", teacher.id, ip=STAFF_IP, class_id=klass.id, session_id=s.id)
                else:                                 # opened itself at its start (the scheduler runs every 15 s)
                    s.opened_at = s.starts_at + timedelta(seconds=self.rng.randint(1, 14))
                    self.log(s.opened_at, "session_open", None, class_id=klass.id, session_id=s.id,
                             reason="scheduled_start")
                if self.rng.random() < 0.25:          # closed by hand when everyone was done
                    s.closed_at = s.ends_at - timedelta(minutes=self.rng.randint(5, 25), seconds=self.rng.randint(0, 59))
                    self.log(s.closed_at, "session_close", teacher.id, ip=STAFF_IP, class_id=klass.id,
                             session_id=s.id)
                else:
                    s.closed_at = s.ends_at + timedelta(seconds=self.rng.randint(1, 14))
                    self.log(s.closed_at, "session_close", None, class_id=klass.id, session_id=s.id,
                             reason="scheduled_end")

    # ------------------------------------------------------------------ activities and work
    def activities(self) -> None:
        for info in self.class_info:
            course = COURSES[info["ci"]]
            teacher = info["teacher"]
            info["activities"] = []
            past = [s for s in info["sessions"] if s.opened_at]
            for ai, spec in enumerate(course["activities"]):
                publish_session, work_session = past[1 + 2 * ai], past[2 + 2 * ai]
                published = publish_session.starts_at + timedelta(minutes=15)
                due = utc((publish_session.starts_at + PH).replace(hour=23, minute=59) + timedelta(days=7))
                created = published - timedelta(days=3)
                activity = Activity(class_id=info["class"].id, title=spec["title"], instructions=spec["instructions"],
                                    starter_files=[{"path": p, "content": c} for p, c in spec["starter"].items()],
                                    due_at=due, is_published=True, is_archived=False, entry_file="main.py",
                                    ignore_input_prompts=True, created_at=created, updated_at=published)
                self.db.add(activity)
                self.db.flush()
                cases = []
                for order, t_ in enumerate(spec["tests"]):
                    case = TestCase(activity_id=activity.id, name=t_["name"], stdin=t_["stdin"],
                                    expected_output=t_["expected_output"], is_hidden=t_["is_hidden"],
                                    points=t_["points"], match_mode=MatchMode(t_["match_mode"]), sort_order=order,
                                    created_at=published - timedelta(days=2), updated_at=published - timedelta(days=2))
                    cases.append(case)
                self.db.add_all(cases)
                self.db.flush()
                self.log(created, "activity_create", teacher.id, ip=STAFF_IP, activity_id=activity.id)
                for k, case in enumerate(cases):
                    self.log(published - timedelta(days=2) + timedelta(minutes=3 * k), "test_case_change", teacher.id,
                             ip=STAFF_IP, op="create", activity_id=activity.id, case_id=case.id)
                if self.rng.random() < 0.5:           # instructions polished the day before
                    self.log(published - timedelta(days=1, hours=self.rng.randint(1, 6)), "activity_update",
                             teacher.id, ip=STAFF_IP, activity_id=activity.id, fields=["instructions"])
                self.log(published, "activity_publish", teacher.id, ip=STAFF_IP, activity_id=activity.id,
                         students=len(info["students"]))
                info["activities"].append({"activity": activity, "ai": ai, "spec": spec, "cases": cases,
                                           "published": published, "due": due, "work_session": work_session,
                                           "publish_session": publish_session})

    def version_for(self, ability: float) -> str:
        roll = self.rng.random()
        if roll < 0.45 + 0.45 * ability:
            return "correct"
        return "partial" if roll < 0.92 else "wrong"

    def results_for(self, info: dict, act: dict, version: str) -> tuple[list[dict], object]:
        rows, summary = self.graded[(info["ci"], act["ai"], version)]
        ids = [c.id for c in act["cases"]]
        return [{**r, "case_id": ids[r["case_id"] - 1]} for r in rows], summary

    def work(self) -> None:
        ability = {}
        for info in self.class_info:
            klass = info["class"]
            runs: list[tuple[Execution, dict]] = []      # executions to audit once they have ids
            history: list[tuple[WorkspaceFile, list]] = []  # main.py files with their earlier saved versions
            for student in info["students"]:
                ability.setdefault(student.id, self.rng.random())
                ws = Workspace(student_id=student.id, class_id=klass.id, created_at=info["sessions"][0].starts_at,
                               updated_at=info["sessions"][0].starts_at)
                self.db.add(ws)
                self.db.flush()
                files = []
                if self.rng.random() < 0.3:
                    created = info["sessions"][0].starts_at + timedelta(minutes=30)
                    content = 'print("testing the editor")\n'
                    files.append(WorkspaceFile(workspace_id=ws.id, path="scratch.py", is_folder=False, content=content,
                                               size_bytes=len(content), created_at=created,
                                               updated_at=created + timedelta(minutes=4)))
                for act in info["activities"]:
                    self._student_activity(info, student, ws, act, ability[student.id], files, runs, history)
                self.db.add_all(files)
            self.db.flush()
            for execution, details in runs:
                self.log(execution.queued_at, "run", execution.student_id, ip=details.pop("_ip"),
                         execution_id=execution.id, entry=execution.entry_path, **details)
            versions = 0
            for file, saves in history:
                for content, at in saves:
                    self.db.add(FileVersion(file_id=file.id, content=content, saved_at=at))
                    versions += 1
            print(f"  {klass.name} {klass.year_and_section}: {len(info['students'])} students, "
                  f"{len(runs)} runs/tests, {versions} saved versions")

    def _student_activity(self, info, student, ws, act, ability, files, runs, history) -> None:
        spec, activity = act["spec"], act["activity"]
        version = self.version_for(ability)
        content = {**spec["starter"], **spec["versions"][version]}
        folder = spec["title"]
        work = act["work_session"]
        pc = info["pc"][student.id]
        installed = act["published"] + timedelta(seconds=self.rng.randint(0, 5))
        edited = work.starts_at + timedelta(minutes=self.rng.randint(20, 150))
        files.append(WorkspaceFile(workspace_id=ws.id, path=folder, is_folder=True, size_bytes=0,
                                   created_at=installed, updated_at=installed))
        for path, text_ in content.items():
            changed = path in spec["versions"][version]
            f = WorkspaceFile(workspace_id=ws.id, path=f"{folder}/{path}", is_folder=False, content=text_,
                              size_bytes=len(text_.encode("utf-8")), created_at=installed,
                              updated_at=edited if changed else installed)
            files.append(f)
            if path == "main.py" and changed and self.rng.random() < 0.35:
                # "Save version" pressed along the way: the starter, then a half-done attempt
                saves = [(spec["starter"]["main.py"], work.starts_at + timedelta(minutes=self.rng.randint(5, 15)))]
                if version != "partial" and "partial" in spec["versions"] and self.rng.random() < 0.6:
                    saves.append((spec["versions"]["partial"].get("main.py", spec["starter"]["main.py"]),
                                  edited - timedelta(minutes=self.rng.randint(5, 18))))
                history.append((f, saves))

        # submitted after the work session, mostly before the deadline
        late = self.rng.random() < 0.08
        if late:
            submitted = act["due"] + timedelta(minutes=self.rng.randint(30, 60 * 40))
        else:   # anywhere between finishing in the lab and the deadline, most of them soon after the lab
            window = (act["due"] - timedelta(minutes=5) - edited).total_seconds()
            submitted = edited + timedelta(seconds=int(window * self.rng.random() ** 2) + 300)
        results, summary = self.results_for(info, act, version)
        sub = Submission(activity_id=activity.id, student_id=student.id, submitted_at=submitted,
                         status=SubmissionStatus.LATE if late else SubmissionStatus.SUBMITTED,
                         tests_passed=summary.passed, tests_total=summary.total, score=summary.score,
                         max_score=summary.max_score, graded_at=submitted + timedelta(seconds=self.rng.randint(4, 30)),
                         created_at=submitted, updated_at=submitted)
        self.db.add(sub)
        self.db.flush()
        self.db.add_all(SubmissionFile(submission_id=sub.id, path=f"{folder}/{p}", content=c, created_at=submitted,
                                       updated_at=submitted) for p, c in sorted(content.items()))
        in_lab = submitted < work.ends_at
        self.log(submitted, "submit", student.id, ip=pc if in_lab else f"{LAPTOP_NET}{self.rng.randint(20, 200)}",
                 activity_id=activity.id, submission_id=sub.id, files=len(content), status=sub.status.value)

        entry = f"{folder}/main.py"
        sample = spec["tests"][0]
        first = results[0]
        # a couple of runs in the work session (most interactive: the program waits at input()), then the Test
        # button, then the automatic grading of the submission
        for k in range(self.rng.randint(1, 3)):
            at = work.starts_at + timedelta(minutes=10 + 25 * k + self.rng.randint(0, 20))
            ok = first["status"] == "ok"
            interactive = self.rng.random() < 0.6
            run = Execution(student_id=student.id, workspace_id=ws.id, activity_id=activity.id,
                            lab_session_id=work.id, entry_path=entry, stdin=None if interactive else sample["stdin"],
                            output=first["actual_output"], exit_code=0 if ok else 1,
                            status=ExecutionStatus.OK if ok else ExecutionStatus.ERROR,
                            duration_ms=self.rng.randint(4000, 30000) if interactive else self.rng.randint(180, 900),
                            kind=ExecutionKind.RUN,
                            mode=ExecutionMode.INTERACTIVE if interactive else ExecutionMode.BATCH,
                            queued_at=at, started_at=at + timedelta(milliseconds=150),
                            finished_at=at + timedelta(seconds=1), created_at=at, updated_at=at)
            self.db.add(run)
            runs.append((run, {"_ip": pc, "class_id": info["class"].id,
                               "mode": "interactive" if interactive else "batch"}))
        tested = work.starts_at + timedelta(minutes=self.rng.randint(90, 170))
        test = Execution(student_id=student.id, workspace_id=ws.id, activity_id=activity.id,
                         lab_session_id=work.id, entry_path=entry, output=f"{summary.passed}/{summary.total} tests passed",
                         exit_code=0, status=ExecutionStatus.OK, duration_ms=self.rng.randint(900, 2500),
                         kind=ExecutionKind.TEST, mode=ExecutionMode.BATCH, test_results=results, queued_at=tested,
                         started_at=tested + timedelta(milliseconds=200), finished_at=tested + timedelta(seconds=2),
                         created_at=tested, updated_at=tested)
        self.db.add(test)
        runs.append((test, {"_ip": pc, "class_id": info["class"].id, "kind": "test"}))
        self.db.add(Execution(student_id=student.id, workspace_id=ws.id, activity_id=activity.id, entry_path=entry,
                              output=f"{summary.passed}/{summary.total} tests passed", exit_code=0,
                              status=ExecutionStatus.OK, duration_ms=self.rng.randint(900, 2500), kind=ExecutionKind.GRADE,
                              mode=ExecutionMode.BATCH, test_results=results, queued_at=submitted,
                              started_at=submitted + timedelta(seconds=1), finished_at=sub.graded_at,
                              created_at=submitted, updated_at=sub.graded_at))

    # ------------------------------------------------------------------ sign-ins
    def logins(self) -> None:
        """Every session: who signed in (a few mistyped passwords first), logouts, and in week 5 of each class a
        shared account: someone signed in as a classmate on another PC, which signed the classmate out. Then the
        staff's own sign-ins."""
        replaced = 0
        for info in self.class_info:
            past = [s for s in info["sessions"] if s.opened_at]
            for week, session in enumerate(past):
                present = [st for st in info["students"] if self.rng.random() >= 0.08]
                signed_in = {}
                for st in present:
                    pc = info["pc"][st.id]
                    at = session.starts_at + timedelta(minutes=self.rng.randint(-5, 25), seconds=self.rng.randint(0, 59))
                    if self.rng.random() < 0.03:        # mistyped the password first
                        self.log(at - timedelta(seconds=self.rng.randint(15, 50)), "login_failed", st.id, ip=pc,
                                 username=st.username, reason="bad_credentials")
                    self.sign_in(st, at, pc, session)
                    signed_in[st.id] = at
                    if self.rng.random() < 0.65:        # logged out at the end
                        self.log(session.closed_at - timedelta(minutes=self.rng.randint(1, 30)), "logout", st.id, ip=pc)
                if week == 4 and present:
                    victim = self.rng.choice(present)
                    other_pc = f"10.10.{info['year']}.{self.rng.randint(1, 29)}"
                    at = signed_in[victim.id] + timedelta(minutes=self.rng.randint(55, 85))
                    self.sign_in(victim, at, other_pc, session, LoginOutcome.REPLACED_OTHER_SESSION)
                    replaced += 1
        # staff sign-ins from the faculty room (one wrong password, too)
        for u in [self.admin, *self.instructors]:
            for d in range(0, 64, 2):
                at = utc(NOW_PH - timedelta(days=d, hours=self.rng.randint(1, 8), minutes=self.rng.randint(0, 59)))
                if at > utc(NOW_PH):
                    continue
                self.sign_in(u, at, STAFF_IP, ua=UA_STAFF)
                self.log(at + timedelta(hours=self.rng.randint(1, 5)), "logout", u.id, ip=STAFF_IP)
        oops = utc(NOW_PH - timedelta(days=11, hours=2))
        self.log(oops, "login_failed", self.admin.id, ip=STAFF_IP, username="admin", reason="bad_credentials")
        self.log(oops + timedelta(minutes=3), "login_failed", None, ip=f"{LAPTOP_NET}88", username="administrator",
                 reason="bad_credentials")
        self.db.add_all(self.events)
        print(f"  {len(self.events)} sign-ins ({replaced} signed another session out)")

    # ------------------------------------------------------------------ tutorial and practice
    def tutorial(self) -> None:
        tutorial_content.load_all(self.db)
        lessons = list(self.db.query(TutorialLesson).order_by(TutorialLesson.sort_order))
        everyone = [s for members in self.sections.values() for s in members] + self.irregulars
        year_of = {s.id: (1 if section.startswith("1") else 2) for section, members in self.sections.items() for s in members}
        rows = []
        for student in everyone:
            year = year_of.get(student.id, 2)
            passed = self.rng.randint(3, 12) if year == 1 else self.rng.randint(10, 25)
            day = SEMESTER_START + timedelta(days=self.rng.randint(0, 6))
            for lesson in lessons[:min(passed + 1, len(lessons))]:
                day += timedelta(days=self.rng.randint(0, 3), hours=self.rng.randint(1, 5))
                if day > NOW_PH:
                    day = NOW_PH - timedelta(hours=self.rng.randint(2, 48))
                done = lesson.sort_order <= passed
                attempts = self.rng.randint(1, 4) if done else self.rng.randint(0, 2)
                rows.append(TutorialProgress(student_id=student.id, lesson_id=lesson.id, viewed_at=utc(day),
                                             passed_at=utc(day + timedelta(minutes=self.rng.randint(5, 40))) if done else None,
                                             attempts=attempts,
                                             last_code=None if done else lesson.exercise.get("starter_code"),
                                             created_at=utc(day), updated_at=utc(day + timedelta(minutes=40))))
        self.db.add_all(rows)
        # the admin clarified two lessons during the semester
        for k, lesson in enumerate(lessons[3:5]):
            self.log(utc(SEMESTER_START + timedelta(days=12 + 9 * k, hours=10)), "tutorial_change", self.admin.id,
                     ip=STAFF_IP, op="update", slug=lesson.slug, fields=["body"])
        print(f"  tutorial: {len(lessons)} lessons, {len(rows)} progress rows")

    def practice(self) -> None:
        everyone = [s for members in self.sections.values() for s in members] + self.irregulars
        count, runs = 0, []
        for student in everyone:
            if self.rng.random() > 0.4:
                continue
            created = utc(NOW_PH - timedelta(days=self.rng.randint(3, 50)))
            ws = Workspace(student_id=student.id, class_id=None, created_at=created, updated_at=created)
            self.db.add(ws)
            self.db.flush()
            for name in self.rng.sample(sorted(PRACTICE_SNIPPETS), self.rng.randint(1, 3)):
                content = PRACTICE_SNIPPETS[name]
                saved = created + timedelta(minutes=self.rng.randint(2, 90))
                self.db.add(WorkspaceFile(workspace_id=ws.id, path=name, is_folder=False, content=content,
                                          size_bytes=len(content), created_at=created, updated_at=saved))
                if name in PRACTICE_OUTPUT:
                    output, typed = PRACTICE_OUTPUT[name]
                    for _ in range(self.rng.randint(1, 3)):
                        at = saved + timedelta(minutes=self.rng.randint(1, 30))
                        if at > utc(NOW_PH):
                            continue
                        run = Execution(student_id=student.id, workspace_id=ws.id, entry_path=name, stdin=None,
                                        output=output, exit_code=0, status=ExecutionStatus.OK,
                                        duration_ms=self.rng.randint(3000, 20000) if typed else self.rng.randint(150, 600),
                                        kind=ExecutionKind.RUN,
                                        mode=ExecutionMode.INTERACTIVE if typed else ExecutionMode.BATCH,
                                        queued_at=at, started_at=at + timedelta(milliseconds=200),
                                        finished_at=at + timedelta(seconds=2), created_at=at, updated_at=at)
                        self.db.add(run)
                        runs.append(run)
            count += 1
        self.db.flush()
        for run in runs:
            self.log(run.queued_at, "run", run.student_id, ip=f"{LAPTOP_NET}{self.rng.randint(20, 200)}",
                     execution_id=run.id, entry=run.entry_path, practice=True, mode=run.mode.value)
        print(f"  practice workspaces: {count}, {len(runs)} practice runs")

    # ------------------------------------------------------------------ admin housekeeping
    def admin_actions(self) -> None:
        """Storage limits, one student's own limit, a cleared Practice workspace, password resets, a deactivated
        account: what an admin does in a semester."""
        a = self.admin
        # storage: instructors got more room before classes started; students more files after a month
        before = utc(SEMESTER_START - timedelta(days=8, hours=-3))
        self.db.add(StorageLimit(role=Role.INSTRUCTOR, max_file_bytes=200 * 1024, max_workspace_bytes=5 * 1024 * 1024,
                                 max_files=200, updated_at=before, updated_by=a.id))
        self.log(before, "storage_limits_update", a.id, ip=STAFF_IP, role="instructor", max_file_bytes=200 * 1024,
                 max_workspace_bytes=5 * 1024 * 1024, max_files=200)
        later = utc(SEMESTER_START + timedelta(days=31, hours=14))
        self.db.add(StorageLimit(role=Role.STUDENT, max_file_bytes=100 * 1024, max_workspace_bytes=2 * 1024 * 1024,
                                 max_files=150, updated_at=later, updated_by=a.id))
        self.log(later, "storage_limits_update", a.id, ip=STAFF_IP, role="student", max_files=150)
        # an irregular student working on a bigger project gets 4 MB
        big = self.irregulars[0]
        big.storage_max_workspace_bytes = 4 * 1024 * 1024
        self.log(utc(NOW_PH - timedelta(days=16, hours=3)), "user_storage_update", a.id, ip=STAFF_IP,
                 target_user_id=big.id, max_file_bytes=None, max_workspace_bytes=4 * 1024 * 1024, max_files=None)
        # a Practice workspace full of copied files was cleared at the student's request
        messy = next(s for s in self.sections["1B"]
                     if not self.db.query(Workspace).filter_by(student_id=s.id, class_id=None).first())
        ws = Workspace(student_id=messy.id, class_id=None, created_at=utc(NOW_PH - timedelta(days=30)),
                       updated_at=utc(NOW_PH - timedelta(days=30)))
        self.db.add(ws)
        self.db.flush()
        self.log(utc(NOW_PH - timedelta(days=6, hours=2)), "workspace_clear", a.id, ip=STAFF_IP,
                 target_user_id=messy.id, workspace_id=ws.id, class_id=None, files_deleted=47,
                 bytes_deleted=1_874_112, starter_files_restored=0)
        # forgotten passwords: reset by the admin, changed by the student at the next sign-in
        for k, student in enumerate(self.rng.sample(self.sections["1A"] + self.sections["2A"], 2)):
            reset = utc(NOW_PH - timedelta(days=20 - 9 * k, hours=self.rng.randint(1, 6)))
            self.log(reset, "password_reset", a.id, ip=STAFF_IP, target_id=student.id)
            self.log(reset + timedelta(hours=self.rng.randint(1, 20)), "password_change", student.id,
                     ip=f"10.10.{1 if student in self.sections['1A'] else 2}.{self.rng.randint(1, 29)}")
        # an irregular student who dropped out (no approved class) was deactivated
        approved = {e.student_id for e in self.db.query(Enrollment).filter_by(status=EnrollmentStatus.APPROVED)}
        dropped = next((s for s in self.irregulars if s.id not in approved), None)
        if dropped is not None:
            dropped.is_active = False
            self.log(utc(NOW_PH - timedelta(days=12, hours=4)), "user_update", a.id, ip=STAFF_IP,
                     target_id=dropped.id, fields=["is_active"])
        # two instructors corrected their display name
        for teacher in self.instructors[:2]:
            self.log(utc(SEMESTER_START - timedelta(days=12, hours=self.rng.randint(1, 8))), "profile_update",
                     teacher.id, ip=STAFF_IP, fields=["full_name"])

    # ------------------------------------------------------------------ all of it
    def build(self) -> None:
        self.people()
        self.labs()
        self.classes()
        self.enrollments()
        self.pcs()
        self.sessions()
        self.activities()
        print("work and submissions:")
        self.work()
        self.logins()
        self.tutorial()
        self.practice()
        self.admin_actions()
        self.audit.sort(key=lambda row: row.created_at)
        self.db.add_all(self.audit)
        self.db.commit()
        print(f"  audit log: {len(self.audit)} entries")

    def write_credentials(self) -> str:
        lines = ["LAB MANAGEMENT SYSTEM - DEMO ACCOUNTS",
                 f"Generated by demo/build.py on {NOW_PH:%d %b %Y}. Passwords are random; keep this file private and "
                 f"delete it after the demo.",
                 "", f"{'USERNAME':<26}{'FULL NAME':<32}PASSWORD"]
        group = None
        for g, username, name, password in self.credentials:
            if g != group:
                lines += ["", f"== {g}"]
                group = g
            lines.append(f"{username:<26}{name:<32}{password}")
        lines += ["", "== Classes (invite code still active until 19 Dec 2026)"]
        for info in self.class_info:
            k = info["class"]
            lines.append(f"{k.name:<42}{k.year_and_section:<10}{info['teacher'].username:<22}{info['invite'].code}")
        lines += ["", f"== Registration codes (batch '{LATE_BATCH}', one use each, expire 19 Dec 2026)",
                  *[f"  {c}" for c in self.registration_codes], ""]
        content = "\n".join(lines)
        CREDENTIALS.write_text(content, encoding="utf-8")
        return content


def main() -> int:
    global NOW_PH
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--yes", action="store_true", help="really delete all data and build the demo")
    parser.add_argument("--seed", type=int, default=2026, help="random seed (the same seed gives the same data)")
    parser.add_argument("--today", help="YYYY-MM-DD: the day the timeline ends (default: today, Philippine time)")
    args = parser.parse_args()
    if not args.yes:
        print("This DELETES ALL DATA in the database. Run again with --yes.", file=sys.stderr)
        return 2
    real_now = (datetime.now(timezone.utc).replace(tzinfo=None) + PH).replace(second=0, microsecond=0)
    NOW_PH = datetime.fromisoformat(args.today).replace(hour=real_now.hour, minute=real_now.minute) \
        if args.today else real_now
    if NOW_PH < SEMESTER_START + timedelta(weeks=7, days=5):
        print(f"--today must be on or after {SEMESTER_START + timedelta(weeks=7, days=5):%Y-%m-%d}: the activities "
              f"need 7 weeks of lab sessions.", file=sys.stderr)
        return 2
    print(f"Timeline: {SEMESTER_START:%d %b %Y} to {NOW_PH:%d %b %Y %H:%M} (Philippine time)")
    print("Grading every version of every activity in the sandbox...")
    graded = grade_all()
    print("Deleting all data...")
    wipe()
    print("Building the demo...")
    with SessionLocal() as db:
        builder = Builder(db, graded, args.seed)
        builder.build()
    builder.write_credentials()
    print(f"\nDone. Accounts, invite codes and registration codes: {CREDENTIALS.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
