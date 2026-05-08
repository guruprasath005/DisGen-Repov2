"""PHI storage: structured_reports with AES-256-GCM encrypted data field

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS structured_reports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id UUID NOT NULL UNIQUE REFERENCES documents(id),
            data TEXT NOT NULL,
            data_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
            confirmed_by UUID REFERENCES users(id),
            confirmed_at TIMESTAMPTZ,
            excluded_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_structured_reports_document_id ON structured_reports (document_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS structured_reports")
