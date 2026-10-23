"""remove the seat map: lab seats, seat plans, seat bindings, seat alerts, the seat lock, the lab grid, and the seat
and address columns of login_events. Labs stay as named rooms that sessions book. The seat data is lost.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = '0017'
down_revision: Union[str, None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = dict(mysql_charset='utf8mb4', mysql_collate='utf8mb4_unicode_ci', mysql_engine='InnoDB')
DT = sa.DateTime().with_variant(mysql.DATETIME(fsp=6), 'mysql')
NOW = sa.text('CURRENT_TIMESTAMP(6)')
OUTCOMES_BEFORE = ('success', 'refused_seat_lock', 'replaced_other_session')
OUTCOMES_AFTER = ('success', 'replaced_other_session')


def _foreign_key_name(table: str, column: str) -> str:
    """The name MySQL gave an unnamed foreign key (e.g. login_events_ibfk_2)."""
    for fk in sa.inspect(op.get_bind()).get_foreign_keys(table):
        if fk['constrained_columns'] == [column]:
            return fk['name']
    raise RuntimeError(f'no foreign key on {table}.{column}')


def upgrade() -> None:
    op.drop_table('lab_alerts')
    op.drop_table('session_seat_bindings')
    op.drop_table('seat_assignments')

    op.drop_constraint(_foreign_key_name('login_events', 'seat_id'), 'login_events', type_='foreignkey')
    op.execute("DELETE FROM login_events WHERE outcome = 'refused_seat_lock'")
    for column in ('seat_id', 'seat_label', 'ip', 'replaced_ip'):
        op.drop_column('login_events', column)
    op.alter_column('login_events', 'outcome', existing_type=sa.Enum(*OUTCOMES_BEFORE, name='loginoutcome'),
                    type_=sa.Enum(*OUTCOMES_AFTER, name='loginoutcome'), existing_nullable=False)

    op.drop_table('lab_seats')
    op.drop_constraint('ck_labs_grid', 'labs', type_='check')
    op.drop_column('labs', 'rows')
    op.drop_column('labs', 'cols')
    op.drop_column('lab_sessions', 'seat_lock')


def downgrade() -> None:
    """The structure comes back (as 0009-0016 left it); the seat data does not. Labs get a 1 x 1 grid."""
    op.add_column('lab_sessions', sa.Column('seat_lock', sa.Enum('off', 'first_seat', 'assigned', name='seatlock'),
                                            server_default='off', nullable=False))
    op.add_column('labs', sa.Column('rows', sa.Integer(), server_default='1', nullable=False))
    op.add_column('labs', sa.Column('cols', sa.Integer(), server_default='1', nullable=False))
    op.create_check_constraint('ck_labs_grid', 'labs', '`rows` BETWEEN 1 AND 30 AND cols BETWEEN 1 AND 30')

    op.create_table('lab_seats',
                    sa.Column('lab_id', sa.BigInteger(), nullable=False),
                    sa.Column('label', sa.String(length=30), nullable=False),
                    sa.Column('row', sa.Integer(), nullable=False),
                    sa.Column('col', sa.Integer(), nullable=False),
                    sa.Column('ip', sa.String(length=45), nullable=True),
                    sa.Column('is_active', sa.Boolean(), server_default='1', nullable=False),
                    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
                    sa.Column('created_at', DT, server_default=NOW, nullable=False),
                    sa.Column('updated_at', DT, server_default=NOW, nullable=False),
                    sa.Column('device_id_hash', sa.String(length=64), nullable=True),
                    sa.Column('registered_at', DT, nullable=True),
                    sa.Column('registered_by', sa.BigInteger(), nullable=True),
                    sa.ForeignKeyConstraint(['lab_id'], ['labs.id'], ondelete='CASCADE'),
                    sa.ForeignKeyConstraint(['registered_by'], ['users.id'], name='fk_lab_seats_registered_by',
                                            ondelete='SET NULL'),
                    sa.PrimaryKeyConstraint('id'),
                    sa.UniqueConstraint('ip'),
                    sa.UniqueConstraint('device_id_hash', name='device_id_hash'),
                    sa.UniqueConstraint('lab_id', 'label', name='uq_lab_seats_label'),
                    sa.UniqueConstraint('lab_id', 'row', 'col', name='uq_lab_seats_position'),
                    **TABLE)

    op.alter_column('login_events', 'outcome', existing_type=sa.Enum(*OUTCOMES_AFTER, name='loginoutcome'),
                    type_=sa.Enum(*OUTCOMES_BEFORE, name='loginoutcome'), existing_nullable=False)
    op.add_column('login_events', sa.Column('ip', sa.String(length=45), nullable=True))
    op.add_column('login_events', sa.Column('seat_id', sa.BigInteger(), nullable=True))
    op.add_column('login_events', sa.Column('replaced_ip', sa.String(length=45), nullable=True))
    op.add_column('login_events', sa.Column('seat_label', sa.String(length=30), nullable=True))
    op.create_foreign_key(None, 'login_events', 'lab_seats', ['seat_id'], ['id'], ondelete='SET NULL')

    op.create_table('seat_assignments',
                    sa.Column('class_id', sa.BigInteger(), nullable=False),
                    sa.Column('student_id', sa.BigInteger(), nullable=False),
                    sa.Column('seat_id', sa.BigInteger(), nullable=False),
                    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
                    sa.Column('created_at', DT, server_default=NOW, nullable=False),
                    sa.Column('updated_at', DT, server_default=NOW, nullable=False),
                    sa.ForeignKeyConstraint(['class_id'], ['classes.id'], ondelete='CASCADE'),
                    sa.ForeignKeyConstraint(['seat_id'], ['lab_seats.id'], ondelete='CASCADE'),
                    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
                    sa.PrimaryKeyConstraint('id'),
                    sa.UniqueConstraint('class_id', 'student_id', name='uq_seat_assignments_student'),
                    **TABLE)
    op.create_table('session_seat_bindings',
                    sa.Column('lab_session_id', sa.BigInteger(), nullable=False),
                    sa.Column('student_id', sa.BigInteger(), nullable=False),
                    sa.Column('seat_id', sa.BigInteger(), nullable=True),
                    sa.Column('released', sa.Boolean(), server_default='0', nullable=False),
                    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
                    sa.Column('created_at', DT, server_default=NOW, nullable=False),
                    sa.Column('updated_at', DT, server_default=NOW, nullable=False),
                    sa.ForeignKeyConstraint(['lab_session_id'], ['lab_sessions.id'], ondelete='CASCADE'),
                    sa.ForeignKeyConstraint(['seat_id'], ['lab_seats.id'], ondelete='SET NULL'),
                    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
                    sa.PrimaryKeyConstraint('id'),
                    sa.UniqueConstraint('lab_session_id', 'student_id', name='uq_session_seat_bindings'),
                    **TABLE)
    op.create_table('lab_alerts',
                    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
                    sa.Column('lab_session_id', sa.BigInteger(), nullable=False),
                    sa.Column('type', sa.String(length=40), nullable=False),
                    sa.Column('student_id', sa.BigInteger(), nullable=False),
                    sa.Column('payload', sa.JSON(), nullable=False),
                    sa.Column('created_at', DT, nullable=False),
                    sa.ForeignKeyConstraint(['lab_session_id'], ['lab_sessions.id'], ondelete='CASCADE'),
                    sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
                    sa.PrimaryKeyConstraint('id'),
                    **TABLE)
    op.create_index('ix_lab_alerts_session_id', 'lab_alerts', ['lab_session_id', 'id'], unique=False)
