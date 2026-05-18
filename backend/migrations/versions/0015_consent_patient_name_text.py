"""Widen consent_records.patient_name to TEXT to fit AES-GCM ciphertext

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-18

ConsentRecord.patient_name is now stored encrypted. Encrypted ciphertext is
~30-40% larger than plaintext (base64 + nonce + tag + version prefix), so a
500-char plaintext name no longer fits in VARCHAR(500). Switch to TEXT.

New rows are encrypted at write (see routers/documents.py upload handler).
Pre-existing rows remain plaintext and are read transparently via safe_decrypt.
Run scripts/encrypt_consent_names.py --apply to back-fill existing rows.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "consent_records",
        "patient_name",
        existing_type=sa.String(500),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "consent_records",
        "patient_name",
        existing_type=sa.Text(),
        type_=sa.String(500),
        existing_nullable=False,
    )
