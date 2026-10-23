import pytest

from app.core.errors import AppError
from app.services.workspace_service import normalize_file_path, normalize_path


@pytest.mark.parametrize("path", [
    "main.py", "Lab 1/main.py", "a/b/c/d.py", "data.csv", "notes.md", "cfg.json", "x.txt", "UPPER.PY",
    "a" * 252 + ".py",  # exactly 255
])
def test_valid_paths(path: str) -> None:
    assert normalize_file_path(path) == path


@pytest.mark.parametrize("path", [
    "../x.py", "a/../x.py", "a/..", "..", "/etc/x.py", "a\\b.py", "\\x.py", "C:\\x.py",
    "a//b.py", "a/", "/", "", ".", "./x.py", "a/./b.py", ".hidden.py", "a/.b.py", ".git/config.txt",
    "a" * 253 + ".py",  # 256
    "tab\tname.py", "nul\x00.py", " lead.py", "trail.py ", "dir /x.py",
])
def test_invalid_paths(path: str) -> None:
    with pytest.raises(AppError) as exc:
        normalize_path(path)
    assert exc.value.status_code == 400 and exc.value.code == "INVALID_PATH"


@pytest.mark.parametrize("path", ["x.exe", "x", "x.PYC", "x.py.exe", "archive.zip", "a/b.sh", "script.js"])
def test_invalid_extensions(path: str) -> None:
    with pytest.raises(AppError) as exc:
        normalize_file_path(path)
    assert exc.value.code == "INVALID_EXTENSION"


def test_extension_check_is_case_insensitive() -> None:
    assert normalize_file_path("DATA.CSV") == "DATA.CSV"
