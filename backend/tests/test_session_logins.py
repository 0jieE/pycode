"""The sign-in log of a lab session: every login of a student whose class has a session open is recorded with its
outcome (a login that signs another session of the account out is "replaced_other_session"), and the instructor
reads it back newest first, paginated, with ?since=. No addresses, devices or seats."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.lab import LoginEvent, LoginOutcome
from app.models.user import Role, User
from tests.conftest import approved_student, login, login_as, new_device

API = "/api/v1"


def logins(lab, **params) -> dict:
    r = lab.teacher.get(f"{API}/sessions/{lab.session_id}/logins", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def enrol(db: Session, lab, username: str) -> None:
    """An approved student of the class, signed out again."""
    approved_student(db, lab.teacher, lab.cid, lab.code, username).post(f"{API}/auth/logout")


def test_the_sign_in_log(lab, db: Session) -> None:
    enrol(db, lab, "ana")
    first = new_device()
    assert login(first, "ana").status_code == 200                      # signed out before: success
    assert login(new_device(), "ana").status_code == 200               # signs the first device out
    assert first.get(f"{API}/auth/me").json()["code"] == "SESSION_REPLACED"
    teacher = new_device()
    assert login(teacher, "teach1").status_code == 200                 # staff sign-ins are not in a session
    lab.teacher = teacher

    log = logins(lab)
    ana = [e for e in log["items"] if e["student"]["username"] == "ana"]
    assert [e["outcome"] for e in ana] == ["replaced_other_session", "success"]
    assert set(ana[0]) == {"id", "at", "student", "outcome"} and ana[0]["at"].endswith("Z")
    assert set(ana[0]["student"]) == {"id", "username", "full_name", "student_no"}
    assert all(e["student"]["username"] != "teach1" for e in log["items"])

    db.expire_all()
    row = db.scalars(select(LoginEvent).join(User).where(User.username == "ana").order_by(LoginEvent.id.desc())).first()
    assert row.lab_session_id == lab.session_id and row.outcome == LoginOutcome.REPLACED_OTHER_SESSION
    assert not hasattr(row, "ip") and not hasattr(row, "seat_id")


def test_paging_and_since(lab, db: Session) -> None:
    for name in ("ana", "ben", "cyd"):
        enrol(db, lab, name)
        assert login(new_device(), name).status_code == 200
    everything = logins(lab)["items"]
    n = len(everything)
    assert [e["id"] for e in everything] == sorted((e["id"] for e in everything), reverse=True)
    pages = [logins(lab, page=p, size=2) for p in range(1, (n + 1) // 2 + 1)]
    assert [e["id"] for p in pages for e in p["items"]] == [e["id"] for e in everything]
    third = everything[-3]["at"]
    assert [e["id"] for e in logins(lab, since=third)["items"]] == [e["id"] for e in everything[:-3]]


def test_sign_ins_outside_a_session_are_logged_without_one(db: Session, lab) -> None:
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    enrol(db, lab, "ana")
    assert login(new_device(), "ana").status_code == 200
    db.expire_all()
    row = db.scalars(select(LoginEvent).join(User).where(User.username == "ana").order_by(LoginEvent.id.desc())).first()
    assert row.lab_session_id is None and row.outcome == LoginOutcome.SUCCESS


def test_only_the_owner_reads_it(lab, db: Session) -> None:
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    url = f"{API}/sessions/{lab.session_id}/logins"
    assert lab.student.get(url).status_code == 403
    r = other.get(url)
    assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_OWNER"
    r = lab.teacher.get(f"{API}/sessions/999999/logins")
    assert r.status_code == 404 and r.json()["code"] == "SESSION_NOT_FOUND"
    assert lab.teacher.get(url, params={"since": "yesterday"}).status_code == 422
