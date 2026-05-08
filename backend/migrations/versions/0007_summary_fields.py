"""Add summary_fields JSONB to generated_summaries; make summary_text nullable

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-05

summary_fields  JSONB NULL — stores {field_name: value | null} pairs produced
                             by the scheme-field LLM generator. Replaces the
                             free-text summary_text workflow.

summary_text    TEXT  — made nullable so existing rows are preserved and new
                        rows can omit it. No data is dropped.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add summary_fields column
    op.execute("""
        ALTER TABLE generated_summaries
            ADD COLUMN IF NOT EXISTS summary_fields JSONB NULL
    """)

    # 2. Make summary_text nullable — existing rows keep their text,
    #    new field-based rows set it to NULL
    op.execute("""
        ALTER TABLE generated_summaries
            ALTER COLUMN summary_text DROP NOT NULL
    """)

    # 3. Index on summary_fields for faster reads when fetching a summary
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_gs_summary_fields
        ON generated_summaries USING GIN (summary_fields)
        WHERE summary_fields IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_gs_summary_fields")
    op.execute("""
        ALTER TABLE generated_summaries
            ALTER COLUMN summary_text SET NOT NULL
    """)
    op.execute("""
        ALTER TABLE generated_summaries
            DROP COLUMN IF EXISTS summary_fields
    """)
