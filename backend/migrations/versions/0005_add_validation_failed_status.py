"""Add validation_failed to document_status enum

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-02
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL requires committing the current transaction before ALTER TYPE
    op.execute("COMMIT")
    op.execute("ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'validation_failed'")


def downgrade() -> None:
    # PostgreSQL does not support removing values from an enum without recreating it.
    # To roll back: drop and recreate the type (requires all referencing columns to be
    # cast first). Left as a no-op — downgrade is a manual DBA operation.
    pass
