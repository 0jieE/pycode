"""When a student starts working in a lab session: their first class-workspace access (tree or file) while the class
has an open session is recorded once, per activity too, shown in the monitor snapshot and announced live."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.session_start import SessionActivityStart, SessionStart
from app.models.user import Role, User
from app.services import session_service, start_service
from tests.conftest import Listener, login_as, new_session
from tests.test_submissions import publish

API = "/api/v1"


def tree(lab) -> dict:
    r = lab.student.get(f"{API}/workspace/{lab.cid}/tree")
    assert r.status_code == 200, r.text
    return {e["path"]: e for e in r.json()["entries"]}


def open_file(lab, path: str) -> None:
    r = lab.student.get(f"{API}/workspace/files/{tree(lab)[path]['id']}")
    assert r.status_code == 200, r.text


def starts(db: Session) -> list[SessionStart]:
    db.expire_all()
    return list(db.scalars(select(SessionStart).order_by(SessionStart.id)))


def activity_starts(db: Session) -> list[SessionActivityStart]:
    db.expire_all()
    return list(db.scalars(select(SessionActivityStart).order_by(SessionActivityStart.id)))


def student_id(db: Session) -> int:
    return db.scalar(select(User.id).where(User.username == "stu1"))


def monitor_row(lab) -> dict:
    r = lab.teacher.get(f"{API}/sessions/{lab.session_id}/monitor")
    assert r.status_code == 200, r.text
    return next(s for s in r.json()["students"] if s["student"]["username"] == "stu1")


def started_events(listener: Listener) -> list[dict]:
    return [e for e in listener.messages() if e["type"] == "started"]


# =========================================================================== the session start

def test_the_first_load_records_the_start_and_announces_it(lab, db: Session) -> None:
    assert monitor_row(lab)["started_at"] is None                  # not started yet
    listener = Listener(f"monitor:{lab.session_id}")
    try:
        tree(lab)
        events = started_events(listener)
    finally:
        listener.close()
    rows = starts(db)
    assert len(rows) == 1
    row = rows[0]
    assert (row.lab_session_id, row.student_id, row.first_activity_id) == (lab.session_id, student_id(db), None)
    assert len(events) == 1 and events[0]["student_id"] == student_id(db) and "activity_id" not in events[0]
    assert events[0]["student"] == "Test User" and events[0]["ts"].endswith("Z")
    assert monitor_row(lab)["started_at"] == events[0]["started_at"]


def test_reloads_change_nothing(lab, db: Session) -> None:
    tree(lab)
    first = starts(db)[0].started_at
    listener = Listener(f"monitor:{lab.session_id}")
    try:
        tree(lab)
        tree(lab)
        start_service.record_access(db, db.get(User, student_id(db)), lab.cid)   # (directly, too)
        events = started_events(listener)
    finally:
        listener.close()
    assert [r.started_at for r in starts(db)] == [first] and events == []


def test_opening_a_file_first_also_records_the_start(lab, db: Session) -> None:
    lab.student.post(f"{API}/workspace/{lab.cid}/files", json={"path": "notes.py", "content": "x"})  # (no record)
    db.execute(SessionStart.__table__.delete())
    db.commit()
    open_file(lab, "notes.py")
    assert len(starts(db)) == 1 and activity_starts(db) == []       # outside any activity folder


def test_no_row_while_no_session_is_open(lab, db: Session) -> None:
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close").status_code == 200
    tree(lab)
    assert starts(db) == []
    assert lab.teacher.patch(f"{API}/sessions/{lab.session_id}/open").status_code == 200
    tree(lab)
    assert len(starts(db)) == 1                                      # recorded once it is open again


def test_separate_sessions_get_separate_rows(lab, db: Session) -> None:
    tree(lab)
    lab.teacher.patch(f"{API}/sessions/{lab.session_id}/close")
    second = new_session(lab.teacher, lab.cid, "Week 2")
    assert lab.teacher.patch(f"{API}/sessions/{second['id']}/open").status_code == 200
    tree(lab)
    tree(lab)
    assert [r.lab_session_id for r in starts(db)] == [lab.session_id, second["id"]]


def test_only_the_students_own_class_workspace_counts(lab, db: Session) -> None:
    lab.teacher.get(f"{API}/classes/{lab.cid}/students/{student_id(db)}/workspace")   # the instructor looking
    lab.student.get(f"{API}/practice/tree")                                            # Practice
    assert starts(db) == []


def test_a_failure_to_record_never_breaks_the_page(lab, db: Session, monkeypatch) -> None:
    def broken(*_args, **_kwargs):
        raise RuntimeError("database away")

    monkeypatch.setattr(session_service, "get_open_session", broken)
    assert lab.student.get(f"{API}/workspace/{lab.cid}/tree").status_code == 200
    monkeypatch.undo()
    assert starts(db) == []


# =========================================================================== per activity

def test_the_first_file_of_each_activity_is_recorded(lab, db: Session) -> None:
    lab1 = publish(lab, "Lab 1", files=[{"path": "main.py", "content": "print(1)"}, {"path": "util.py", "content": ""}])
    lab2 = publish(lab, "Lab 2", files=[{"path": "main.py", "content": "print(2)"}])
    tree(lab)
    listener = Listener(f"monitor:{lab.session_id}")
    try:
        open_file(lab, "Lab 1/main.py")
        open_file(lab, "Lab 1/util.py")                              # the same activity: nothing new
        open_file(lab, "Lab 2/main.py")
        open_file(lab, "Lab 1/main.py")
        events = started_events(listener)
    finally:
        listener.close()
    assert [(a.activity_id, a.lab_session_id) for a in activity_starts(db)] == [
        (lab1["id"], lab.session_id), (lab2["id"], lab.session_id)]
    assert starts(db)[0].first_activity_id == lab1["id"]             # set by the first one, kept after
    assert [(e["activity_id"], e["activity"]) for e in events] == [(lab1["id"], "Lab 1"), (lab2["id"], "Lab 2")]

    row = monitor_row(lab)
    assert row["first_activity_id"] == lab1["id"]
    assert [(a["activity_id"], a["title"]) for a in row["activity_starts"]] == [(lab1["id"], "Lab 1"), (lab2["id"], "Lab 2")]
    assert row["activity_starts"][0]["started_at"].endswith("Z")


def test_an_activity_opened_first_starts_the_session_with_it(lab, db: Session) -> None:
    lab1 = publish(lab, "Lab 1", files=[{"path": "main.py", "content": "print(1)"}])
    entries = {e["path"]: e for e in lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()["entries"]}
    db.execute(SessionStart.__table__.delete())                      # as if the tree had not been loaded
    db.commit()
    lab.student.get(f"{API}/workspace/files/{entries['Lab 1/main.py']['id']}")
    assert (len(starts(db)), starts(db)[0].first_activity_id) == (1, lab1["id"])
    assert db.scalar(select(func.count()).select_from(SessionActivityStart)) == 1


# =========================================================================== who sees it

def test_only_the_classes_instructor_sees_it(lab, db: Session) -> None:
    tree(lab)
    url = f"{API}/sessions/{lab.session_id}/monitor"
    assert lab.student.get(url).status_code == 403
    assert login_as(db, Role.INSTRUCTOR, "teach2").get(url).status_code == 403
    assert monitor_row(lab)["started_at"] is not None
    assert "started_at" not in lab.student.get(f"{API}/workspace/{lab.cid}/tree").json()   # nothing for students
