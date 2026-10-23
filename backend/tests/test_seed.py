from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.classroom import Classroom
from app.models.invite_code import InviteCode
from app.models.user import Role, User
from app.seed import seed
from tests.conftest import login, new_device


def count(db: Session, role: Role) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == role))


def test_seed_creates_expected_data_and_credentials_work(db: Session) -> None:
    result = seed(db)
    assert (count(db, Role.ADMIN), count(db, Role.INSTRUCTOR), count(db, Role.STUDENT)) == (1, 2, 40)
    assert db.scalar(select(func.count()).select_from(Classroom)) == 1

    code = db.scalars(select(InviteCode)).one()
    assert code.is_active and len(code.code) == 8 and code.code == result.invite_code
    assert code.valid_from < code.valid_until

    activity = db.scalars(select(Activity)).one()
    assert activity.is_published and len(activity.starter_files) == 2

    passwords = {u: p for u, _, p in result.accounts}
    assert len(passwords) == 43 and all(passwords.values())
    assert login(new_device(), "admin", passwords["admin"]).status_code == 200
    assert login(new_device(), "student01", passwords["student01"]).status_code == 200


def test_seed_is_idempotent(db: Session) -> None:
    seed(db)
    again = seed(db)
    assert (count(db, Role.ADMIN), count(db, Role.INSTRUCTOR), count(db, Role.STUDENT)) == (1, 2, 40)
    assert db.scalar(select(func.count()).select_from(Classroom)) == 1
    assert db.scalar(select(func.count()).select_from(Activity)) == 1
    assert all(p is None for _, _, p in again.accounts)  # existing passwords are not changed


# ------------------------------------------------------------ registration codes

def test_seed_creates_one_batch_of_five_demo_codes_that_really_work(db: Session) -> None:
    import re

    from app.models.registration_code import RegistrationCode
    from tests.test_registration import CODE_RE, signup

    result = seed(db)
    assert len(result.registration_codes) == 5 and not result.registration_codes_existed
    assert all(CODE_RE.match(c) for c in result.registration_codes)
    db.rollback()
    rows = db.scalars(select(RegistrationCode)).all()
    assert len(rows) == 5 and {r.batch_name for r in rows} == {"Demo batch"}
    assert result.registration_codes[0] not in str(rows[0].code_hash)  # stored hashed

    r = signup(new_device(), result.registration_codes[0], username="demo.student", student_no="2026-9001")
    assert r.status_code == 201 and r.json()["role"] == "student"


def test_rerunning_the_seed_does_not_create_more_codes(db: Session) -> None:
    from app.models.registration_code import RegistrationCode

    seed(db)
    again = seed(db)
    assert again.registration_codes == [] and again.registration_codes_existed is True  # shown only once
    db.rollback()
    assert db.scalar(select(func.count()).select_from(RegistrationCode)) == 5


def test_the_seed_prints_the_codes(db: Session, capsys, monkeypatch) -> None:
    from app import seed as seed_module

    class _Ctx:
        def __enter__(self):
            return db

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(seed_module, "SessionLocal", lambda: _Ctx())
    seed_module.main()
    out = capsys.readouterr().out
    import re
    printed = re.findall(r"^  ([A-Z2-9]{5}-[A-Z2-9]{5})$", out, re.M)
    assert len(printed) == 5 and "shown ONLY now" in out
