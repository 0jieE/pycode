"""login_events.seat_label: the seat's label kept as text, so the sign-in log keeps it after the lab is deleted

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-14
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0015'
down_revision: Union[str, None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('login_events', sa.Column('seat_label', sa.String(length=30), nullable=True))
    # existing rows: from the seats that still exist (rows whose seat is already gone stay NULL)
    op.execute("UPDATE login_events e JOIN lab_seats s ON s.id = e.seat_id SET e.seat_label = s.label")


def downgrade() -> None:
    op.drop_column('login_events', 'seat_label')
