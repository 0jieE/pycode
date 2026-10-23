"""Lab schedule and booking conflicts: a session with a lab books the room from starts_at to ends_at; overlapping
bookings of the same lab are refused (LAB_BOOKED), and so is opening a session while another running session uses
its lab (LAB_IN_USE). Back-to-back is fine; sessions without a lab never conflict."""
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import ConflictError
from app.models.classroom import Classroom
from app.models.lab_session import LabSession
from app.models.user import Role, User
from app.schemas.lab_session import SessionCreate
from app.services import booking_service, session_service
from tests.conftest import iso, login_as, new_class

API = "/api/v1"
DAY = datetime(2030, 3, 4, 2, 0)         # 10:00 AM school time (UTC+8), far enough ahead to stay upcoming


def at(hour: float, day: datetime = DAY) -> datetime:
    """DAY at this school-time hour (10 = 10:00 AM)."""
    return day + timedelta(hours=hour - 10)


def book(teacher: TestClient, class_id: int, start: datetime, end: datetime, lab_id=None, name="Session A"):
    body = {"name": name, "starts_at": iso(start), "ends_at": iso(end)}
    if lab_id is not None:
        body["lab_id"] = lab_id
    return teacher.post(f"{API}/classes/{class_id}/sessions", json=body)


def booked(teacher: TestClient, class_id: int, start: datetime, end: datetime, lab_id: int, name="Session A") -> int:
    r = book(teacher, class_id, start, end, lab_id, name)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def schedule(client: TestClient, lab_id: int, **params) -> list[dict]:
    r = client.get(f"{API}/labs/{lab_id}/schedule", params=params)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def rooms(lab, db: Session):
    """Lab A and Lab B; the `lab` fixture's open session (teach1, now .. +40 min) runs in Lab A. A second instructor
    (Prof. Marquez) with class CC 101."""
    admin = login_as(db, Role.ADMIN, "admin1")
    lab.lab_a = admin.post(f"{API}/labs", json={"name": "Lab A"}).json()["id"]
    lab.lab_b = admin.post(f"{API}/labs", json={"name": "Lab B"}).json()["id"]
    r = lab.teacher.patch(f"{API}/sessions/{lab.session_id}", json={"lab_id": lab.lab_a})
    assert r.status_code == 200, r.text
    lab.admin = admin
    lab.other = login_as(db, Role.INSTRUCTOR, "teach2")
    db.execute(update(User).where(User.username == "teach2").values(full_name="Prof. Marquez"))
    db.commit()
    lab.other_cid = new_class(lab.other, "CC 101")
    return lab


# =========================================================================== the schedule

def test_the_schedule_lists_running_then_upcoming_sessions_of_all_instructors(rooms, db: Session) -> None:
    later = booked(rooms.other, rooms.other_cid, at(13), at(15), rooms.lab_a, "Batch 2")
    sooner = booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_a, "Batch 1")
    booked(rooms.teacher, rooms.cid, at(10), at(11), rooms.lab_b)                     # another lab
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    booked(rooms.other, rooms.other_cid, now - timedelta(hours=3), now - timedelta(hours=2), rooms.lab_a)  # ended

    items = schedule(rooms.teacher, rooms.lab_a)
    assert [i["session_id"] for i in items] == [rooms.session_id, sooner, later]
    running, first = items[0], items[1]
    assert running["is_open"] is True and running["mine"] is True
    assert first == {"session_id": sooner, "name": "Batch 1", "starts_at": iso(at(10)), "ends_at": iso(at(11)),
                     "is_open": False, "class": {"id": rooms.other_cid, "name": "CC 101", "year_and_section": "BSIT 1A"},
                     "instructor": {"id": first["instructor"]["id"], "full_name": "Prof. Marquez"}, "mine": False}
    # mine is from the viewer's side; admins see every lab and own nothing
    assert [i["mine"] for i in schedule(rooms.other, rooms.lab_a)] == [False, True, True]
    assert [i["mine"] for i in schedule(rooms.admin, rooms.lab_a)] == [False, False, False]


