"""interactive runs: executions.mode and the stopped / input_timeout statuses

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-12 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = ('queued', 'running', 'ok', 'error', 'timeout', 'memory_exceeded', 'output_limit', 'system_error')
NEW = OLD + ('stopped', 'input_timeout')


def upgrade() -> None:
    op.alter_column('executions', 'status', existing_type=sa.Enum(*OLD, name='executionstatus'),
                    type_=sa.Enum(*NEW, name='executionstatus'), existing_nullable=False,
                    existing_server_default='queued')
    op.add_column('executions', sa.Column('mode', sa.Enum('interactive', 'batch', name='executionmode'),
                                          server_default='batch', nullable=False))


def downgrade() -> None:
    op.drop_column('executions', 'mode')
    # the two new statuses do not exist before this revision: keep the rows, as the closest old status
    op.execute("UPDATE executions SET status = 'error' WHERE status = 'stopped'")
    op.execute("UPDATE executions SET status = 'timeout' WHERE status = 'input_timeout'")
    op.alter_column('executions', 'status', existing_type=sa.Enum(*NEW, name='executionstatus'),
                    type_=sa.Enum(*OLD, name='executionstatus'), existing_nullable=False,
                    existing_server_default='queued')
