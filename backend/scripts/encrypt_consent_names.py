#!/usr/bin/env python3
"""
One-shot back-fill: encrypt existing plaintext consent_records.patient_name.

After migration 0015, new rows are encrypted at write. This script walks every
existing row, detects plaintext (anything that does not start with "v<id>:"),
and re-writes it as ciphertext.

Idempotent — running twice is safe; already-encrypted rows are skipped.

Usage:
    python encrypt_consent_names.py                # dry-run
    python encrypt_consent_names.py --apply        # execute writes
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from crypto import encrypt


def is_ciphertext(value: str) -> bool:
    """Return True if value looks like our versioned ciphertext format."""
    return bool(value) and value.startswith("v") and ":" in value[:5]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Execute writes (default is dry-run)")
    args = parser.parse_args()
    dry_run = not args.apply

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    print(f"Mode: {'DRY RUN' if dry_run else 'APPLY'}")
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, patient_name FROM consent_records")
        rows = cur.fetchall()

        encrypted = 0
        skipped = 0
        for row_id, name in rows:
            if not name or is_ciphertext(name):
                skipped += 1
                continue
            new_value = encrypt(name)
            if dry_run:
                print(f"  [dry-run] would encrypt consent {row_id}")
            else:
                cur.execute(
                    "UPDATE consent_records SET patient_name = %s WHERE id = %s",
                    (new_value, str(row_id)),
                )
            encrypted += 1

        if not dry_run:
            conn.commit()
            print(f"\nCommitted. encrypted={encrypted} skipped={skipped}")
        else:
            conn.rollback()
            print(f"\nDry-run complete. would_encrypt={encrypted} already_encrypted={skipped}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
