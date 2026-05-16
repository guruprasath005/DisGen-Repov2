"""
Seed the singleton hospital_config row (id=1) from environment.

Idempotent. Only updates `name` when it is still the SQL default
("Hospital Name") or empty — so any super-admin customisation made later
through the UI is preserved across re-runs.

Run: python3 /app/seed/hospital_config.py
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

_DEFAULT_NAMES = {"hospital name", "hospital", "", "default"}


async def main() -> None:
    env_name = (settings.hospital_name or "").strip()
    if not env_name:
        logger.info("HOSPITAL_NAME not set in .env — leaving hospital_config untouched")
        return

    async with AsyncSessionLocal() as session:
        # Ensure the row exists (migration 0003 inserts id=1, but be defensive)
        await session.execute(
            text(
                "INSERT INTO hospital_config (id, name, updated_at) "
                "VALUES (1, :name, NOW()) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"name": env_name},
        )

        # Only overwrite when the value is still the placeholder — preserves
        # any later customisation by the super-admin via the UI.
        current = (
            await session.execute(
                text("SELECT name FROM hospital_config WHERE id = 1")
            )
        ).scalar()

        if (current or "").strip().lower() in _DEFAULT_NAMES:
            await session.execute(
                text(
                    "UPDATE hospital_config "
                    "SET name = :name, updated_at = NOW() WHERE id = 1"
                ),
                {"name": env_name},
            )
            logger.info(
                "hospital_config: name '%s' -> '%s'", current, env_name
            )
        else:
            logger.info(
                "hospital_config: name already customised ('%s') — not overwriting",
                current,
            )
        await session.commit()


if __name__ == "__main__":
    asyncio.run(main())
