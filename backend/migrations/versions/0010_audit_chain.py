"""Add hash chain columns to audit_logs and create restricted app role

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-18

Part A: Adds prev_hash, hash, hospital_id columns to audit_logs.
Part B: Creates disgen_app role with SELECT/INSERT only on audit_logs
        (UPDATE, DELETE, TRUNCATE revoked). Other tables get full CRUD.

Existing rows will have prev_hash=NULL and hash=NULL. The verification
walk treats these as pre-hardening boundary rows.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Part A — hash chain columns
    op.add_column("audit_logs", sa.Column("hospital_id", sa.String(100), nullable=True))
    op.add_column("audit_logs", sa.Column("prev_hash", sa.Text(), nullable=True))
    op.add_column("audit_logs", sa.Column("hash", sa.Text(), nullable=True))
    op.create_index("ix_audit_logs_hospital_id", "audit_logs", ["hospital_id"])

    # Part B — restricted app role
    # Use IF NOT EXISTS so re-running the migration is safe
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'disgen_app') THEN
                CREATE ROLE disgen_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
                    NOREPLICATION NOBYPASSRLS PASSWORD 'changeme-set-via-env';
            END IF;
        END
        $$;
    """)

    op.execute("GRANT CONNECT ON DATABASE disgen TO disgen_app;")
    op.execute("GRANT USAGE ON SCHEMA public TO disgen_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO disgen_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO disgen_app;")

    # Audit logs are append-only for the app role — history must not be rewritten
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM disgen_app;")


def downgrade() -> None:
    op.execute("GRANT UPDATE, DELETE, TRUNCATE ON audit_logs TO disgen_app;")
    op.drop_index("ix_audit_logs_hospital_id", "audit_logs")
    op.drop_column("audit_logs", "hash")
    op.drop_column("audit_logs", "prev_hash")
    op.drop_column("audit_logs", "hospital_id")
    # Note: do NOT drop the role — it may own objects in other schemas.