def test_from_and_to_page_through_later_dates(rooms) -> None:
    ids = [booked(rooms.other, rooms.other_cid, at(10, DAY + timedelta(days=d)), at(12, DAY + timedelta(days=d)),
                  rooms.lab_a, f"Day {d}") for d in range(3)]
    window = {"from": iso(at(0, DAY + timedelta(days=1))), "to": iso(at(0, DAY + timedelta(days=2)))}
    assert [i["session_id"] for i in schedule(rooms.teacher, rooms.lab_a, **window)] == [ids[1]]
    assert [i["session_id"] for i in schedule(rooms.teacher, rooms.lab_a, **{"from": window["to"]})] == [ids[2]]
    # a window touching a session only at its edge leaves it out; an offset is converted to UTC
    plus8 = (at(12) + timedelta(hours=8)).replace(tzinfo=timezone(timedelta(hours=8))).isoformat()
    assert ids[0] not in [i["session_id"] for i in schedule(rooms.teacher, rooms.lab_a, **{"from": plus8})]
    assert [i["session_id"] for i in schedule(rooms.teacher, rooms.lab_a, to=iso(at(10)))] == [rooms.session_id]


def test_sessions_of_archived_classes_book_nothing(rooms, db: Session) -> None:
    booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_a)
    db.execute(update(Classroom).where(Classroom.id == rooms.other_cid).values(is_archived=True))
    db.commit()
    assert [i["session_id"] for i in schedule(rooms.teacher, rooms.lab_a)] == [rooms.session_id]
    assert book(rooms.teacher, rooms.cid, at(10), at(11), rooms.lab_a).status_code == 201


def test_schedule_permissions(rooms) -> None:
    assert rooms.student.get(f"{API}/labs/{rooms.lab_a}/schedule").status_code == 403
    r = rooms.teacher.get(f"{API}/labs/999999/schedule")
    assert r.status_code == 404 and r.json()["code"] == "LAB_NOT_FOUND"
    assert rooms.teacher.get(f"{API}/labs/{rooms.lab_a}/schedule", params={"from": "soon"}).status_code == 422


# =========================================================================== booking conflicts

def test_an_overlapping_booking_is_refused_with_the_other_session(rooms) -> None:
    theirs = booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_a, "Batch 1")
    for start, end in ((at(10), at(11)), (at(9.5), at(10.5)), (at(10.5), at(12)), (at(9), at(13)),
                       (at(10.25), at(10.75))):
        r = book(rooms.teacher, rooms.cid, start, end, rooms.lab_a)
        assert r.status_code == 409 and r.json()["code"] == "LAB_BOOKED", (start, end, r.text)
    body = r.json()
    assert body["detail"] == "Lab A is booked Mar 4, 10:00–11:00 AM by Prof. Marquez (CC 101, Batch 1)"
    assert body["conflict"]["session_id"] == theirs and body["conflict"]["mine"] is False
    assert body["conflict"]["class"]["name"] == "CC 101" and body["conflict"]["instructor"]["full_name"] == "Prof. Marquez"

    assert book(rooms.teacher, rooms.cid, at(11), at(12), rooms.lab_a).status_code == 201   # back-to-back
    assert book(rooms.teacher, rooms.cid, at(9), at(10), rooms.lab_a).status_code == 201
    assert book(rooms.teacher, rooms.cid, at(10), at(11), rooms.lab_b).status_code == 201   # another lab
    assert book(rooms.teacher, rooms.cid, at(10), at(11)).status_code == 422                # a lab is required


def test_the_message_spells_out_morning_to_afternoon_and_overnight(rooms) -> None:
    booked(rooms.other, rooms.other_cid, at(11.5), at(13), rooms.lab_a, "Noon")
    booked(rooms.other, rooms.other_cid, at(22), at(25), rooms.lab_a, "Night")
    assert book(rooms.teacher, rooms.cid, at(12), at(12.5), rooms.lab_a).json()["detail"] == \
        "Lab A is booked Mar 4, 11:30 AM–1:00 PM by Prof. Marquez (CC 101, Noon)"
    assert book(rooms.teacher, rooms.cid, at(23), at(24), rooms.lab_a).json()["detail"] == \
        "Lab A is booked Mar 4, 10:00 PM – Mar 5, 1:00 AM by Prof. Marquez (CC 101, Night)"


