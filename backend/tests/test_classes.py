import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import UNAMBIGUOUS_ALPHABET
from app.models.user import Role
from tests.conftest import login_as, new_class, new_code


@pytest.fixture()
def teacher(db: Session) -> TestClient:
    return login_as(db, Role.INSTRUCTOR, "teach1")


@pytest.fixture()
def other_teacher(db: Session) -> TestClient:
    return login_as(db, Role.INSTRUCTOR, "teach2")


# ---------- class CRUD ----------

def test_instructor_creates_and_reads_class(teacher: TestClient) -> None:
    r = teacher.post("/api/v1/classes", json={"name": " Prog 1 ", "year_and_section": "BSIT 1A", "school_year": "2026-2027"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Prog 1" and body["is_archived"] is False
    assert body["approved_count"] == 0 and body["pending_count"] == 0
    assert body["created_at"].endswith("Z")
    assert teacher.get(f"/api/v1/classes/{body['id']}").json()["id"] == body["id"]


def test_class_validation(teacher: TestClient) -> None:
    r = teacher.post("/api/v1/classes", json={"name": "", "year_and_section": "A", "school_year": "x"})
    assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"


def test_list_hides_archived_and_other_instructors_classes(teacher: TestClient, other_teacher: TestClient) -> None:
    keep = new_class(teacher, "Keep")
    old = new_class(teacher, "Old")
    new_class(other_teacher, "Theirs")

    assert teacher.patch(f"/api/v1/classes/{old}", json={"is_archived": True}).json()["is_archived"] is True
    listing = teacher.get("/api/v1/classes").json()
    assert [c["id"] for c in listing["items"]] == [keep] and listing["total"] == 1
    assert teacher.get("/api/v1/classes", params={"include_archived": True}).json()["total"] == 2
    assert teacher.patch(f"/api/v1/classes/{old}", json={"is_archived": False}).json()["is_archived"] is False


def test_class_pagination_cap(teacher: TestClient) -> None:
    assert teacher.get("/api/v1/classes", params={"size": 101}).status_code == 422


# ---------- ownership: an instructor can't touch another instructor's class ----------

def test_other_instructor_cannot_touch_class(teacher: TestClient, other_teacher: TestClient) -> None:
    cid = new_class(teacher)
    code = new_code(teacher, cid)

    for resp in [
        other_teacher.get(f"/api/v1/classes/{cid}"),
        other_teacher.patch(f"/api/v1/classes/{cid}", json={"name": "Hijacked"}),
        other_teacher.get(f"/api/v1/classes/{cid}/invite-codes"),
        other_teacher.post(f"/api/v1/classes/{cid}/invite-codes", json={"valid_until": "2099-01-01T00:00:00Z"}),
        other_teacher.patch(f"/api/v1/invite-codes/{code['id']}", json={"is_active": False}),
        other_teacher.get(f"/api/v1/classes/{cid}/enrollments"),
    ]:
        assert resp.status_code == 403, resp.request.url
        assert resp.json()["code"] == "NOT_CLASS_OWNER"

    assert teacher.get(f"/api/v1/classes/{cid}").json()["name"] == "Programming 1"  # untouched


def test_missing_class_is_404(teacher: TestClient) -> None:
    assert teacher.get("/api/v1/classes/99999").json()["code"] == "CLASS_NOT_FOUND"
    assert teacher.patch("/api/v1/invite-codes/99999", json={"is_active": False}).json()["code"] == "CODE_NOT_FOUND"


@pytest.mark.parametrize("role", [Role.STUDENT, Role.ADMIN])
def test_only_instructors_use_class_endpoints(db: Session, teacher: TestClient, role: Role) -> None:
    cid = new_class(teacher)
    c = login_as(db, role, "intruder")
    assert c.get("/api/v1/classes").status_code == 403
    assert c.post("/api/v1/classes", json={"name": "x", "year_and_section": "y", "school_year": "z"}).status_code == 403
    assert c.get(f"/api/v1/classes/{cid}").status_code == 403
    assert c.get(f"/api/v1/classes/{cid}/invite-codes").status_code == 403
    assert c.get(f"/api/v1/classes/{cid}/enrollments").status_code == 403
    assert c.patch("/api/v1/enrollments/1", json={"action": "approve"}).status_code == 403


def test_anonymous_cannot_use_class_endpoints(client: TestClient) -> None:
    assert client.get("/api/v1/classes").status_code == 401
    assert client.post("/api/v1/enroll", json={"code": "ABCDEFGH"}).status_code == 401


# ---------- invite codes ----------

def test_generated_code_format_and_uniqueness(teacher: TestClient) -> None:
    cid = new_class(teacher)
    codes = [new_code(teacher, cid)["code"] for _ in range(15)]
    assert len(set(codes)) == 15
    for code in codes:
        assert len(code) == 8 and set(code) <= set(UNAMBIGUOUS_ALPHABET)
    assert not set("0O1IL") & set(UNAMBIGUOUS_ALPHABET)


def test_new_code_defaults(teacher: TestClient) -> None:
    cid = new_class(teacher)
    r = teacher.post(f"/api/v1/classes/{cid}/invite-codes", json={"valid_until": "2099-01-01T00:00:00Z"})
    body = r.json()
    assert body["is_active"] is True and body["use_count"] == 0 and body["max_uses"] is None
    assert body["valid_from"].endswith("Z")


def test_code_window_must_be_ordered(teacher: TestClient) -> None:
    cid = new_class(teacher)
    r = teacher.post(f"/api/v1/classes/{cid}/invite-codes",
                     json={"valid_from": "2030-01-02T00:00:00Z", "valid_until": "2030-01-01T00:00:00Z"})
    assert r.status_code == 400 and r.json()["code"] == "INVALID_CODE_WINDOW"
    assert teacher.post(f"/api/v1/classes/{cid}/invite-codes",
                        json={"valid_until": "2099-01-01T00:00:00Z", "max_uses": 0}).status_code == 422


def test_timezone_offsets_are_converted_to_utc(teacher: TestClient) -> None:
    cid = new_class(teacher)
    r = teacher.post(f"/api/v1/classes/{cid}/invite-codes",
                     json={"valid_from": "2030-01-01T08:00:00+08:00", "valid_until": "2030-01-02T00:00:00Z"})
    assert r.json()["valid_from"] == "2030-01-01T00:00:00Z"


def test_update_invite_code(teacher: TestClient) -> None:
    cid = new_class(teacher)
    code = new_code(teacher, cid, max_uses=5)
    url = f"/api/v1/invite-codes/{code['id']}"

    assert teacher.patch(url, json={"is_active": False}).json()["is_active"] is False
    assert teacher.patch(url, json={"valid_until": "2099-06-01T00:00:00Z"}).json()["valid_until"] == "2099-06-01T00:00:00Z"
    assert teacher.patch(url, json={"max_uses": None}).json()["max_uses"] is None  # explicit null removes limit
    assert teacher.patch(url, json={"is_active": True}).json()["max_uses"] is None  # omitted = unchanged
    bad = teacher.patch(url, json={"valid_until": "2000-01-01T00:00:00Z"})
    assert bad.status_code == 400 and bad.json()["code"] == "INVALID_CODE_WINDOW"


def test_list_invite_codes(teacher: TestClient) -> None:
    cid = new_class(teacher)
    for _ in range(3):
        new_code(teacher, cid)
    page = teacher.get(f"/api/v1/classes/{cid}/invite-codes", params={"size": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 2
