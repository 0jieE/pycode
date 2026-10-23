from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect

from app.core.database import Base, engine

EXPECTED_TABLES = {
    "users", "classes", "invite_codes", "enrollments", "lab_sessions", "activities",
    "workspaces", "workspace_files", "file_versions", "submissions", "submission_files",
    "executions", "activity_logs", "registration_codes",
}


def test_migration_creates_all_tables(migrated_db: None) -> None:
    assert EXPECTED_TABLES <= set(inspect(engine).get_table_names())


def test_migration_matches_models(migrated_db: None) -> None:
    """If a model changes without a new migration, this fails."""
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_required_indexes_exist(migrated_db: None) -> None:
    insp = inspect(engine)

    def cols(table: str) -> list[list[str]]:
        idx = [i["column_names"] for i in insp.get_indexes(table)]
        uq = [u["column_names"] for u in insp.get_unique_constraints(table)]
        return idx + uq

    assert ["workspace_id", "path"] in cols("workspace_files")
    assert ["student_id", "created_at"] in cols("executions")
    assert ["status"] in cols("executions")
    assert ["class_id", "status"] in cols("enrollments")
    assert ["user_id", "created_at"] in cols("activity_logs")
    assert ["class_id", "student_id"] in cols("enrollments")
    assert ["student_id", "class_id"] in cols("workspaces")
    assert ["activity_id", "student_id"] in cols("submissions")


def test_workspaces_class_id_is_nullable_for_practice(migrated_db: None) -> None:
    columns = {c["name"]: c for c in inspect(engine).get_columns("workspaces")}
    assert columns["class_id"]["nullable"] is True
    assert columns["student_id"]["nullable"] is False


def test_0002_downgrade_drops_only_practice_data_and_upgrade_restores(migrated_db: None, db) -> None:
    """Downgrading removes practice workspaces (they cannot exist with a NOT NULL class_id) but nothing else."""
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.models.classroom import Classroom
    from app.models.execution import Execution
    from app.models.user import Role, User
    from app.models.workspace import Workspace, WorkspaceFile

    teacher = User(username="teach", password_hash="x", full_name="T", role=Role.INSTRUCTOR)
    student = User(username="stud", password_hash="x", full_name="S", role=Role.STUDENT)
    db.add_all([teacher, student])
    db.flush()
    klass = Classroom(instructor_id=teacher.id, name="C", year_and_section="A", school_year="2026")
    db.add(klass)
    db.flush()
    class_ws = Workspace(student_id=student.id, class_id=klass.id)
    practice_ws = Workspace(student_id=student.id, class_id=None)
    db.add_all([class_ws, practice_ws])
    db.flush()
    db.add_all([WorkspaceFile(workspace_id=class_ws.id, path="keep.py", content="1", size_bytes=1),
                WorkspaceFile(workspace_id=practice_ws.id, path="gone.py", content="1", size_bytes=1),
                Execution(student_id=student.id, workspace_id=practice_ws.id, entry_path="gone.py")])
    db.commit()
    db.close()

    cfg = Config("alembic.ini")
    try:
        command.downgrade(cfg, "0001")
        with engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM workspaces WHERE class_id IS NULL")).scalar() == 0
            assert conn.execute(text("SELECT COUNT(*) FROM workspaces")).scalar() == 1  # the class workspace stays
            assert conn.execute(text("SELECT path FROM workspace_files")).scalars().all() == ["keep.py"]
            assert conn.execute(text("SELECT COUNT(*) FROM executions")).scalar() == 0
        assert {c["name"]: c for c in inspect(engine).get_columns("workspaces")}["class_id"]["nullable"] is False
    finally:
        command.upgrade(cfg, "head")
    assert {c["name"]: c for c in inspect(engine).get_columns("workspaces")}["class_id"]["nullable"] is True


def test_registration_codes_table_stores_only_hashes_and_is_unique(migrated_db: None) -> None:
    insp = inspect(engine)
    columns = {c["name"]: c for c in insp.get_columns("registration_codes")}
    assert {"code_hash", "code_hint", "batch_name", "student_no", "full_name", "expires_at", "created_by",
            "created_at"} <= set(columns)
    assert "code" not in columns  # there is no column that could hold a plaintext code
    assert columns["student_no"]["nullable"] and columns["full_name"]["nullable"] and columns["expires_at"]["nullable"]
    assert not columns["code_hash"]["nullable"] and not columns["created_by"]["nullable"]
    assert ["code_hash"] in [u["column_names"] for u in insp.get_unique_constraints("registration_codes")]
