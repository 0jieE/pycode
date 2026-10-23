"""rename classes.section to year_and_section

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-11 10:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # a rename keeps every existing value
    op.alter_column('classes', 'section', new_column_name='year_and_section',
                    existing_type=sa.String(length=50), existing_nullable=False)


def downgrade() -> None:
    op.alter_column('classes', 'year_and_section', new_column_name='section',
                    existing_type=sa.String(length=50), existing_nullable=False)
