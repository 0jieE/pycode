"""docs/schema.dbml (for dbdiagram.io) must describe exactly the tables the application really has."""
import re
from pathlib import Path

from app.core.database import Base
from tools.generate_dbml import generate

FILE = Path("docs/schema.dbml")


def test_the_committed_file_is_up_to_date() -> None:
    assert FILE.read_text(encoding="utf-8") == generate(), (
        "docs/schema.dbml is out of date: run  python -m tools.generate_dbml -o docs/schema.dbml")


def test_every_table_column_and_relation_is_described() -> None:
    text = FILE.read_text(encoding="utf-8")
    for table in Base.metadata.tables.values():
        block = re.search(rf"^Table {table.name} \{{\n(.*?)^\}}", text, re.S | re.M)
        assert block, table.name
        for column in table.columns:
            assert re.search(rf"^  {column.name} ", block.group(1), re.M), (table.name, column.name)
        for fk in table.foreign_keys:
            assert f"Ref: {table.name}.{fk.parent.name} > {fk.column.table.name}.{fk.column.name}" in text


def test_the_file_is_well_formed() -> None:
    text = FILE.read_text(encoding="utf-8")
    assert text.count("{") == text.count("}")
    tables = set(re.findall(r"^Table (\w+) \{", text, re.M))
    assert tables == set(Base.metadata.tables)
    for left, right in re.findall(r"^Ref: (\w+\.\w+) > (\w+\.\w+)", text, re.M):
        for end in (left, right):
            table, column = end.split(".")
            assert table in tables and column in Base.metadata.tables[table].columns, end
    grouped = [name for block in re.findall(r"^TableGroup \w+ \{\n(.*?)^\}", text, re.S | re.M) for name in block.split()]
    assert sorted(grouped) == sorted(tables)  # every table is in exactly one group
    assert not set(re.findall(r"^TableGroup (\w+)", text, re.M)) & tables  # no group shares a table's name


def test_no_secret_or_email_column_is_documented() -> None:
    text = FILE.read_text(encoding="utf-8").lower()
    assert "email" not in text
    block = re.search(r"^table registration_codes \{\n(.*?)^\}", text, re.S | re.M).group(1)
    assert re.search(r"^  code ", block, re.M) is None  # only code_hash / code_hint exist
