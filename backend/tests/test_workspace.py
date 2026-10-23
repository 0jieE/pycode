from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.user import Role
from app.models.workspace import FileVersion
from tests.conftest import approved_student, login_as, new_class, new_code, new_session

KB = 1024


def mk(c: TestClient, cid: int, path: str, content: str = "", folder: bool = False):
    return c.post(f"/api/v1/workspace/{cid}/files", json={"path": path, "content": content, "is_folder": folder})


def tree(c: TestClient, cid: int) -> dict:
    r = c.get(f"/api/v1/workspace/{cid}/tree")
    assert r.status_code == 200, r.text
    return r.json()


def entry(c: TestClient, cid: int, path: str) -> dict:
    return next(e for e in tree(c, cid)["entries"] if e["path"] == path)


def paths(c: TestClient, cid: int) -> set[str]:
    return {e["path"] for e in tree(c, cid)["entries"]}


def save(c: TestClient, fid: int, content: str, token: str, version: bool = False):
    return c.put(f"/api/v1/workspace/files/{fid}", params={"version": version},
                 json={"content": content, "last_updated_at": token})


def rename(c: TestClient, fid: int, new_path: str):
    return c.patch(f"/api/v1/workspace/files/{fid}", json={"new_path": new_path})


def close_lab(lab) -> None:
    assert lab.teacher.patch(f"/api/v1/sessions/{lab.session_id}/close").status_code == 200


# ================================================================= basics

def test_create_read_and_tree(lab) -> None:
    r = mk(lab.student, lab.cid, "hello.py", "print('hi')")
    assert r.status_code == 201
    body = r.json()
    assert body["path"] == "hello.py" and body["content"] == "print('hi')" and body["size_bytes"] == 11
    assert body["is_folder"] is False and body["updated_at"].endswith("Z")

    got = lab.student.get(f"/api/v1/workspace/files/{body['id']}").json()
    assert got["content"] == "print('hi')"

    t = tree(lab.student, lab.cid)
    assert [e["path"] for e in t["entries"]] == ["hello.py"]
    assert all("content" not in e for e in t["entries"])  # the tree never carries content
    assert t["usage"] == {"files": 1, "folders": 0, "bytes": 11, "max_files": 100, "max_folders": 100,
                          "max_bytes": 2 * 1024 * KB, "max_file_bytes": 100 * KB}


def test_create_folder_and_nested_file_creates_missing_parents(lab) -> None:
    assert mk(lab.student, lab.cid, "data", folder=True).status_code == 201
    r = mk(lab.student, lab.cid, "a/b/c.py", "x = 1")
    assert r.status_code == 201
    assert paths(lab.student, lab.cid) == {"data", "a", "a/b", "a/b/c.py"}
    assert entry(lab.student, lab.cid, "a/b")["is_folder"] is True
    assert entry(lab.student, lab.cid, "a/b")["size_bytes"] == 0


def test_folder_has_no_content_and_cannot_be_saved(lab) -> None:
    folder = mk(lab.student, lab.cid, "data", content="ignored", folder=True).json()
    assert folder["content"] is None and folder["size_bytes"] == 0
    r = save(lab.student, folder["id"], "x", folder["updated_at"])
    assert r.status_code == 400 and r.json()["code"] == "IS_FOLDER"


def test_duplicate_path_conflicts_case_insensitively(lab) -> None:
    assert mk(lab.student, lab.cid, "a.py").status_code == 201
    for p in ("a.py", "A.PY"):
        r = mk(lab.student, lab.cid, p)
        assert r.status_code == 409 and r.json()["code"] == "PATH_EXISTS"


def test_a_file_cannot_be_used_as_a_parent_folder(lab) -> None:
    mk(lab.student, lab.cid, "x.py")
    r = mk(lab.student, lab.cid, "x.py/y.py")
    assert r.status_code == 409 and r.json()["code"] == "PATH_CONFLICT"


# ============================================================ path safety

BAD_PATHS = ["../x.py", "/etc/x.py", "a\\b.py", "a/../../x.py", "a//b.py", ".hidden.py", "a/.b.py", "./x.py", "a/"]


