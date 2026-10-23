"""Writes the database schema as DBML, for https://dbdiagram.io (paste the file into the editor, or use Import).

    docker compose exec api python -m tools.generate_dbml -o docs/schema.dbml

It is generated from the SQLAlchemy models (the same metadata Alembic uses), so it cannot disagree with the real
tables. tests/test_dbml.py fails if the committed docs/schema.dbml is out of date: just run the command above.
"""
import argparse
import re
import sys
from typing import Optional

from sqlalchemy import Column, Enum, Table
from sqlalchemy.dialects import mysql

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.core.database import Base

# Tables shown together in dbdiagram.io (purely visual).
GROUPS = {
    "Accounts_and_access": ["users", "registration_codes", "activity_logs", "storage_limits"],
    "Classes_and_labs": ["classes", "invite_codes", "enrollments", "lab_sessions", "activities", "test_cases"],
    "Files_and_workspaces": ["workspaces", "workspace_files", "file_versions"],
    "Work_and_runs": ["submissions", "submission_files", "executions"],
    "Labs_and_sign_ins": ["labs", "login_events"],
    "Tutorial": ["tutorial_lessons", "tutorial_progress"],
}

# Hand-written explanations of the non-obvious parts. Everything else is read from the models.
TABLE_NOTES = {
    "users": "Every account. current_session_id holds the latest login; a token carrying an older id is rejected (one device per account).",
    "registration_codes": "Unused one-time student sign-up codes. Only the SHA-256 of a code is stored; the row is deleted when the code is used.",
    "storage_limits": "Workspace storage limits of a role (student, instructor), set by an admin; they apply to each workspace of a user. No row = the built-in defaults (100 KB per file, 2 MB, 100 files). users.storage_* override them per user.",
    "activity_logs": "Audit trail. user_id is NULL for events with no known user (e.g. a failed sign-up). Never holds passwords, tokens, codes or student code.",
    "enrollments": "Membership of a student in a class: pending until the instructor approves.",
    "workspaces": "Files of one user (a student, or an instructor for Practice). class_id NULL = the personal Practice workspace of that user (one per user, enforced in the service because MySQL allows many NULLs in a unique key).",
    "workspace_files": "Files and folders (is_folder). Paths are unique within a workspace and never start with a dot or contain dot-dot.",
    "file_versions": "History of manual saves only; the newest 20 per file are kept.",
    "submissions": "One row per (activity, student); resubmitting replaces the snapshot and clears the score until it is graded again.",
    "test_cases": "Automatic checks of an activity: run the program with stdin and compare the output with expected_output. Hidden cases are never shown to students.",
    "submission_files": "Frozen copy of the activity folder at submit time.",
    "tutorial_lessons": "The built-in Python tutorial. Loaded from content/tutorial/*.md (python -m app.tutorial_content), editable afterwards; Reset to default reloads the file.",
    "tutorial_progress": "One row per student and lesson: first view, first all-pass, number of checks, autosaved code.",
    "labs": "A computer lab: a named room. Lab sessions book it (no two sessions of a lab may overlap).",
    "lab_sessions": "A weekly lab meeting of a class in a lab. It opens itself at starts_at and closes itself at ends_at (Celery beat, every 15 s); the instructor may open it from 15 minutes before and close it any time.",
    "login_events": "Every sign-in, with the lab session of the student (if one of their classes had one open) and its outcome: success, or replaced_other_session when it signed another session of the account out. Addresses are in the audit log only.",
    "executions": "Every Run, test and grading job (kind). lab_session_id and activity_id are NULL for Practice runs; workspace_id is NULL for an instructor trying a test case.",
}
COLUMN_NOTES = {
    ("users", "current_session_id"): "random id of the latest login; NULL after logout",
    ("registration_codes", "code_hash"): "SHA-256 hex of the 10-character code; the plaintext is never stored",
    ("registration_codes", "code_hint"): "last 4 characters of the code, for display",
    ("registration_codes", "student_no"): "if set, the code only works for this student number",
    ("registration_codes", "full_name"): "prefilled name for single codes; becomes the full name of the new account",
    ("workspaces", "class_id"): "NULL = personal Practice workspace",
    ("executions", "workspace_id"): "the workspace that was run (a class workspace or the Practice workspace)",
    ("executions", "lab_session_id"): "NULL for Practice runs",
    ("executions", "activity_id"): "set when the entry file is inside a published activity folder",
    ("enrollments", "invite_code_id"): "the invite code the student joined with",
    ("activities", "starter_files"): "JSON list of {path, content}, relative to the activity folder",
    ("invite_codes", "max_uses"): "NULL = unlimited",
    ("test_cases", "expected_output"): "compared by the worker only; never sent to the sandbox, never shown to students for hidden cases",
    ("test_cases", "match_mode"): "trim (default) / exact / ignore_case / contains",
    ("executions", "test_results"): "JSON list per test case: case_id, passed, points_awarded, status, duration_ms, actual_output (max 4 KB)",
    ("activities", "ignore_input_prompts"): "true = the text passed to input() is left out of the output being compared",
    ("activities", "entry_file"): "the program graded for this activity, relative to the activity folder",
    ("executions", "mode"): "interactive = the program pauses at input() and the student types live; batch = all input given up front",
    ("executions", "stdin"): "batch: the input given up front. interactive: every line the student typed, joined with newlines",
    ("users", "must_change_password"): "true after an admin reset or a CSV import: only /auth/me, change-password and logout work until the password is changed",
    ("users", "preferences"): "own settings of the user (theme, editor_theme); missing values mean the defaults",
    ("activities", "is_archived"): "published activities only: hidden from students, folder read-only, submissions and grades kept",
    ("tutorial_lessons", "exercise"): "prompt, starter_code, starter_files, entry, ignore_input_prompts, tests, reference_solution. The reference solution and hidden tests never reach students",
    ("tutorial_lessons", "examples"): "JSON list of {title, code}",
    ("tutorial_progress", "passed_at"): "the first time every test of the exercise passed",
    ("classes", "tutorial_unlock_in_order"): "the tutorial opens one lesson at a time for this class (a lesson needs the previous one passed)",
    ("executions", "tutorial_lesson_id"): "set for a tutorial exercise check: the lesson whose tests ran",
    ("lab_sessions", "lab_id"): "the room it books (required by the API; no two sessions of a lab may overlap). NULL only when the lab was deleted after the session ended",
    ("lab_sessions", "name"): "one meeting of the class, e.g. Week 3 (was batch_name)",
    ("lab_sessions", "opened_at"): "by the instructor (from 15 minutes before starts_at) or by the scheduler at starts_at; NULL = not opened yet",
    ("lab_sessions", "closed_at"): "by the instructor, or by the scheduler at ends_at",
    ("users", "storage_max_file_bytes"): "own limit of this user; NULL = the limit of the role (storage_limits)",
    ("users", "storage_max_workspace_bytes"): "own limit of this user, per workspace; NULL = the limit of the role (storage_limits)",
    ("users", "storage_max_files"): "own limit of this user, per workspace; NULL = the limit of the role (storage_limits)",
    ("storage_limits", "updated_by"): "the admin who last changed them",
    ("test_cases", "require_input_read"): "with stdin: the case passes only if the program read every input line (counted by the sandbox, outside the program)",
    ("activities", "requirements"): "code requirements checked with ast before the tests run: must_define_functions, must_use, must_not_use_calls, must_not_use_imports; NULL = none",
    ("submissions", "hardcode_suspected"): "set by grading: a string literal in the code holds an expected-output line of a hidden case (instructor only, no automatic fail)",
    ("submissions", "hardcode_tests"): "names of those hidden cases",
    ("workspace_files", "size_bytes"): "UTF-8 size of content; counted against the 100 KB file and 2 MB workspace limits",
}