def test_rescheduling_into_a_booking_is_refused(rooms) -> None:
    booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_a, "Batch 1")
    mine = booked(rooms.teacher, rooms.cid, at(8), at(9), rooms.lab_a)
    r = rooms.teacher.patch(f"{API}/sessions/{mine}", json={"ends_at": iso(at(10.5))})
    assert r.status_code == 409 and r.json()["code"] == "LAB_BOOKED" and r.json()["conflict"]["name"] == "Batch 1"
    r = rooms.teacher.patch(f"{API}/sessions/{mine}", json={"starts_at": iso(at(10.5)), "ends_at": iso(at(12))})
    assert r.status_code == 409
    assert rooms.teacher.patch(f"{API}/sessions/{mine}", json={"ends_at": iso(at(10))}).status_code == 200  # up to it
    assert rooms.teacher.patch(f"{API}/sessions/{mine}", json={"name": "Renamed"}).status_code == 200
    # its own old window never blocks it
    r = rooms.teacher.patch(f"{API}/sessions/{mine}", json={"starts_at": iso(at(8.5)), "ends_at": iso(at(9.5))})
    assert r.status_code == 200, r.text


def test_extending_the_running_session_into_the_next_booking_is_refused(rooms) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None).replace(microsecond=0)
    nxt = booked(rooms.other, rooms.other_cid, now + timedelta(hours=1), now + timedelta(hours=2), rooms.lab_a)
    r = rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"ends_at": iso(now + timedelta(hours=1, minutes=30))})
    assert r.status_code == 409 and r.json()["conflict"]["session_id"] == nxt
    r = rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"ends_at": iso(now + timedelta(hours=1))})
    assert r.status_code == 200 and r.json()["is_open"] is True


def test_moving_a_session_into_a_booked_lab_is_refused(rooms) -> None:
    booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_b, "Batch 1")
    mine = booked(rooms.teacher, rooms.cid, at(10.5), at(11.5), rooms.lab_a)
    r = rooms.teacher.patch(f"{API}/sessions/{mine}", json={"lab_id": rooms.lab_b})
    assert r.status_code == 409 and r.json()["code"] == "LAB_BOOKED"
    assert r.json()["detail"] == "Lab B is booked Mar 4, 10:00–11:00 AM by Prof. Marquez (CC 101, Batch 1)"
    # the same lab again: nothing to check; removing the lab is not allowed
    assert rooms.teacher.patch(f"{API}/sessions/{mine}", json={"lab_id": rooms.lab_a}).status_code == 200
    assert rooms.teacher.patch(f"{API}/sessions/{mine}", json={"lab_id": None}).status_code == 422
    r = rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"lab_id": 999999})
    assert r.status_code == 404 and r.json()["code"] == "LAB_NOT_FOUND"


def test_ended_sessions_book_nothing(rooms) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    booked(rooms.other, rooms.other_cid, now - timedelta(hours=3), now - timedelta(hours=1), rooms.lab_b)
    assert book(rooms.teacher, rooms.cid, now - timedelta(hours=2), now + timedelta(hours=1), rooms.lab_b).status_code == 201


def test_a_session_closed_early_keeps_its_booking(rooms) -> None:
    assert rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}/close").status_code == 200
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    r = book(rooms.other, rooms.other_cid, now, now + timedelta(minutes=30), rooms.lab_a)
    assert r.status_code == 409 and r.json()["conflict"]["is_open"] is False   # it can still be reopened
    # ending it (in a few seconds: the Docker VM clock can step back a second or two) frees the room after that
    soon = now + timedelta(seconds=5)
    assert rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"ends_at": iso(soon)}).status_code == 200
    assert book(rooms.other, rooms.other_cid, soon, now + timedelta(minutes=30), rooms.lab_a).status_code == 201


def test_simultaneous_bookings_of_one_slot_let_exactly_one_through(rooms, monkeypatch) -> None:
    """Two instructors book the same slot at once. The first is held up between its check and its insert, and the
    second starts in that gap: without the lock on the lab it would find the slot free and get it too."""
    original, checked = booking_service.check_free, threading.Event()

    def slow_check(*args, **kwargs):
        original(*args, **kwargs)
        if not checked.is_set():
            checked.set()
            time.sleep(0.6)

    monkeypatch.setattr(booking_service, "check_free", slow_check)
    results: dict[str, str] = {}

    def go(username: str, class_id: int) -> None:
        with SessionLocal() as own:
            user = own.scalar(select(User).where(User.username == username))
            data = SessionCreate.model_validate({"name": username, "starts_at": iso(at(10)),
                                                 "ends_at": iso(at(11)), "lab_id": rooms.lab_b})
            try:
                session_service.create_session(own, class_id, user, data, None)
                results[username] = "booked"
            except ConflictError as e:
                results[username] = e.code

    first = threading.Thread(target=go, args=("teach1", rooms.cid))
    first.start()
    assert checked.wait(10)
    second = threading.Thread(target=go, args=("teach2", rooms.other_cid))
    second.start()
    first.join(30)
    second.join(30)
    assert results == {"teach1": "booked", "teach2": "LAB_BOOKED"}


