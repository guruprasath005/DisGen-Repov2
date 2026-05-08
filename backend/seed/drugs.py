"""
Seed Indian drug brand→generic mappings into drug_mappings table.

Source: Curated dataset from NLEM 2022, Jan Aushadhi product list,
and common Indian hospital formulary entries.

Run: python3 /app/seed/drugs.py
"""

import asyncio
import csv
import logging
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

_CSV_PATH = Path(__file__).parent / "data" / "drugs_india.csv"
_BATCH_SIZE = 200


def _load_csv() -> list[dict]:
    rows = []
    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            brand = row["brand_name"].strip()
            generic = row["generic_name"].strip()
            if brand and generic:
                rows.append({"brand_name": brand, "generic_name": generic})
    return rows


async def seed(session: AsyncSession) -> int:
    existing = (await session.execute(text("SELECT COUNT(*) FROM drug_mappings"))).scalar() or 0
    if existing > 0:
        logger.info("drug_mappings already has %d rows — skipping seed", existing)
        return existing

    rows = _load_csv()
    logger.info("Loaded %d drug entries from CSV", len(rows))

    upserted = 0
    for i in range(0, len(rows), _BATCH_SIZE):
        batch = rows[i : i + _BATCH_SIZE]
        for row in batch:
            await session.execute(
                text(
                    """
                    INSERT INTO drug_mappings (brand_name, generic_name, normalized)
                    VALUES (:brand_name, :generic_name, TRUE)
                    ON CONFLICT DO NOTHING
                    """
                ),
                row,
            )
        upserted += len(batch)

    await session.commit()
    return upserted


async def main() -> None:
    async with AsyncSessionLocal() as session:
        count = await seed(session)
    logger.info("Drug seed complete — %d entries written", count)


if __name__ == "__main__":
    asyncio.run(main())
