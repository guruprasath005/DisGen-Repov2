"""Add phi_map column to structured_reports

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-18

phi_map stores the encrypted JSON replacement map used during PHI de-identification.
It is NULL for rows created before this migration (pre-hardening).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("structured_reports", sa.Column("phi_map", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("structured_reports", "phi_map")
