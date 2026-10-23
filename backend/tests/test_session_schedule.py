"""A lab session follows its schedule: it can be opened by hand from 15 minutes before its start (409
SESSION_NOT_STARTED before that), opens itself at its start if it was never opened, and a session open earlier than
that is put back by the scheduler. An early-opened session uses its lab from the moment it was opened."""
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import utcnow
from app.models.activity_log import ActivityLog
from app.models.classroom import Classroom
from app.models.lab_session import LabSession
from app.services import session_service
from tests.conftest import Listener, iso, new_class, new_room

API = "/api/v1"


def create(lab, class_id: int, start: datetime, end: datetime, name: str = "Week 11", lab_id=None) -> int:
    r = lab.teacher.post(f"{API}/classes/{class_id}/sessions", json={
        "name": name, "starts_at": iso(start), "ends_at": iso(end), "lab_id": lab_id or new_room(lab.teacher)})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def load(db: Session, session_id: int) -> LabSession:
    db.expire_all()
    return db.get(LabSession, session_id)


def force_open(db: Session, session_id: int) -> None:
    """Opened before the 15-minute rule existed (like Week 11 in the dev data)."""
    db.execute(update(LabSession).where(LabSession.id == session_id).values(is_open=True, opened_at=utcnow()))
    db.commit()


def schedule(db: Session) -> dict:
    return session_service.run_schedule(db)


# =========================================================================== opening by hand

def test_a_session_cannot_be_opened_long_before_its_start(lab) -> None:
    other = new_class(lab.teacher, "Other")
    sid = create(lab, other, datetime(2030, 3, 4, 0, 0), datetime(2030, 3, 4, 3, 0))      # 8:00-11:00 AM school time
    r = lab.teacher.patch(f"{API}/sessions/{sid}/open")
    assert r.status_code == 409 and r.json()["code"] == "SESSION_NOT_STARTED"
    assert r.json()["detail"] == "Week 11 starts Mar 4, 8:00 AM: it can be opened from 7:45 AM."
    assert r.json()["opens_at"] == "2030-03-03T23:45:00Z"


def test_the_message_names_the_day_when_opening_starts_the_day_before(lab) -> None:
    other = new_class(lab.teacher, "Other")
    sid = create(lab, other, datetime(2030, 3, 4, 16, 5), datetime(2030, 3, 4, 18, 0))    # 12:05 AM, Mar 5
    assert lab.teacher.patch(f"{API}/sessions/{sid}/open").json()["detail"] == \
        "Week 11 starts Mar 5, 12:05 AM: it can be opened from Mar 4, 11:50 PM."


def test_it_can_be_opened_from_15_minutes_before(lab) -> None:
    other = new_class(lab.teacher, "Other")
    now = utcnow()
    too_early = create(lab, other, now + timedelta(minutes=17), now + timedelta(hours=1), "Too early")
    in_time = create(lab, other, now + timedelta(minutes=13), now + timedelta(hours=1), "In time")
    assert lab.teacher.patch(f"{API}/sessions/{too_early}/open").json()["code"] == "SESSION_NOT_STARTED"
    r = lab.teacher.patch(f"{API}/sessions/{in_time}/open")
    assert r.status_code == 200 and r.json()["is_open"] is True


def test_an_early_opened_session_uses_its_lab_from_when_it_was_opened(lab, db: Session) -> None:
    """Session A (Lab X, ends in 5 min) is closed; B (Lab X, starts in 10 min) is opened early. The windows do not
    overlap, but B is in the room now, so A cannot be opened."""
    now = utcnow()
    room = new_room(lab.teacher)
    other = new_class(lab.teacher, "Other")
    a = create(lab, other, now - timedelta(minutes=30), now + timedelta(minutes=5), "A", room)
    b = create(lab, new_class(lab.teacher, "Third"), now + timedelta(minutes=10), now + timedelta(hours=1), "B", room)
    assert lab.teacher.patch(f"{API}/sessions/{b}/open").status_code == 200
    r = lab.teacher.patch(f"{API}/sessions/{a}/open")
    assert r.status_code == 409 and r.json()["code"] == "LAB_IN_USE" and r.json()["conflict"]["session_id"] == b
    schedule(db)                                                    # the scheduler leaves B alone (within 15 min)
    assert load(db, b).is_open is True


# =========================================================================== the scheduler puts back early ones

def test_a_session_open_long_before_its_start_is_put_back(lab, db: Session) -> None:
    other = new_class(lab.teacher, "Other")
    now = utcnow()
    early = create(lab, other, now + timedelta(days=5), now + timedelta(days=5, hours=3))
    force_open(db, early)
    listener = Listener(session_service.class_channel(other))
    try:
        assert schedule(db)["closed_early"] == 1
        events = listener.messages()
    finally:
        listener.close()
    s = load(db, early)
    assert (s.is_open, s.opened_at, s.closed_at) == (False, None, None)      # back to "not opened yet"
    assert events == [{"type": "session_closed", "reason": "before_start"}]
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "session_close")).one()
    assert row.user_id is None and row.details == {"class_id": other, "session_id": early, "reason": "before_start"}
    assert load(db, lab.session_id).is_open is True                          # a running session is left alone
    assert schedule(db)["closed_early"] == 0


# =========================================================================== opening by itself at the start

