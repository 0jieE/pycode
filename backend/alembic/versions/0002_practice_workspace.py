"""practice workspace: workspaces.class_id becomes nullable

A NULL class_id marks a student's personal Practice workspace (not tied to any class).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("workspaces", "class_id", existing_type=sa.BigInteger(), nullable=True)


def downgrade() -> None:
    # Practice workspaces cannot exist without the nullable column, so they (and their files, versions and runs)
    # are deleted. This is the only destructive step in the migration history.
    op.execute("DELETE FROM executions WHERE workspace_id IN (SELECT id FROM workspaces WHERE class_id IS NULL)")
    op.execute("DELETE FROM workspaces WHERE class_id IS NULL")
    op.alter_column("workspaces", "class_id", existing_type=sa.BigInteger(), nullable=False)
