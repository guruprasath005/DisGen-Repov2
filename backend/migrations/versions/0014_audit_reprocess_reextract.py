"""Add REPROCESS and REEXTRACT to audit_action enum

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-18

These actions are written by POST /documents/{id}/reprocess and
POST /documents/{id}/reextract. Without this migration the inserts crash
with a Postgres enum constraint violation and the endpoints 500.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REPROCESS'")
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REEXTRACT'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without recreating the type.
    pass