@pytest.mark.parametrize("path", BAD_PATHS)
def test_create_rejects_unsafe_paths(lab, path: str) -> None:
    r = mk(lab.student, lab.cid, path)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATH"
    assert paths(lab.student, lab.cid) == set()  # nothing was created, not even parents


@pytest.mark.parametrize("path", ["../x", "/etc", "a\\b", ".git", "a//b", "x/"])
def test_create_folder_rejects_unsafe_paths(lab, path: str) -> None:
    assert mk(lab.student, lab.cid, path, folder=True).status_code == 400


@pytest.mark.parametrize("path", BAD_PATHS)
def test_rename_rejects_unsafe_paths(lab, path: str) -> None:
    f = mk(lab.student, lab.cid, "ok.py").json()
    r = rename(lab.student, f["id"], path)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_PATH"
    assert paths(lab.student, lab.cid) == {"ok.py"}


def test_path_longer_than_255_rejected(lab) -> None:
    assert mk(lab.student, lab.cid, "a" * 252 + ".py").status_code == 201
    assert mk(lab.student, lab.cid, "a" * 253 + ".py").json()["code"] == "INVALID_PATH"


@pytest.mark.parametrize("path", ["run.exe", "noext", "a.sh", "x.py.exe", "archive.zip"])
def test_bad_extension_rejected(lab, path: str) -> None:
    r = mk(lab.student, lab.cid, path)
    assert r.status_code == 400 and r.json()["code"] == "INVALID_EXTENSION"


@pytest.mark.parametrize("path", ["a.py", "a.txt", "a.csv", "a.json", "a.md", "A.PY"])
def test_allowed_extensions(lab, path: str) -> None:
    assert mk(lab.student, lab.cid, path).status_code == 201


def test_rename_cannot_change_to_a_bad_extension(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    assert rename(lab.student, f["id"], "a.exe").json()["code"] == "INVALID_EXTENSION"


# ================================================================ limits

def test_file_size_limit_is_100kb_in_bytes(lab) -> None:
    assert mk(lab.student, lab.cid, "ok.py", "x" * (100 * KB)).status_code == 201
    r = mk(lab.student, lab.cid, "big.py", "x" * (100 * KB + 1))
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"
    # multibyte: 60,000 characters but 120,000 bytes
    assert mk(lab.student, lab.cid, "uni.py", "é" * 60000).json()["code"] == "FILE_TOO_LARGE"
    assert paths(lab.student, lab.cid) == {"ok.py"}


def test_save_enforces_file_size_and_keeps_old_content(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "old").json()
    r = save(lab.student, f["id"], "x" * (100 * KB + 1), f["updated_at"])
    assert r.status_code == 413 and r.json()["code"] == "FILE_TOO_LARGE"
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").json()["content"] == "old"


def test_workspace_quota_of_2mb(lab) -> None:
    chunk = "x" * (100 * KB)
    for i in range(20):  # 20 x 100 KB = 2,000 KB < 2 MB
        assert mk(lab.student, lab.cid, f"f{i:02d}.txt", chunk).status_code == 201
    r = mk(lab.student, lab.cid, "one_more.txt", chunk)  # would reach 2,100 KB
    assert r.status_code == 413 and r.json()["code"] == "QUOTA_EXCEEDED"
    assert mk(lab.student, lab.cid, "small.txt", "x" * 40 * KB).status_code == 201  # 2,040 KB still fits
    usage = tree(lab.student, lab.cid)["usage"]
    assert usage["bytes"] == 20 * 100 * KB + 40 * KB


def test_save_that_would_exceed_the_quota_is_rejected_but_shrinking_is_fine(lab) -> None:
    chunk = "x" * (100 * KB)
    for i in range(20):
        mk(lab.student, lab.cid, f"f{i:02d}.txt", chunk)
    small = mk(lab.student, lab.cid, "small.txt", "x" * 40 * KB).json()
    grow = save(lab.student, small["id"], chunk, small["updated_at"])  # +60 KB -> over 2 MB
    assert grow.status_code == 413 and grow.json()["code"] == "QUOTA_EXCEEDED"
    shrink = save(lab.student, small["id"], "tiny", small["updated_at"])
    assert shrink.status_code == 200 and shrink.json()["size_bytes"] == 4


def test_deleting_frees_quota(lab) -> None:
    chunk = "x" * (100 * KB)
    ids = [mk(lab.student, lab.cid, f"f{i:02d}.txt", chunk).json()["id"] for i in range(20)]
    assert mk(lab.student, lab.cid, "big.txt", chunk).status_code == 413
    lab.student.delete(f"/api/v1/workspace/files/{ids[0]}")
    assert mk(lab.student, lab.cid, "big.txt", chunk).status_code == 201


def test_limit_of_100_files(lab) -> None:
    for i in range(100):
        assert mk(lab.student, lab.cid, f"f{i:03d}.txt").status_code == 201
    r = mk(lab.student, lab.cid, "f100.txt")
    assert r.status_code == 400 and r.json()["code"] == "TOO_MANY_FILES"
    assert mk(lab.student, lab.cid, "folder", folder=True).status_code == 201  # folders are counted separately


def test_limit_of_100_folders(lab) -> None:
    for i in range(100):
        assert mk(lab.student, lab.cid, f"d{i:03d}", folder=True).status_code == 201
    assert mk(lab.student, lab.cid, "d100", folder=True).json()["code"] == "TOO_MANY_FILES"
    assert mk(lab.student, lab.cid, "newdir/x.py").json()["code"] == "TOO_MANY_FILES"  # implicit parent counts too


def test_parallel_creates_cannot_exceed_the_file_limit(lab) -> None:
    for i in range(95):
        mk(lab.student, lab.cid, f"f{i:03d}.txt")
    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(lambda i: mk(lab.student, lab.cid, f"race{i}.txt"), range(10)))
    assert sorted(r.status_code for r in results) == [201] * 5 + [400] * 5
    assert tree(lab.student, lab.cid)["usage"]["files"] == 100