def test_a_session_opens_itself_at_its_start(lab, db: Session) -> None:
    other = new_class(lab.teacher, "Other")
    now = utcnow()
    due = create(lab, other, now - timedelta(minutes=1), now + timedelta(hours=1))
    later = create(lab, new_class(lab.teacher, "Third"), now + timedelta(minutes=10), now + timedelta(hours=1))
    listener = Listener(session_service.class_channel(other))
    try:
        assert schedule(db)["opened"] == 1
        events = listener.messages()
    finally:
        listener.close()
    s = load(db, due)
    assert s.is_open is True and s.opened_at is not None and s.closed_at is None
    assert load(db, later).is_open is False                                  # not yet
    assert events == [{"type": "session_opened", "reason": "scheduled_start"}]
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "session_open",
                                               ActivityLog.user_id.is_(None))).one()
    assert row.details == {"class_id": other, "session_id": due, "reason": "scheduled_start"}
    assert schedule(db)["opened"] == 0                                       # once


def test_the_lab_fixture_session_and_open_classes_are_left_alone(lab, db: Session) -> None:
    """A second session of a class whose other session is open waits until that one closes."""
    now = utcnow()
    second = create(lab, lab.cid, now - timedelta(minutes=1), now + timedelta(hours=1), "Second")
    assert schedule(db)["opened"] == 0 and load(db, second).is_open is False
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    # the first one was opened by hand and closed again: it stays closed; the second, never opened, opens
    assert schedule(db)["opened"] == 1
    assert load(db, second).is_open is True and load(db, lab.session_id).is_open is False


def test_a_session_the_instructor_closed_is_not_reopened(lab, db: Session) -> None:
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    assert schedule(db)["opened"] == 0 and load(db, lab.session_id).is_open is False


def test_it_waits_while_its_lab_is_in_use(lab, db: Session) -> None:
    """Possible only with bookings made before the overlap check: the second waits for the room."""
    now = utcnow()
    room = new_room(lab.teacher)
    first = create(lab, new_class(lab.teacher, "A"), now - timedelta(minutes=5), now + timedelta(minutes=30), "A", room)
    second = create(lab, new_class(lab.teacher, "B"), now + timedelta(hours=2), now + timedelta(hours=3), "B", room)
    db.execute(update(LabSession).where(LabSession.id == second).values(
        starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(hours=1)))       # an old overlapping booking
    db.commit()
    assert schedule(db)["opened"] == 1                                       # the earlier one gets the room
    assert load(db, first).is_open is True and load(db, second).is_open is False
    lab.teacher.patch(f"{API}/sessions/{first}/close")
    assert schedule(db)["opened"] == 1 and load(db, second).is_open is True


def test_sessions_without_a_lab_or_of_archived_classes_never_open_themselves(lab, db: Session) -> None:
    now = utcnow()
    no_lab = create(lab, new_class(lab.teacher, "A"), now - timedelta(minutes=1), now + timedelta(hours=1))
    db.execute(update(LabSession).where(LabSession.id == no_lab).values(lab_id=None))
    archived_cid = new_class(lab.teacher, "B")
    archived = create(lab, archived_cid, now - timedelta(minutes=1), now + timedelta(hours=1))
    db.execute(update(Classroom).where(Classroom.id == archived_cid).values(is_archived=True))
    ended = create(lab, new_class(lab.teacher, "C"), now - timedelta(hours=2), now - timedelta(hours=1))
    db.commit()
    assert schedule(db)["opened"] == 0
    assert not any(load(db, s).is_open for s in (no_lab, archived, ended))


def test_a_session_put_back_opens_at_its_start(lab, db: Session) -> None:
    other = new_class(lab.teacher, "Other")
    now = utcnow()
    sid = create(lab, other, now + timedelta(days=1), now + timedelta(days=1, hours=3))
    force_open(db, sid)
    assert schedule(db) == {"closed_ended": 0, "closed_early": 1, "opened": 0}
    db.execute(update(LabSession).where(LabSession.id == sid).values(                  # its day has come
        starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(hours=1)))
    db.commit()
    assert schedule(db)["opened"] == 1 and load(db, sid).is_open is True


def test_students_can_work_once_it_opened_itself(lab, db: Session) -> None:
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    db.execute(update(LabSession).where(LabSession.id == lab.session_id).values(opened_at=None, closed_at=None))
    db.commit()                                                     # as if it had never been opened
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "a.py", "content": "x"})
    assert r.status_code == 403 and r.json()["code"] == "LAB_CLOSED"
    assert schedule(db)["opened"] == 1
    r = lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "a.py", "content": "x"})
    assert r.status_code == 201


def test_an_opening_long_before_the_slot_does_not_count(lab, db: Session) -> None:
    """Like Week 11 in the dev data: opened days early (before the 15-minute rule) and closed again by hand. It still
    opens itself at its start; an opening within its slot does count (the instructor's Close is respected)."""
    now = utcnow()
    days_early = create(lab, new_class(lab.teacher, "A"), now - timedelta(minutes=1), now + timedelta(hours=1), "A")
    in_slot = create(lab, new_class(lab.teacher, "B"), now - timedelta(minutes=1), now + timedelta(hours=1), "B")
    db.execute(update(LabSession).where(LabSession.id == days_early).values(
        opened_at=now - timedelta(days=5), closed_at=now - timedelta(days=5) + timedelta(seconds=3)))
    db.execute(update(LabSession).where(LabSession.id == in_slot).values(
        opened_at=now - timedelta(minutes=10), closed_at=now - timedelta(minutes=5)))
    db.commit()
    assert schedule(db)["opened"] == 1
    assert load(db, days_early).is_open is True and load(db, in_slot).is_open is False
