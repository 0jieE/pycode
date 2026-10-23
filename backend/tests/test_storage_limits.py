"""Workspace storage limits set by an admin: per role (student, instructor) and per user. They apply to each workspace
of the user, show in the tree's `usage`, and lowering them deletes nothing."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import Role, User
from app.services import storage_service
from tests.conftest import approved_student, login_as

API = "/api/v1"
KB = 1024
MB = 1024 * 1024


@pytest.fixture()
def admin(db: Session) -> TestClient:
    return login_as(db, Role.ADMIN, "root")


def limits(admin: TestClient) -> dict:
    r = admin.get(f"{API}/storage-limits")
    assert r.status_code == 200, r.text
    return r.json()


def set_role(admin: TestClient, role: str, **body):
    return admin.patch(f"{API}/storage-limits/{role}", json=body)


def mk(c: TestClient, cid: int, path: str, size: int):
    return c.post(f"{API}/workspace/{cid}/files", json={"path": path, "content": "x" * size})


def save(c: TestClient, file: dict, size: int):
    return c.put(f"{API}/workspace/files/{file['id']}", json={"content": "x" * size,
                                                              "last_updated_at": file["updated_at"]})


def usage(c: TestClient, cid: int) -> dict:
    return c.get(f"{API}/workspace/{cid}/tree").json()["usage"]


def uid(db: Session, username: str) -> int:
    return db.scalar(select(User.id).where(User.username == username))


# =========================================================================== role limits

def test_the_defaults_until_an_admin_changes_them(admin, lab) -> None:
    got = limits(admin)
    for role in ("student", "instructor"):
        assert got[role] == {"max_file_bytes": 100 * KB, "max_workspace_bytes": 2 * MB, "max_files": 100,
                             "updated_at": None, "updated_by": None}
    assert got["bounds"] == {"max_file_bytes": {"min": KB, "max": MB},
                             "max_workspace_bytes": {"min": 10 * KB, "max": 8 * MB},
                             "max_files": {"min": 1, "max": 500}}
    u = usage(lab.student, lab.cid)
    assert (u["max_file_bytes"], u["max_bytes"], u["max_files"]) == (100 * KB, 2 * MB, 100)


def test_only_admins_see_and_change_them(admin, lab) -> None:
    for c in (lab.teacher, lab.student):
        assert c.get(f"{API}/storage-limits").status_code == 403
        assert set_role(c, "student", max_files=5).status_code == 403
        assert c.get(f"{API}/users/1/storage").status_code == 403


def test_a_smaller_file_limit_applies_at_once(admin, lab, db: Session) -> None:
    r = set_role(admin, "student", max_file_bytes=20 * KB)
    assert r.status_code == 200 and r.json()["student"]["max_file_bytes"] == 20 * KB
    assert r.json()["student"]["max_workspace_bytes"] == 2 * MB                  # the rest is kept
    assert r.json()["student"]["updated_by"] == uid(db, "root") and r.json()["student"]["updated_at"].endswith("Z")
    assert r.json()["instructor"]["max_file_bytes"] == 100 * KB                  # the other role is untouched

    assert usage(lab.student, lab.cid)["max_file_bytes"] == 20 * KB
    big = mk(lab.student, lab.cid, "big.txt", 30 * KB)
    assert big.status_code == 413 and big.json() == {"detail": "File is larger than 20 KB", "code": "FILE_TOO_LARGE"}
    assert mk(lab.student, lab.cid, "ok.txt", 20 * KB).status_code == 201
    # instructors keep their own limit (their Practice workspace)
    assert lab.teacher.post(f"{API}/practice/files", json={"path": "big.txt", "content": "x" * 30 * KB}).status_code == 201

    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "storage_limits_update")).one()
    assert row.details == {"role": "student", "max_file_bytes": 20 * KB}


def test_the_workspace_limit_and_lowering_it_below_what_is_used(admin, lab) -> None:
    a = mk(lab.student, lab.cid, "a.txt", 40 * KB).json()
    assert set_role(admin, "student", max_workspace_bytes=30 * KB, max_file_bytes=30 * KB).status_code == 200
    assert usage(lab.student, lab.cid)["bytes"] == 40 * KB                       # nothing was deleted
    r = mk(lab.student, lab.cid, "b.txt", 1)
    assert r.status_code == 413 and r.json() == {"detail": "Workspace storage limit (30 KB) reached",
                                                 "code": "QUOTA_EXCEEDED"}
    assert save(lab.student, a, 41 * KB).json()["code"] == "FILE_TOO_LARGE"      # (larger than a file may be)
    shrunk = save(lab.student, a, 25 * KB)                                       # making it smaller still works
    assert shrunk.status_code == 200, shrunk.text
    a["updated_at"] = shrunk.json()["updated_at"]
    assert save(lab.student, a, 30 * KB).status_code == 200                      # up to the limit again


def test_the_file_count_limit(admin, lab) -> None:
    assert set_role(admin, "student", max_files=3).status_code == 200
    for i in range(3):
        assert mk(lab.student, lab.cid, f"f{i}.py", 1).status_code == 201
    r = mk(lab.student, lab.cid, "f3.py", 1)
    assert r.status_code == 400 and r.json() == {"detail": "A workspace can have at most 3 files",
                                                 "code": "TOO_MANY_FILES"}
    assert usage(lab.student, lab.cid)["max_files"] == 3


def test_the_instructor_limits_apply_to_instructors(admin, lab) -> None:
    assert set_role(admin, "instructor", max_file_bytes=2 * KB).status_code == 200
    r = lab.teacher.post(f"{API}/practice/files", json={"path": "a.py", "content": "x" * 3 * KB})
    assert r.status_code == 413 and r.json()["detail"] == "File is larger than 2 KB"
    assert lab.teacher.get(f"{API}/practice/tree").json()["usage"]["max_file_bytes"] == 2 * KB
    assert mk(lab.student, lab.cid, "a.py", 3 * KB).status_code == 201         # students: not affected


def test_invalid_role_limits(admin) -> None:
    r = set_role(admin, "student", max_file_bytes=MB, max_workspace_bytes=512 * KB)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_STORAGE_LIMITS"
    assert set_role(admin, "student", max_workspace_bytes=50 * KB).json()["code"] == "INVALID_STORAGE_LIMITS"  # < file
    for body in ({"max_workspace_bytes": 9 * MB}, {"max_file_bytes": 512}, {"max_files": 0}, {"max_files": 501},
                 {"max_files": None}, {"max_folders": 5}):
        assert set_role(admin, "student", **body).status_code == 422, body
    r = set_role(admin, "admin", max_files=5)
    assert r.status_code == 404 and r.json()["code"] == "ROLE_NOT_FOUND"
    assert limits(admin)["student"]["updated_at"] is None                        # nothing was saved


def test_starter_files_follow_the_students_file_limit(admin, lab) -> None:
    assert set_role(admin, "student", max_file_bytes=20 * KB).status_code == 200
    r = lab.teacher.post(f"{API}/classes/{lab.cid}/activities", json={
        "title": "Lab 1", "starter_files": [{"path": "main.py", "content": "x" * 30 * KB}]})
    assert r.status_code == 400 and r.json() == {"detail": "main.py is larger than 20 KB", "code": "FILE_TOO_LARGE"}


# =========================================================================== one user's own limits

def test_a_user_can_get_their_own_limits(admin, lab, db: Session) -> None:
    stu = uid(db, "stu1")
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    r = admin.put(f"{API}/users/{stu}/storage", json={"max_file_bytes": 500 * KB, "max_workspace_bytes": 4 * MB})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role_limits"] == {"max_file_bytes": 100 * KB, "max_workspace_bytes": 2 * MB, "max_files": 100}
    assert body["override"] == {"max_file_bytes": 500 * KB, "max_workspace_bytes": 4 * MB, "max_files": None}
    assert body["effective"] == {"max_file_bytes": 500 * KB, "max_workspace_bytes": 4 * MB, "max_files": 100}

    assert mk(lab.student, lab.cid, "big.txt", 300 * KB).status_code == 201
    assert usage(lab.student, lab.cid)["max_bytes"] == 4 * MB
    assert mk(other, lab.cid, "big.txt", 300 * KB).json()["code"] == "FILE_TOO_LARGE"   # others keep the role's

    # the role changes: a field the user has their own value for does not follow
    set_role(admin, "student", max_files=7)
    assert admin.get(f"{API}/users/{stu}/storage").json()["effective"]["max_files"] == 7
    assert admin.get(f"{API}/users/{stu}/storage").json()["effective"]["max_file_bytes"] == 500 * KB

    r = admin.put(f"{API}/users/{stu}/storage", json={})                         # back to the role's
    assert r.json()["override"] == {"max_file_bytes": None, "max_workspace_bytes": None, "max_files": None}
    assert r.json()["effective"] == {"max_file_bytes": 100 * KB, "max_workspace_bytes": 2 * MB, "max_files": 7}
    rows = db.scalars(select(ActivityLog).where(ActivityLog.action == "user_storage_update")).all()
    assert len(rows) == 2 and rows[0].details["target_user_id"] == stu


def test_the_user_view_lists_each_workspace(admin, lab, db: Session) -> None:
    mk(lab.student, lab.cid, "a.txt", 3 * KB)
    lab.student.post(f"{API}/practice/files", json={"path": "p.py", "content": "x" * KB})
    ws = admin.get(f"{API}/users/{uid(db, 'stu1')}/storage").json()["workspaces"]
    assert [(w["class_name"], w["files"], w["bytes"]) for w in ws] == [("Programming 1", 1, 3 * KB), (None, 1, KB)]
    assert ws[0]["class_id"] == lab.cid and ws[1]["class_id"] is None


def test_invalid_user_limits(admin, lab, db: Session) -> None:
    stu = uid(db, "stu1")
    r = admin.put(f"{API}/users/{stu}/storage", json={"max_workspace_bytes": 50 * KB})   # < the role's 100 KB file
    assert r.status_code == 400 and r.json()["code"] == "INVALID_STORAGE_LIMITS"
    assert admin.get(f"{API}/users/{stu}/storage").json()["override"]["max_workspace_bytes"] is None   # not saved
    assert admin.put(f"{API}/users/{stu}/storage", json={"max_files": 1000}).status_code == 422
    r = admin.put(f"{API}/users/{uid(db, 'root')}/storage", json={})
    assert r.status_code == 400 and r.json()["code"] == "NO_WORKSPACE"
    r = admin.get(f"{API}/users/999999/storage")
    assert r.status_code == 404 and r.json()["code"] == "USER_NOT_FOUND"


def test_human_sizes() -> None:
    assert [storage_service.human(n) for n in (512, KB, 1536, 20 * KB, 2 * MB, 1536 * KB)] == \
        ["512 bytes", "1 KB", "1.5 KB", "20 KB", "2 MB", "1.5 MB"]


# =========================================================================== clearing a workspace

def clear(admin: TestClient, user_id: int, workspace_id: int):
    return admin.post(f"{API}/users/{user_id}/workspaces/{workspace_id}/clear")


def test_clearing_a_class_workspace_puts_the_starter_files_back(admin, lab, db: Session) -> None:
    from app.models.submission import Submission
    from app.models.workspace import FileVersion, WorkspaceFile
    from tests.test_submissions import edit, publish, submit, tree_entries

    a = publish(lab, "Lab 1", files=[{"path": "main.py", "content": "print('starter')"}])
    edit(lab.student, lab.cid, "Lab 1/main.py", "print('my answer')")
    assert submit(lab.student, a["id"]).status_code in (200, 201)
    mk(lab.student, lab.cid, "Lab 1/helper.py", 2 * KB)
    mk(lab.student, lab.cid, "notes.txt", 3 * KB)
    main = tree_entries(lab.student, lab.cid)["Lab 1/main.py"]
    lab.student.put(f"{API}/workspace/files/{main['id']}", params={"version": True},
                    json={"content": "print('v2')", "last_updated_at": main["updated_at"]})
    stu = uid(db, "stu1")
    ws = admin.get(f"{API}/users/{stu}/storage").json()["workspaces"][0]
    assert ws["files"] == 3

    r = clear(admin, stu, ws["workspace_id"])
    assert r.status_code == 200, r.text
    assert r.json() == {"workspace_id": ws["workspace_id"], "class_id": lab.cid, "files_deleted": 3,
                        "bytes_deleted": ws["bytes"], "starter_files_restored": 1}
    after = tree_entries(lab.student, lab.cid)
    assert sorted(after) == ["Lab 1", "Lab 1/main.py"]                          # like a newly enrolled student
    assert lab.student.get(f"{API}/workspace/files/{after['Lab 1/main.py']['id']}").json()["content"] == \
        "print('starter')"
    db.expire_all()
    assert db.scalar(select(FileVersion.id).join(WorkspaceFile).where(
        WorkspaceFile.workspace_id == ws["workspace_id"])) is None                # saved versions went too
    assert db.scalar(select(Submission.id).where(Submission.activity_id == a["id"])) is not None   # untouched
    row = db.scalars(select(ActivityLog).where(ActivityLog.action == "workspace_clear")).one()
    assert row.details == {"target_user_id": stu, "workspace_id": ws["workspace_id"], "class_id": lab.cid,
                           "files_deleted": 3, "bytes_deleted": ws["bytes"], "starter_files_restored": 1}

    # a save of a file that no longer exists: the usual 404 (the page reloads the tree)
    r = lab.student.put(f"{API}/workspace/files/{main['id']}", json={"content": "x", "last_updated_at": main["updated_at"]})
    assert r.status_code == 404 and r.json()["code"] == "FILE_NOT_FOUND"


def test_clearing_the_practice_workspace_leaves_it_empty(admin, lab, db: Session) -> None:
    lab.student.post(f"{API}/practice/files", json={"path": "p.py", "content": "x" * KB})
    lab.student.post(f"{API}/practice/files", json={"path": "dir/q.py", "content": "y"})
    stu = uid(db, "stu1")
    practice = [w for w in admin.get(f"{API}/users/{stu}/storage").json()["workspaces"] if w["class_id"] is None][0]
    r = clear(admin, stu, practice["workspace_id"])
    assert r.json() == {"workspace_id": practice["workspace_id"], "class_id": None, "files_deleted": 2,
                        "bytes_deleted": KB + 1, "starter_files_restored": 0}
    assert lab.student.get(f"{API}/practice/tree").json()["entries"] == []


def test_clearing_needs_an_admin_and_the_users_own_workspace(admin, lab, db: Session) -> None:
    stu, teacher = uid(db, "stu1"), uid(db, "teach1")
    lab.teacher.get(f"{API}/practice/tree")                                     # creates the teacher's Practice
    mine = admin.get(f"{API}/users/{stu}/storage").json()["workspaces"][0]["workspace_id"]
    theirs = admin.get(f"{API}/users/{teacher}/storage").json()["workspaces"][0]["workspace_id"]
    r = clear(admin, stu, theirs)                                               # not this user's workspace
    assert r.status_code == 404 and r.json()["code"] == "WORKSPACE_NOT_FOUND"
    assert clear(admin, 999999, mine).json()["code"] == "USER_NOT_FOUND"
    for c in (lab.teacher, lab.student):
        assert clear(c, stu, mine).status_code == 403