# ======================================================== save + conflicts

def test_save_updates_content_size_and_token(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "v1").json()
    r = save(lab.student, f["id"], "version two", f["updated_at"])
    assert r.status_code == 200
    meta = r.json()
    assert meta["size_bytes"] == 11 and meta["updated_at"] != f["updated_at"] and "content" not in meta
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").json()["content"] == "version two"
    assert tree(lab.student, lab.cid)["usage"]["bytes"] == 11


def test_stale_save_gets_409_and_does_not_overwrite(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "v1").json()
    t0 = f["updated_at"]
    t1 = save(lab.student, f["id"], "from tab 1", t0).json()["updated_at"]

    stale = save(lab.student, f["id"], "from tab 2", t0)  # a second tab still holding the old token
    assert stale.status_code == 409 and stale.json()["code"] == "SAVE_CONFLICT"
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").json()["content"] == "from tab 1"

    assert save(lab.student, f["id"], "from tab 2, reloaded", t1).status_code == 200


def test_token_with_wrong_time_is_a_conflict(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    assert save(lab.student, f["id"], "x", "2000-01-01T00:00:00Z").status_code == 409
    assert lab.student.put(f"/api/v1/workspace/files/{f['id']}", json={"content": "x"}).status_code == 422


def test_parallel_saves_with_the_same_token_only_one_wins(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "v1").json()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: save(lab.student, f["id"], f"writer {i}", f["updated_at"]), range(6)))
    assert sorted(r.status_code for r in results) == [200] + [409] * 5