# =========================================================================== opening

def ends_in_5_minutes(rooms) -> datetime:
    """teach1's running session (Lab A) ends in 5 minutes; returns now."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    r = rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"ends_at": iso(now + timedelta(minutes=5))})
    assert r.status_code == 200, r.text
    return now


def test_opening_while_the_lab_is_in_use_is_refused(rooms) -> None:
    now = ends_in_5_minutes(rooms)
    later = booked(rooms.other, rooms.other_cid, now + timedelta(minutes=10), now + timedelta(hours=1), rooms.lab_a,
                   "Batch 1")
    r = rooms.other.patch(f"{API}/sessions/{later}/open")             # early, while teach1's session runs in Lab A
    assert r.status_code == 409 and r.json()["code"] == "LAB_IN_USE"
    assert r.json()["detail"].startswith("Lab A is in use until ") and r.json()["detail"].endswith(
        "by Test User (Programming 1, Session A)")
    assert r.json()["conflict"]["session_id"] == rooms.session_id and r.json()["conflict"]["is_open"] is True

    assert rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}/close").status_code == 200
    assert rooms.other.patch(f"{API}/sessions/{later}/open").status_code == 200


def test_opening_in_a_free_lab_is_fine(rooms) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    free = booked(rooms.other, rooms.other_cid, now, now + timedelta(hours=1), rooms.lab_b)
    assert rooms.other.patch(f"{API}/sessions/{free}/open").status_code == 200


def test_a_session_that_lost_its_lab_cannot_be_opened_until_it_gets_one(rooms, db: Session) -> None:
    """Only possible when its lab was deleted after it ended and its end was then moved later."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    sid = booked(rooms.other, rooms.other_cid, now, now + timedelta(hours=1), rooms.lab_b)
    db.execute(update(LabSession).where(LabSession.id == sid).values(lab_id=None))
    db.commit()
    r = rooms.other.patch(f"{API}/sessions/{sid}/open")
    assert r.status_code == 409 and r.json()["code"] == "LAB_REQUIRED"
    assert r.json()["detail"] == "Choose a lab for this session before opening it"
    assert rooms.other.patch(f"{API}/sessions/{sid}", json={"lab_id": rooms.lab_b}).status_code == 200
    assert rooms.other.patch(f"{API}/sessions/{sid}/open").status_code == 200


# =========================================================================== deleting a lab

def test_a_lab_with_sessions_that_have_not_ended_cannot_be_deleted(rooms, db: Session) -> None:
    booked(rooms.other, rooms.other_cid, at(10), at(11), rooms.lab_b)
    booked(rooms.other, rooms.other_cid, at(13), at(14), rooms.lab_b)
    r = rooms.admin.delete(f"{API}/labs/{rooms.lab_b}")
    assert r.status_code == 409 and r.json()["code"] == "LAB_HAS_SESSIONS" and r.json()["sessions"] == 2
    assert r.json()["detail"] == "Lab B still has 2 sessions that have not ended. Move them to another lab first."
    # archived classes' sessions do not count (they can never be opened again)
    db.execute(update(Classroom).where(Classroom.id == rooms.other_cid).values(is_archived=True))
    db.commit()
    assert rooms.admin.delete(f"{API}/labs/{rooms.lab_b}").status_code == 204


def test_a_lab_whose_sessions_have_all_ended_can_be_deleted(rooms, db: Session) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    old = booked(rooms.other, rooms.other_cid, now - timedelta(hours=3), now - timedelta(hours=2), rooms.lab_b)
    r = rooms.admin.delete(f"{API}/labs/{rooms.lab_b}")
    assert r.status_code == 204, r.text
    db.expire_all()
    assert db.get(LabSession, old).lab_id is None              # history kept, without a room
    r = rooms.admin.delete(f"{API}/labs/{rooms.lab_a}")       # the running session is there
    assert r.status_code == 409 and r.json()["detail"].startswith("Lab A still has 1 session that has not ended.")


