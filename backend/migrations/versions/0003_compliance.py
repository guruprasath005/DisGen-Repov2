"""DPDP compliance: consent_records, hospital_config, retention_settings

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE consent_method AS ENUM ('verbal', 'written', 'digital');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS consent_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            document_id UUID NOT NULL REFERENCES documents(id),
            patient_name VARCHAR(500) NOT NULL,
            consent_given BOOLEAN NOT NULL,
            consent_method consent_method NOT NULL,
            consent_date DATE NOT NULL,
            recorded_by UUID NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_consent_records_document_id ON consent_records (document_id)")

    # Singleton table — always one row (id=1)
    op.execute("""
        CREATE TABLE IF NOT EXISTS hospital_config (
            id INTEGER PRIMARY KEY DEFAULT 1,
            name VARCHAR(500) NOT NULL DEFAULT 'Hospital Name',
            logo TEXT,
            address TEXT,
            phone VARCHAR(50),
            email VARCHAR(255),
            registration_number VARCHAR(100),
            gstin VARCHAR(20),
            default_scheme VARCHAR(50) NOT NULL DEFAULT 'pmjay',
            pdf_header_color VARCHAR(7) NOT NULL DEFAULT '#F97316',
            pdf_accent_color VARCHAR(7) NOT NULL DEFAULT '#EA580C',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("INSERT INTO hospital_config (id, updated_at) VALUES (1, NOW()) ON CONFLICT DO NOTHING")

    # Singleton table — always one row (id=1)
    op.execute("""
        CREATE TABLE IF NOT EXISTS retention_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            retention_days INTEGER NOT NULL DEFAULT 2555,
            auto_delete BOOLEAN NOT NULL DEFAULT TRUE,
            anonymize_on_expiry BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("INSERT INTO retention_settings (id, updated_at) VALUES (1, NOW()) ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS retention_settings")
    op.execute("DROP TABLE IF EXISTS hospital_config")
    op.execute("DROP TABLE IF EXISTS consent_records")
    op.execute("DROP TYPE IF EXISTS consent_method")
