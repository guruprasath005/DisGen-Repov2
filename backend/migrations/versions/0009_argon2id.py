"""Add password_algo column to users for algorithm tracking

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-18

Existing rows default to 'bcrypt'. The lazy rehash in auth/router.py upgrades
them to 'argon2id' on next successful login — no data migration required.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_algo",
            sa.String(20),
            nullable=False,
            server_default="bcrypt",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "password_algo")
