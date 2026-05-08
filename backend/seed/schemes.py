"""
Seed built-in schemes into the schemes table and ChromaDB.

Idempotent: existing built-in schemes are upserted (not duplicated).
ChromaDB collections are only seeded if empty.

Run: python3 /app/seed/schemes.py
"""

import asyncio
import json
import logging
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import AsyncSessionLocal
from schemes.data import ALL_SCHEMES
from rag.chromadb import seed_scheme

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


async def seed_db(session: AsyncSession) -> None:
    for scheme in ALL_SCHEMES:
        await session.execute(
            text(
                """
                INSERT INTO schemes (
                    id, name, label, color,
                    required_fields, optional_fields,
                    rules, pdf_sections, pdf_template,
                    is_builtin, created_by, created_at
                ) VALUES (
                    :id, :name, :label, :color,
                    CAST(:required_fields AS jsonb), CAST(:optional_fields AS jsonb),
                    CAST(:rules AS jsonb), CAST(:pdf_sections AS jsonb), :pdf_template,
                    TRUE, NULL, NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    name            = EXCLUDED.name,
                    label           = EXCLUDED.label,
                    color           = EXCLUDED.color,
                    required_fields = EXCLUDED.required_fields,
                    optional_fields = EXCLUDED.optional_fields,
                    rules           = EXCLUDED.rules,
                    pdf_sections    = EXCLUDED.pdf_sections,
                    pdf_template    = EXCLUDED.pdf_template
                """
            ),
            {
                "id": scheme.id,
                "name": scheme.name,
                "label": scheme.label,
                "color": scheme.color,
                "required_fields": json.dumps(scheme.required_fields),
                "optional_fields": json.dumps(scheme.optional_fields),
                "rules": json.dumps(scheme.rules),
                "pdf_sections": json.dumps(scheme.pdf_sections),
                "pdf_template": scheme.pdf_template,
            },
        )
        logger.info("DB: upserted scheme '%s'", scheme.id)

    await session.commit()


def seed_chromadb() -> None:
    for scheme in ALL_SCHEMES:
        try:
            seed_scheme(scheme.id, scheme.rag_chunks)
        except Exception:
            logger.exception("ChromaDB seeding failed for scheme '%s'", scheme.id)


async def main() -> None:
    async with AsyncSessionLocal() as session:
        await seed_db(session)
    logger.info("Scheme DB seed complete — %d schemes upserted", len(ALL_SCHEMES))

    seed_chromadb()
    logger.info("ChromaDB seed complete")


if __name__ == "__main__":
    asyncio.run(main())
