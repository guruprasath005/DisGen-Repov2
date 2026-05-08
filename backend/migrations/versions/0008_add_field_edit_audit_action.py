"""Add FIELD_EDIT to audit_action enum

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-05

FIELD_EDIT is written by PATCH /documents/{id}/summary/latest/fields
when a doctor saves scheme field values after generation.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'FIELD_EDIT'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without recreating the type.
    # Downgrade is intentionally a no-op; the value is harmless if unused.
    pass