def q(text: str) -> str:
    # Notes are written without quotes or backslashes so that no escaping rules can differ between DBML tools.
    assert "'" not in text and "\\" not in text, f"keep DBML notes free of quotes/backslashes: {text}"
    return "'" + text + "'"


def enum_name(table: Table, column: Column) -> str:
    return f"{table.name}_{column.name}"


def type_of(table: Table, column: Column) -> str:
    if isinstance(column.type, Enum):
        return enum_name(table, column)
    return column.type.compile(dialect=mysql.dialect()).lower().replace("bool", "boolean")


def default_of(column: Column) -> Optional[str]:
    if column.server_default is None:
        return None
    raw = str(column.server_default.arg.text if hasattr(column.server_default.arg, "text") else column.server_default.arg)
    raw = raw.strip("'")
    if re.fullmatch(r"CURRENT_TIMESTAMP(\(\d+\))?", raw):
        return f"`{raw}`"
    if isinstance(column.type, Enum):
        return q(raw)
    if column.type.compile(dialect=mysql.dialect()).upper().startswith("BOOL"):
        return "true" if raw == "1" else "false"
    return raw if re.fullmatch(r"-?\d+(\.\d+)?", raw) else q(raw)


def column_line(table: Table, column: Column) -> str:
    settings = []
    if column.primary_key:
        settings.append("pk")
        if column.autoincrement is True or (column.autoincrement == "auto" and column.type._type_affinity.__name__ == "Integer"):
            settings.append("increment")
    elif not column.nullable:
        settings.append("not null")
    if column.unique:
        settings.append("unique")
    default = default_of(column)
    if default is not None:
        settings.append(f"default: {default}")
    note = COLUMN_NOTES.get((table.name, column.name))
    if note:
        settings.append(f"note: {q(note)}")
    suffix = f" [{', '.join(settings)}]" if settings else ""
    return f"  {column.name} {type_of(table, column)}{suffix}"