def test_moving_a_running_session_into_a_lab_in_use_is_refused(rooms) -> None:
    now = ends_in_5_minutes(rooms)
    # teach2 opens 10 minutes early in Lab B, so the windows do not overlap but both run now
    early = booked(rooms.other, rooms.other_cid, now + timedelta(minutes=10), now + timedelta(hours=1), rooms.lab_b)
    assert rooms.other.patch(f"{API}/sessions/{early}/open").status_code == 200
    r = rooms.teacher.patch(f"{API}/sessions/{rooms.session_id}", json={"lab_id": rooms.lab_b})
    assert r.status_code == 409 and r.json()["code"] == "LAB_IN_USE"


# =========================================================================== labs are named rooms

def test_a_lab_is_just_a_named_room(rooms, db: Session) -> None:
    r = rooms.admin.post(f"{API}/labs", json={"name": "  Lab C  "})
    assert r.status_code == 201 and r.json() == {"id": r.json()["id"], "name": "Lab C"}
    lab_c = r.json()["id"]
    assert rooms.teacher.get(f"{API}/labs/{lab_c}").json() == {"id": lab_c, "name": "Lab C"}   # instructors too
    names = [x["name"] for x in rooms.teacher.get(f"{API}/labs").json()]
    assert [n for n in names if not n.startswith("Room ")] == ["Lab A", "Lab B", "Lab C"]
    for body in ({"name": "Lab D", "rows": 5, "cols": 6}, {"name": ""}, {}):
        assert rooms.admin.post(f"{API}/labs", json=body).status_code == 422, body
    r = rooms.admin.post(f"{API}/labs", json={"name": "Lab A"})
    assert r.status_code == 409 and r.json()["code"] == "LAB_NAME_TAKEN"

    r = rooms.teacher.patch(f"{API}/labs/{lab_c}", json={"name": "Lab C (annex)"})
    assert r.status_code == 200 and r.json()["name"] == "Lab C (annex)"
    assert rooms.teacher.patch(f"{API}/labs/{lab_c}", json={"name": "Lab A"}).json()["code"] == "LAB_NAME_TAKEN"
    assert rooms.teacher.patch(f"{API}/labs/{lab_c}", json={"rows": 3}).status_code == 422
    assert rooms.student.get(f"{API}/labs").status_code == 403
    assert rooms.student.post(f"{API}/labs", json={"name": "S"}).status_code == 403
    assert rooms.admin.delete(f"{API}/labs/{lab_c}").status_code == 204          # nothing books it


def test_a_session_moves_to_another_lab_with_patch(rooms, db: Session) -> None:
    from app.models.activity_log import ActivityLog

    mine = booked(rooms.teacher, rooms.cid, at(10), at(11), rooms.lab_a)
    r = rooms.teacher.patch(f"{API}/sessions/{mine}", json={"lab_id": rooms.lab_b, "starts_at": iso(at(9))})
    assert r.status_code == 200 and (r.json()["lab_id"], r.json()["starts_at"]) == (rooms.lab_b, iso(at(9)))
    assert "seat_lock" not in r.json()
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "session_update")).all()[-1]
    assert row.details["fields"] == ["lab_id", "starts_at"]
    assert rooms.teacher.patch(f"{API}/sessions/{mine}", json={"seat_lock": "off"}).status_code == 422
    assert rooms.student.patch(f"{API}/sessions/{mine}", json={"lab_id": rooms.lab_a}).status_code == 403


def test_the_seat_map_endpoints_are_gone(rooms, db: Session) -> None:
    gone = [("get", f"/sessions/{rooms.session_id}/seat-map"), ("get", f"/sessions/{rooms.session_id}/alerts"),
            ("patch", f"/sessions/{rooms.session_id}/seating"), ("post", f"/sessions/{rooms.session_id}/release-seat"),
            ("put", f"/labs/{rooms.lab_a}/seats"), ("patch", f"/labs/{rooms.lab_a}/seats/1"),
            ("post", f"/labs/{rooms.lab_a}/seats/1/register-this-device"), ("delete", f"/labs/{rooms.lab_a}/seats/1/device"),
            ("get", f"/classes/{rooms.cid}/seat-plan"), ("put", f"/classes/{rooms.cid}/seat-plan")]
    for method, path in gone:
        r = getattr(rooms.admin if "/labs/" in path else rooms.teacher, method)(f"{API}{path}")
        assert r.status_code in (404, 405), (method, path, r.status_code)
    assert rooms.teacher.get(f"{API}/labs/whoami-seat").status_code in (404, 422)     # (read as a lab id)
