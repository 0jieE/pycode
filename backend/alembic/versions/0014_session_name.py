"""lab_sessions.batch_name -> name (a session is one meeting, e.g. "Week 3", not a batch of students)

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0014'
down_revision: Union[str, None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('lab_sessions', 'batch_name', new_column_name='name',
                    existing_type=sa.String(length=100), existing_nullable=False)


def downgrade() -> None:
    op.alter_column('lab_sessions', 'name', new_column_name='batch_name',
                    existing_type=sa.String(length=100), existing_nullable=False)