def index_lines(table: Table) -> list[str]:
    lines = []
    for constraint in sorted((c for c in table.constraints if c.__class__.__name__ == "UniqueConstraint"),
                             key=lambda c: c.name or ""):
        cols = list(constraint.columns)
        if len(cols) > 1:
            lines.append(f"    ({', '.join(c.name for c in cols)}) [unique, name: {q(constraint.name)}]")
    for index in sorted(table.indexes, key=lambda i: i.name or ""):
        cols = ", ".join(c.name for c in index.columns)
        cols = f"({cols})" if len(index.columns) > 1 else cols
        lines.append(f"    {cols} [{'unique, ' if index.unique else ''}name: {q(index.name)}]")
    return lines


def relation_lines(tables: list[Table]) -> list[str]:
    lines = []
    for table in tables:
        for fk in sorted(table.foreign_keys, key=lambda f: f.parent.name):
            actions = []
            if fk.ondelete:
                actions.append(f"delete: {fk.ondelete.lower()}")
            suffix = f" [{', '.join(actions)}]" if actions else ""
            lines.append(f"Ref: {table.name}.{fk.parent.name} > {fk.column.table.name}.{fk.column.name}{suffix}")
    return lines


def generate() -> str:
    tables = list(Base.metadata.sorted_tables)
    out = [
        "// Lab Management System - database schema (MySQL 8, InnoDB, utf8mb4).",
        "// Paste into https://dbdiagram.io (or Import > DBML). Generated by: python -m tools.generate_dbml",
        "// All datetimes are UTC. Every table also has the id / created_at / updated_at columns shown below.",
        "",
        "Project lab_management {",
        "  database_type: 'MySQL'",
        "  Note: 'LAN-based laboratory management system with an integrated Python coding environment'",
        "}",
        "",
    ]
    enums: dict[str, list[str]] = {}
    for table in tables:
        for column in table.columns:
            if isinstance(column.type, Enum):
                enums[enum_name(table, column)] = list(column.type.enums)
    for name, values in sorted(enums.items()):
        out.append(f"Enum {name} " + "{")
        out += [f"  {v}" for v in values]
        out += ["}", ""]

    for table in tables:
        out.append(f"Table {table.name} " + "{")
        # id first (stable sort keeps the model's own order for the rest)
        out += [column_line(table, c) for c in sorted(table.columns, key=lambda c: not c.primary_key)]
        note = TABLE_NOTES.get(table.name)
        indexes = index_lines(table)
        if indexes:
            out += ["", "  indexes {", *indexes, "  }"]
        if note:
            out += ["", f"  Note: {q(note)}"]
        out += ["}", ""]

    out += relation_lines(tables)
    out.append("")
    for group, members in GROUPS.items():
        out.append(f"TableGroup {group} " + "{")
        out += [f"  {m}" for m in members]
        out += ["}", ""]
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output", help="write to this file instead of stdout")
    args = parser.parse_args()
    text = generate()
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
