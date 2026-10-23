"""A lab session closes itself at its scheduled end (Celery beat, every 15 s), counts as closed from that very moment,
cannot be reopened once ended, and can be rescheduled (e.g. extended) with PATCH /sessions/{id}."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity_log import ActivityLog
from app.models.lab_session import LabSession
from app.services import session_service
from tests.conftest import Listener, iso, login_as, new_session
from app.models.user import Role

API = "/api/v1"


def end_in(db: Session, session_id: int, delta: timedelta) -> None:
    db.expire_all()
    db.get(LabSession, session_id).ends_at = utcnow() + delta
    db.commit()


def load(db: Session, session_id: int) -> LabSession:
    db.expire_all()
    return db.get(LabSession, session_id)


def test_the_sweep_closes_sessions_whose_end_has_passed(lab, db: Session) -> None:
    other_cid = lab.teacher.post(f"{API}/classes", json={"name": "Other", "year_and_section": "BSIT 1B",
                                                        "school_year": "2026-2027"}).json()["id"]
    still_running = new_session(lab.teacher, other_cid)
    lab.teacher.patch(f"{API}/sessions/{still_running['id']}/open")
    end_in(db, lab.session_id, timedelta(seconds=-1))

    listener = Listener(session_service.class_channel(lab.cid))
    try:
        assert session_service.close_ended_sessions(db) == 1
        events = listener.messages()
    finally:
        listener.close()
    ended = load(db, lab.session_id)
    assert ended.is_open is False and ended.closed_at is not None
    assert load(db, still_running["id"]).is_open is True                       # not ended: left alone
    assert events == [{"type": "session_closed", "reason": "scheduled_end"}]
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "session_close")).one()
    assert row.user_id is None and row.details["reason"] == "scheduled_end"
    assert session_service.close_ended_sessions(db) == 0                       # nothing left to do


def test_the_lab_counts_as_closed_at_the_end_even_before_the_sweep(lab, db: Session) -> None:
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "a.py", "content": "x"})
    assert r.status_code == 201
    end_in(db, lab.session_id, timedelta(seconds=-1))                          # the sweep has not run yet
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "b.py", "content": "x"})
    assert r.status_code == 403 and r.json()["code"] == "LAB_CLOSED"
    assert lab.student.get(f"{API}/classes/{lab.cid}/sessions/current").json() is None
    mine = lab.student.get(f"{API}/my/classes").json()["items"][0]
    assert mine["lab_open"] is False


def test_an_ended_session_cannot_be_reopened_but_can_be_extended(lab, db: Session) -> None:
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    end_in(db, lab.session_id, timedelta(minutes=-5))
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open")
    assert r.status_code == 409 and r.json()["code"] == "SESSION_ENDED"

    later = (utcnow() + timedelta(minutes=30)).replace(microsecond=0)
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"ends_at": iso(later)})
    assert r.status_code == 200 and r.json()["ends_at"] == iso(later)
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open").json()["is_open"] is True


def test_extending_a_running_session_keeps_it_open(lab, db: Session) -> None:
    end_in(db, lab.session_id, timedelta(seconds=30))
    later = utcnow() + timedelta(hours=1)
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"ends_at": iso(later)}).status_code == 200
    end_check = load(db, lab.session_id)
    assert end_check.ends_at > utcnow() + timedelta(minutes=50)
    assert session_service.close_ended_sessions(db) == 0 and load(db, lab.session_id).is_open is True


def test_reschedule_rules(lab, db: Session) -> None:
    now = utcnow()
    url = f"{API}/sessions/{lab.session_id}"
    r = lab.teacher.patch(url, json={"ends_at": iso(now - timedelta(days=1))})       # before starts_at
    assert r.status_code == 400 and r.json()["code"] == "INVALID_SESSION_WINDOW"
    assert lab.teacher.patch(url, json={"name": "  Week 2  "}).json()["name"] == "Week 2"
    assert lab.teacher.patch(url, json={"is_open": False}).status_code == 422          # open/close have their own calls
    assert lab.student.patch(url, json={"name": "x"}).status_code == 403
    other = login_as(db, Role.INSTRUCTOR, "teach2")
    assert other.patch(url, json={"name": "x"}).status_code in (403, 404)
    assert db.scalar(select(ActivityLog.id).where(ActivityLog.action == "session_update")) is not None


def test_the_sweep_is_scheduled() -> None:
    from app.worker.celery_app import celery_app
    entry = celery_app.conf.beat_schedule["session-schedule"]
    assert entry["task"] == "app.worker.tasks.run_session_schedule" and entry["schedule"] == 15.0


def test_opening_a_session_still_flagged_open_after_its_end_is_session_ended(lab, db: Session) -> None:
    """In the seconds between ends_at and the sweep the row still says is_open: opening must not answer 200."""
    end_in(db, lab.session_id, timedelta(seconds=-1))
    assert load(db, lab.session_id).is_open is True                           # the sweep has not run yet
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open")
    assert r.status_code == 409 and r.json()["code"] == "SESSION_ENDED"
    assert load(db, lab.session_id).is_open is True                           # nothing changed: the sweep closes it
    assert session_service.close_ended_sessions(db) == 1


def test_opening_a_running_open_session_is_still_idempotent(lab) -> None:
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open")
    assert r.status_code == 200 and r.json()["is_open"] is True


def test_moving_the_end_of_an_ended_session_does_not_reopen_it(lab, db: Session) -> None:
    """Ended but still flagged open (before the sweep): extending it closes it first, so students stay locked out
    until the instructor presses Open."""
    end_in(db, lab.session_id, timedelta(seconds=-1))
    listener = Listener(session_service.class_channel(lab.cid))
    try:
        later = utcnow() + timedelta(minutes=30)
        r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"ends_at": iso(later)})
        events = listener.messages()
    finally:
        listener.close()
    assert r.status_code == 200 and r.json()["is_open"] is False and r.json()["closed_at"] is not None
    assert events == [{"type": "session_closed", "reason": "scheduled_end"}]       # the class hears it, as from the sweep
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "session_close")).one()
    assert row.user_id is None and row.details["reason"] == "scheduled_end"

    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "late.py", "content": "x"})
    assert r.status_code == 403 and r.json()["code"] == "LAB_CLOSED"                # no access without Open
    assert session_service.close_ended_sessions(db) == 0                           # nothing left for the sweep
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open").json()["is_open"] is True
    assert lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "late.py", "content": "x"}).status_code == 201


def test_renaming_an_ended_session_also_closes_it(lab, db: Session) -> None:
    db.expire_all()
    db.get(LabSession, lab.session_id).starts_at = utcnow() - timedelta(hours=1)   # a valid window that has ended
    db.commit()
    end_in(db, lab.session_id, timedelta(seconds=-1))
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"name": "Renamed"})
    assert r.status_code == 200 and r.json()["is_open"] is False and r.json()["name"] == "Renamed"


def test_a_bad_reschedule_of_an_ended_session_changes_nothing(lab, db: Session) -> None:
    end_in(db, lab.session_id, timedelta(seconds=-1))
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"ends_at": iso(utcnow() - timedelta(days=30))})
    assert r.status_code == 400 and load(db, lab.session_id).is_open is True       # untouched: the sweep will close it
