"""Initial schema: users, documents, audit_logs, icd10_codes, drug_mappings

Revision ID: 0001
Revises:
Create Date: 2026-04-30
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Helper: create ENUM type only if it doesn't already exist
def _create_enum(name: str, values: list[str]) -> None:
    vals = ", ".join(f"'{v}'" for v in values)
    op.execute(f"""
        DO $$ BEGIN
            CREATE TYPE {name} AS ENUM ({vals});
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)


def upgrade() -> None:
    # ── Extensions ────────────────────────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ── ENUM types ────────────────────────────────────────────────────────────
    _create_enum("user_role", ["super_admin", "admin", "doctor"])
    _create_enum("document_status", [
        "processing", "ocr_complete", "extracting", "ready",
        "confirmed", "generating", "generated", "approved",
        "failed", "ocr_failed",
    ])
    _create_enum("audit_action", [
        "LOGIN", "LOGIN_FAILED", "LOGOUT",
        "UPLOAD", "OCR_COMPLETE", "EXTRACT_COMPLETE",
        "STRUCTURED_UPDATE", "STRUCTURED_CONFIRM",
        "GENERATE", "GENERATE_FAILED", "APPROVE",
        "PDF_DOWNLOAD", "DOCUMENT_DELETE",
        "USER_CREATE", "USER_DEACTIVATE",
        "SCHEME_CREATE", "SCHEME_UPDATE", "SCHEME_DELETE",
        "SETTINGS_CHANGE", "RETENTION_ENFORCED",
    ])

    # ── users ─────────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(100) NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            hashed_password VARCHAR(255) NOT NULL,
            role user_role NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login TIMESTAMPTZ,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TIMESTAMPTZ
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")

    # ── documents ─────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            hospital_id VARCHAR(100) NOT NULL,
            uploaded_by UUID NOT NULL REFERENCES users(id),
            filename VARCHAR(500) NOT NULL,
            minio_key VARCHAR(500) NOT NULL,
            sha256_hash VARCHAR(64) NOT NULL,
            status document_status NOT NULL DEFAULT 'processing',
            ocr_text TEXT,
            pages INTEGER,
            ocr_confidence FLOAT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_documents_hospital_id ON documents (hospital_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_documents_uploaded_by ON documents (uploaded_by)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_documents_status ON documents (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_documents_created_at ON documents (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_documents_hospital_hash ON documents (hospital_id, sha256_hash)")

    # ── audit_logs ────────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id),
            username VARCHAR(100) NOT NULL,
            role VARCHAR(50) NOT NULL,
            action audit_action NOT NULL,
            document_id UUID REFERENCES documents(id),
            target_user_id UUID REFERENCES users(id),
            ip_address VARCHAR(45) NOT NULL,
            user_agent TEXT,
            details JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit_logs (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs (action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_document_id ON audit_logs (document_id)")

    # ── icd10_codes ───────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS icd10_codes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(10) NOT NULL,
            description TEXT NOT NULL,
            category VARCHAR(10)
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_icd10_codes_code ON icd10_codes (code)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_icd10_desc_trgm ON icd10_codes USING GIN (description gin_trgm_ops)")

    # ── drug_mappings ─────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS drug_mappings (
            id SERIAL PRIMARY KEY,
            brand_name VARCHAR(500) NOT NULL,
            generic_name VARCHAR(500) NOT NULL,
            normalized BOOLEAN NOT NULL DEFAULT TRUE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_drug_brand_name ON drug_mappings (brand_name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_drug_brand_trgm ON drug_mappings USING GIN (brand_name gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS drug_mappings")
    op.execute("DROP TABLE IF EXISTS icd10_codes")
    op.execute("DROP TABLE IF EXISTS audit_logs")
    op.execute("DROP TABLE IF EXISTS documents")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TYPE IF EXISTS audit_action")
    op.execute("DROP TYPE IF EXISTS document_status")
    op.execute("DROP TYPE IF EXISTS user_role")
