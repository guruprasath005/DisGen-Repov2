#!/usr/bin/env python3
"""
Create the initial Super Admin account.

Usage (inside the backend container):
    python3 /app/seed/create_superadmin.py <username> <password> <full_name> <email>

Called automatically by scripts/install.sh. Can also be run manually
via docker exec when the Super Admin account needs to be reset.
"""

import asyncio
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# ── Bootstrap path so models can be imported ──────────────────────────────────
sys.path.insert(0, "/app")

import os
from auth.password import hash_password
from models.user import User
from database import Base


async def create(username: str, password: str, full_name: str, email: str) -> None:
    db_url = os.environ.get("DATABASE_URL", "").replace(
        "postgresql://", "postgresql+asyncpg://"
    )
    if not db_url:
        print("ERROR: DATABASE_URL environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    engine = create_async_engine(db_url, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        # Prevent duplicate Super Admin
        existing = (
            await db.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()

        if existing is not None:
            if existing.role == "super_admin":
                print(f"Super Admin '{username}' already exists — skipping creation.")
                return
            else:
                print(
                    f"ERROR: username '{username}' already exists with role '{existing.role}'.",
                    file=sys.stderr,
                )
                sys.exit(1)

        user = User(
            id=uuid.uuid4(),
            username=username,
            full_name=full_name,
            email=email,
            hashed_password=hash_password(password),
            role="super_admin",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.commit()
        print(f"Super Admin '{username}' created successfully.")

    await engine.dispose()


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(
            "Usage: python3 create_superadmin.py <username> <password> <full_name> <email>",
            file=sys.stderr,
        )
        sys.exit(1)

    asyncio.run(create(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]))
