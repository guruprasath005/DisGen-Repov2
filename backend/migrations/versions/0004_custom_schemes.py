"""Schemes and generated summaries

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE summary_status AS ENUM ('draft', 'validation_failed', 'approved');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS schemes (
            id VARCHAR(100) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            label VARCHAR(100) NOT NULL,
            color VARCHAR(7) NOT NULL,
            required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            optional_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            rules JSONB NOT NULL DEFAULT '[]'::jsonb,
            pdf_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
            pdf_template VARCHAR(100) NOT NULL DEFAULT 'custom.html',
            is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS generated_summaries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id UUID NOT NULL REFERENCES documents(id),
            scheme VARCHAR(100) NOT NULL,
            summary_text TEXT NOT NULL,
            status summary_status NOT NULL DEFAULT 'draft',
            validation_notes JSONB,
            generated_by UUID NOT NULL REFERENCES users(id),
            approved_by UUID REFERENCES users(id),
            approved_at TIMESTAMPTZ,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_generated_summaries_document_id ON generated_summaries (document_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_generated_summaries_scheme ON generated_summaries (scheme)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_generated_summaries_doc_scheme ON generated_summaries (document_id, scheme)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS generated_summaries")
    op.execute("DROP TABLE IF EXISTS schemes")
    op.execute("DROP TYPE IF EXISTS summary_status")
