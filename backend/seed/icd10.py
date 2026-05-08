"""
Seed ICD-10-CM codes into icd10_codes table.

Source: CDC NCHS ICD-10-CM 2026 (official annual release)
  https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2026/

File format inside ZIP: icd10cm_codes_2026.txt
  Each line: <CODE>\t<SHORT_DESCRIPTION>\t<LONG_DESCRIPTION>
  or          <CODE> <DESCRIPTION>  (older single-description format)

The code's first 3 characters are used as category (e.g. A00, Z71).

Run: python3 /app/seed/icd10.py
"""

import asyncio
import io
import logging
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

from sqlalchemy import text, func, select
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import AsyncSessionLocal

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

_CDC_URL_2026 = (
    "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications"
    "/ICD10CM/2026/icd10cm-Code%20Descriptions-2026.zip"
)
_CDC_URL_2025 = (
    "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications"
    "/ICD10CM/2025/ICD10-CM%20Code%20Descriptions%202025.zip"
)
_BATCH_SIZE = 500


def _fetch_zip_bytes() -> bytes:
    for url in [_CDC_URL_2026, _CDC_URL_2025]:
        try:
            logger.info("Downloading ICD-10-CM from CDC: %s", url)
            req = Request(url, headers={"User-Agent": "DisGen/2.0 (clinical-seeder)"})
            with urlopen(req, timeout=120) as response:
                data = response.read()
            logger.info("Downloaded %.1f MB", len(data) / 1_048_576)
            return data
        except URLError as exc:
            logger.warning("Failed to fetch %s: %s — trying fallback", url, exc)
    raise URLError("All CDC ICD-10-CM download URLs failed")


def _parse_zip(data: bytes) -> list[dict]:
    """
    Parse the CDC ICD-10-CM description ZIP.
    The ZIP contains a .txt file with entries formatted as:
      CODE<TAB>LONG_DESCRIPTION
    or (older format):
      CODE<SPACES>DESCRIPTION
    Returns list of {"code": str, "description": str, "category": str}
    """
    records = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        # Find the codes description file inside the zip
        txt_files = [n for n in zf.namelist() if n.lower().endswith(".txt") and "code" in n.lower()]
        if not txt_files:
            txt_files = [n for n in zf.namelist() if n.lower().endswith(".txt")]

        logger.info("Found files in ZIP: %s", zf.namelist())
        if not txt_files:
            raise RuntimeError("No .txt file found in CDC ZIP")

        target = txt_files[0]
        logger.info("Parsing file: %s", target)

        with zf.open(target) as f:
            for raw_line in f:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line.strip():
                    continue

                # Try tab-separated first (CDC 2023+ format)
                if "\t" in line:
                    parts = line.split("\t")
                    code = parts[0].strip()
                    # File may have: code, short_desc, long_desc OR code, desc
                    description = parts[-1].strip()  # use the longest description
                else:
                    # Space-separated: first token is code, rest is description
                    parts = line.split(None, 1)
                    if len(parts) < 2:
                        continue
                    code = parts[0].strip()
                    description = parts[1].strip()

                # Validate code format: 3–7 alphanumeric chars
                if not code or len(code) < 3 or len(code) > 7 or not code[0].isalpha():
                    continue
                if not description:
                    continue

                category = code[:3].upper()
                records.append({"code": code.upper(), "description": description, "category": category})

    logger.info("Parsed %d ICD-10 codes", len(records))
    return records


async def _count_existing(session: AsyncSession) -> int:
    result = await session.execute(text("SELECT COUNT(*) FROM icd10_codes"))
    return result.scalar() or 0


async def seed(session: AsyncSession) -> int:
    existing = await _count_existing(session)
    if existing > 10_000:
        logger.info("ICD-10 table already has %d rows — skipping download", existing)
        return existing

    try:
        data = _fetch_zip_bytes()
    except URLError as exc:
        logger.error("Cannot reach CDC servers: %s", exc)
        logger.error(
            "For air-gapped environments, place icd10cm_codes.txt in "
            "/app/seed/data/ and re-run."
        )
        return 0

    records = _parse_zip(data)

    inserted = 0
    for i in range(0, len(records), _BATCH_SIZE):
        batch = records[i : i + _BATCH_SIZE]
        for row in batch:
            await session.execute(
                text(
                    """
                    INSERT INTO icd10_codes (code, description, category)
                    VALUES (:code, :description, :category)
                    ON CONFLICT (code) DO UPDATE
                      SET description = EXCLUDED.description,
                          category    = EXCLUDED.category
                    """
                ),
                row,
            )
        await session.commit()
        inserted += len(batch)
        logger.info("  Progress: %d / %d", inserted, len(records))

    return inserted


async def main() -> None:
    async with AsyncSessionLocal() as session:
        count = await seed(session)
    logger.info("ICD-10 seed complete — %d total rows in table", count)


if __name__ == "__main__":
    asyncio.run(main())
