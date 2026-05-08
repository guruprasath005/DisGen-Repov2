"""Add is_active and superseded_by_id to generated_summaries

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-02

Adds two columns that track which summary is currently active per
(document_id, scheme) pair:

  is_active       BOOLEAN NOT NULL DEFAULT true
  superseded_by_id UUID NULL → self-FK to generated_summaries.id

When generate_tasks.py creates a new summary, it marks the previous
active row as is_active=false and sets superseded_by_id=<new_id>.
The "latest" queries in documents.py filter on is_active=true, which
is faster and clearer than ORDER BY created_at DESC LIMIT 1.

The migration also backfills is_active for existing data: for each
(document_id, scheme) group, only the most recently created row keeps
is_active=true; older rows are set to false. This leaves the DB in a
consistent state immediately after migration without requiring a second
deploy step.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns with safe defaults.
    op.execute("""
        ALTER TABLE generated_summaries
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS superseded_by_id UUID NULL
    """)

    # 2. Self-referential FK — added with ALTER TABLE after the column exists
    #    so the constraint can reference the same table.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_superseded_by'
            ) THEN
                ALTER TABLE generated_summaries
                    ADD CONSTRAINT fk_superseded_by
                    FOREIGN KEY (superseded_by_id)
                    REFERENCES generated_summaries(id)
                    ON DELETE SET NULL
                    DEFERRABLE INITIALLY DEFERRED;
            END IF;
        END $$;
    """)

    # 3. Backfill: for each (document_id, scheme) group, mark only the
    #    most recent row as is_active=true; flip all others to false.
    #    Uses a CTE so the UPDATE is a single statement with no race window.
    op.execute("""
        WITH latest AS (
            SELECT DISTINCT ON (document_id, scheme)
                id
            FROM generated_summaries
            ORDER BY document_id, scheme, created_at DESC
        )
        UPDATE generated_summaries gs
        SET is_active = false
        WHERE gs.id NOT IN (SELECT id FROM latest)
    """)

    # 4. Index for the is_active filter — the hot query path in documents.py
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_gs_active
        ON generated_summaries (document_id, scheme)
        WHERE is_active = true
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_gs_active")
    op.execute("""
        ALTER TABLE generated_summaries
            DROP CONSTRAINT IF EXISTS fk_superseded_by
    """)
    op.execute("""
        ALTER TABLE generated_summaries
            DROP COLUMN IF EXISTS superseded_by_id,
            DROP COLUMN IF EXISTS is_active
    """)