def test_back_to_back_saves_with_chained_tokens(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    token = f["updated_at"]
    for i in range(10):
        r = save(lab.student, f["id"], f"rev {i}", token)
        assert r.status_code == 200
        assert r.json()["updated_at"] != token
        token = r.json()["updated_at"]


def test_save_to_a_deleted_file_is_404(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    lab.student.delete(f"/api/v1/workspace/files/{f['id']}")
    assert save(lab.student, f["id"], "x", f["updated_at"]).status_code == 404


# ================================================================ versions

def versions(c: TestClient, fid: int, **params) -> dict:
    return c.get(f"/api/v1/workspace/files/{fid}/versions", params=params).json()


def test_autosave_never_writes_a_version_manual_save_does(lab, db: Session) -> None:
    f = mk(lab.student, lab.cid, "a.py", "v0").json()
    t = save(lab.student, f["id"], "autosaved", f["updated_at"]).json()["updated_at"]
    assert versions(lab.student, f["id"])["total"] == 0

    t = save(lab.student, f["id"], "manual save", t, version=True).json()["updated_at"]
    page = versions(lab.student, f["id"])
    assert page["total"] == 1 and page["items"][0]["size_bytes"] == len("manual save")

    got = lab.student.get(f"/api/v1/workspace/versions/{page['items'][0]['id']}").json()
    assert got["content"] == "manual save" and got["file_id"] == f["id"]


def test_only_the_last_20_versions_are_kept(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    token = f["updated_at"]
    for i in range(25):
        token = save(lab.student, f["id"], f"manual {i}", token, version=True).json()["updated_at"]

    page = versions(lab.student, f["id"], size=100)
    assert page["total"] == 20 and len(page["items"]) == 20
    newest = lab.student.get(f"/api/v1/workspace/versions/{page['items'][0]['id']}").json()["content"]
    oldest = lab.student.get(f"/api/v1/workspace/versions/{page['items'][-1]['id']}").json()["content"]
    assert newest == "manual 24" and oldest == "manual 5"  # 0..4 were pruned


def test_pruning_is_per_file(lab) -> None:
    a, b = (mk(lab.student, lab.cid, n).json() for n in ("a.py", "b.py"))
    ta, tb = a["updated_at"], b["updated_at"]
    for i in range(22):
        ta = save(lab.student, a["id"], f"a{i}", ta, version=True).json()["updated_at"]
    tb = save(lab.student, b["id"], "b0", tb, version=True).json()["updated_at"]
    assert versions(lab.student, a["id"])["total"] == 20
    assert versions(lab.student, b["id"])["total"] == 1


def test_versions_list_is_paginated_newest_first(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    token = f["updated_at"]
    for i in range(5):
        token = save(lab.student, f["id"], f"m{i}", token, version=True).json()["updated_at"]
    page = versions(lab.student, f["id"], size=2, page=1)
    assert len(page["items"]) == 2 and page["total"] == 5
    assert page["items"][0]["id"] > page["items"][1]["id"]
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}/versions", params={"size": 101}).status_code == 422


def test_versions_are_private(lab, db: Session) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    save(lab.student, f["id"], "secret", f["updated_at"], version=True)
    vid = versions(lab.student, f["id"])["items"][0]["id"]
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    assert other.get(f"/api/v1/workspace/versions/{vid}").status_code == 404
    assert other.get(f"/api/v1/workspace/files/{f['id']}/versions").status_code == 404
    assert lab.student.get("/api/v1/workspace/versions/99999").json()["code"] == "VERSION_NOT_FOUND"


# ============================================================ rename / move

def test_rename_file_keeps_content_and_token(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "keep me").json()
    r = rename(lab.student, f["id"], "b.py")
    assert r.status_code == 200 and r.json()["path"] == "b.py"
    assert r.json()["updated_at"] == f["updated_at"]  # an open editor's token stays valid
    assert paths(lab.student, lab.cid) == {"b.py"}
    assert save(lab.student, f["id"], "still editable", f["updated_at"]).status_code == 200


def test_move_file_into_new_folder_creates_it(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    rename(lab.student, f["id"], "sub/dir/a.py")
    assert paths(lab.student, lab.cid) == {"sub", "sub/dir", "sub/dir/a.py"}


def test_rename_onto_existing_path_conflicts(lab) -> None:
    a = mk(lab.student, lab.cid, "a.py").json()
    mk(lab.student, lab.cid, "b.py")
    r = rename(lab.student, a["id"], "B.py")
    assert r.status_code == 409 and r.json()["code"] == "PATH_EXISTS"


def test_case_only_rename_is_allowed(lab) -> None:
    f = mk(lab.student, lab.cid, "main.py").json()
    assert rename(lab.student, f["id"], "Main.py").json()["path"] == "Main.py"


def test_rename_folder_moves_everything_under_it(lab) -> None:
    mk(lab.student, lab.cid, "lab1/main.py", "m")
    mk(lab.student, lab.cid, "lab1/data/nums.csv", "1,2")
    mk(lab.student, lab.cid, "lab10/other.py", "untouched")  # shares the text prefix "lab1"
    mk(lab.student, lab.cid, "top.py")
    child = entry(lab.student, lab.cid, "lab1/main.py")
    folder = entry(lab.student, lab.cid, "lab1")

    r = rename(lab.student, folder["id"], "homework")
    assert r.status_code == 200 and r.json()["path"] == "homework"
    assert paths(lab.student, lab.cid) == {
        "homework", "homework/main.py", "homework/data", "homework/data/nums.csv",
        "lab10", "lab10/other.py", "top.py"}

    moved = entry(lab.student, lab.cid, "homework/main.py")
    assert moved["id"] == child["id"] and moved["updated_at"] == child["updated_at"]
    assert lab.student.get(f"/api/v1/workspace/files/{child['id']}").json()["content"] == "m"
    assert save(lab.student, child["id"], "edited after move", child["updated_at"]).status_code == 200


def test_rename_folder_does_not_treat_underscore_or_percent_as_wildcards(lab) -> None:
    mk(lab.student, lab.cid, "a_b/x.py")
    mk(lab.student, lab.cid, "aXb/y.py")
    mk(lab.student, lab.cid, "50%/z.py")
    mk(lab.student, lab.cid, "50 percent/w.py")
    rename(lab.student, entry(lab.student, lab.cid, "a_b")["id"], "renamed")
    rename(lab.student, entry(lab.student, lab.cid, "50%")["id"], "half")
    assert paths(lab.student, lab.cid) == {
        "renamed", "renamed/x.py", "aXb", "aXb/y.py", "half", "half/z.py", "50 percent", "50 percent/w.py"}


def test_cannot_move_folder_into_itself(lab) -> None:
    mk(lab.student, lab.cid, "a/b/c.py")
    folder = entry(lab.student, lab.cid, "a")
    for target in ("a/b/a", "a/new", "A/x"):
        r = rename(lab.student, folder["id"], target)
        assert r.status_code == 400 and r.json()["code"] == "INVALID_MOVE"
    assert "a/b/c.py" in paths(lab.student, lab.cid)


def test_rename_folder_onto_existing_conflicts_and_changes_nothing(lab) -> None:
    mk(lab.student, lab.cid, "a/x.py")
    mk(lab.student, lab.cid, "b/y.py")
    r = rename(lab.student, entry(lab.student, lab.cid, "a")["id"], "b")
    assert r.status_code == 409
    assert paths(lab.student, lab.cid) == {"a", "a/x.py", "b", "b/y.py"}


def test_move_folder_under_another_folder(lab) -> None:
    mk(lab.student, lab.cid, "a/x.py")
    mk(lab.student, lab.cid, "archive", folder=True)
    rename(lab.student, entry(lab.student, lab.cid, "a")["id"], "archive/a")
    assert paths(lab.student, lab.cid) == {"archive", "archive/a", "archive/a/x.py"}


def test_rename_to_same_path_is_a_noop(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    assert rename(lab.student, f["id"], "a.py").status_code == 200


# ================================================================== delete

def test_delete_file(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    assert lab.student.delete(f"/api/v1/workspace/files/{f['id']}").status_code == 204
    assert paths(lab.student, lab.cid) == set()
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").status_code == 404


def test_delete_folder_deletes_everything_under_it_and_only_that(lab, db: Session) -> None:
    mk(lab.student, lab.cid, "lab/a.py")
    mk(lab.student, lab.cid, "lab/deep/b.py")
    mk(lab.student, lab.cid, "lab2/keep.py")  # same text prefix, different folder
    mk(lab.student, lab.cid, "lab_x/keep.py")
    child = entry(lab.student, lab.cid, "lab/a.py")
    save(lab.student, child["id"], "v", child["updated_at"], version=True)

    assert lab.student.delete(f"/api/v1/workspace/files/{entry(lab.student, lab.cid, 'lab')['id']}").status_code == 204
    assert paths(lab.student, lab.cid) == {"lab2", "lab2/keep.py", "lab_x", "lab_x/keep.py"}
    db.rollback()
    assert db.scalar(select(func.count()).select_from(FileVersion)) == 0  # history went with the file


# =========================================================== lab open/closed

def test_every_write_is_blocked_while_the_lab_is_closed_but_reads_work(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "content").json()
    folder = mk(lab.student, lab.cid, "d", folder=True).json()
    token = save(lab.student, f["id"], "v2", f["updated_at"], version=True).json()["updated_at"]
    close_lab(lab)

    closed = {"detail": "Laboratory access is closed", "code": "LAB_CLOSED"}
    for r in (
        mk(lab.student, lab.cid, "new.py"),
        save(lab.student, f["id"], "v3", token),
        rename(lab.student, f["id"], "b.py"),
        lab.student.delete(f"/api/v1/workspace/files/{f['id']}"),
        lab.student.delete(f"/api/v1/workspace/files/{folder['id']}"),
    ):
        assert r.status_code == 403 and r.json() == closed

    assert paths(lab.student, lab.cid) == {"a.py", "d"}  # nothing changed
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").json()["content"] == "v2"
    assert versions(lab.student, f["id"])["total"] == 1
    vid = versions(lab.student, f["id"])["items"][0]["id"]
    assert lab.student.get(f"/api/v1/workspace/versions/{vid}").status_code == 200


def test_writes_work_again_when_the_lab_reopens(lab) -> None:
    close_lab(lab)
    assert mk(lab.student, lab.cid, "a.py").status_code == 403
    lab.teacher.patch(f"/api/v1/sessions/{lab.session_id}/open")
    assert mk(lab.student, lab.cid, "a.py").status_code == 201


def test_another_class_being_open_does_not_unlock_this_one(db: Session, lab) -> None:
    close_lab(lab)
    other_cid = new_class(lab.teacher, "Other")
    other_session = new_session(lab.teacher, other_cid)
    lab.teacher.patch(f"/api/v1/sessions/{other_session['id']}/open")
    assert mk(lab.student, lab.cid, "a.py").json()["code"] == "LAB_CLOSED"


# ========================================================= isolation / roles

def test_students_cannot_touch_each_others_workspaces(lab, db: Session) -> None:
    mine = mk(lab.student, lab.cid, "secret.py", "mine").json()
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")

    assert other.get(f"/api/v1/workspace/files/{mine['id']}").status_code == 404
    assert save(other, mine["id"], "pwned", mine["updated_at"]).status_code == 404
    assert rename(other, mine["id"], "pwned.py").status_code == 404
    assert other.delete(f"/api/v1/workspace/files/{mine['id']}").status_code == 404
    assert tree(other, lab.cid)["entries"] == []  # their own tree is theirs alone
    assert lab.student.get(f"/api/v1/workspace/files/{mine['id']}").json()["content"] == "mine"


def test_same_path_in_two_workspaces_is_fine(lab, db: Session) -> None:
    other = approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    assert mk(lab.student, lab.cid, "main.py", "A").status_code == 201
    assert mk(other, lab.cid, "main.py", "B").status_code == 201


def test_pending_and_removed_students_have_no_workspace_access(lab, db: Session) -> None:
    pending = login_as(db, Role.STUDENT, "waiting")
    pending.post("/api/v1/enroll", json={"code": lab.code})
    for r in (pending.get(f"/api/v1/workspace/{lab.cid}/tree"), mk(pending, lab.cid, "a.py")):
        assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_MEMBER"

    f = mk(lab.student, lab.cid, "a.py").json()
    enrollments = lab.teacher.get(f"/api/v1/classes/{lab.cid}/enrollments", params={"status": "approved"}).json()
    lab.teacher.patch(f"/api/v1/enrollments/{enrollments['items'][0]['id']}", json={"action": "remove"})
    assert lab.student.get(f"/api/v1/workspace/files/{f['id']}").status_code == 403
    assert mk(lab.student, lab.cid, "b.py").status_code == 403


def test_student_of_another_class_cannot_use_this_classes_workspace(lab, db: Session) -> None:
    other_cid = new_class(lab.teacher, "Other")
    outsider = approved_student(db, lab.teacher, other_cid, new_code(lab.teacher, other_cid)["code"], "outsider")
    assert outsider.get(f"/api/v1/workspace/{lab.cid}/tree").status_code == 403
    assert mk(outsider, lab.cid, "a.py").status_code == 403


def test_instructors_and_admins_cannot_use_student_workspace_endpoints(lab, db: Session) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    admin = login_as(db, Role.ADMIN, "root")
    for c in (lab.teacher, admin):
        assert c.get(f"/api/v1/workspace/{lab.cid}/tree").status_code == 403
        assert mk(c, lab.cid, "x.py").status_code == 403
        assert save(c, f["id"], "x", f["updated_at"]).status_code == 403
        assert rename(c, f["id"], "x.py").status_code == 403
        assert c.delete(f"/api/v1/workspace/files/{f['id']}").status_code == 403
        assert c.get(f"/api/v1/workspace/files/{f['id']}").status_code == 403


def test_anonymous_gets_401(client: TestClient) -> None:
    assert client.get("/api/v1/workspace/1/tree").status_code == 401
    assert client.put("/api/v1/workspace/files/1", json={"content": "", "last_updated_at": "2030-01-01T00:00:00Z"}
                      ).status_code == 401


# ============================================== instructor read-only views

def student_id(lab, username: str = "stu1") -> int:
    items = lab.teacher.get(f"/api/v1/classes/{lab.cid}/enrollments").json()["items"]
    return next(i["student"]["id"] for i in items if i["student"]["username"] == username)


def test_instructor_reads_a_students_workspace(lab) -> None:
    f = mk(lab.student, lab.cid, "Lab/main.py", "student code").json()
    sid = student_id(lab)

    t = lab.teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace")
    assert t.status_code == 200
    assert {e["path"] for e in t.json()["entries"]} == {"Lab", "Lab/main.py"}
    assert all("content" not in e for e in t.json()["entries"])

    got = lab.teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace/files/{f['id']}")
    assert got.status_code == 200 and got.json()["content"] == "student code"


def test_instructor_view_works_while_lab_is_closed_and_is_read_only(lab) -> None:
    f = mk(lab.student, lab.cid, "a.py", "x").json()
    sid = student_id(lab)
    close_lab(lab)
    assert lab.teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace").status_code == 200

    base = f"/api/v1/classes/{lab.cid}/students/{sid}/workspace"
    assert lab.teacher.post(base, json={"path": "x.py"}).status_code == 405
    assert lab.teacher.put(f"{base}/files/{f['id']}", json={"content": "", "last_updated_at": f["updated_at"]}
                           ).status_code == 405
    assert lab.teacher.delete(f"{base}/files/{f['id']}").status_code == 405


def test_instructor_cannot_read_workspaces_of_other_classes(lab, db: Session) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    sid = student_id(lab)
    other_teacher = login_as(db, Role.INSTRUCTOR, "teach2")
    r = other_teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace")
    assert r.status_code == 403 and r.json()["code"] == "NOT_CLASS_OWNER"
    assert other_teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace/files/{f['id']}").status_code == 403


def test_instructor_view_404s(lab, db: Session) -> None:
    f = mk(lab.student, lab.cid, "a.py").json()
    approved_student(db, lab.teacher, lab.cid, lab.code, "stu2")
    sid2 = student_id(lab, "stu2")
    assert lab.teacher.get(f"/api/v1/classes/{lab.cid}/students/99999/workspace").json()["code"] == "WORKSPACE_NOT_FOUND"
    # stu1's file requested through stu2's URL must not leak
    r = lab.teacher.get(f"/api/v1/classes/{lab.cid}/students/{sid2}/workspace/files/{f['id']}")
    assert r.status_code == 404 and r.json()["code"] == "FILE_NOT_FOUND"


def test_students_and_admins_cannot_use_the_instructor_views(lab, db: Session) -> None:
    sid = student_id(lab)
    admin = login_as(db, Role.ADMIN, "root")
    for c in (lab.student, admin):
        assert c.get(f"/api/v1/classes/{lab.cid}/students/{sid}/workspace").status_code == 403
