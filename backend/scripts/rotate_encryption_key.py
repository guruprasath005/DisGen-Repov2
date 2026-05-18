#!/usr/bin/env python3
"""
Encryption key rotation walker.

Finds all rows where the stored ciphertext does NOT start with v{ACTIVE_KEY_ID}:
and re-encrypts them under the new active key.

Usage:
    python rotate_encryption_key.py                   # dry-run (default)
    python rotate_encryption_key.py --apply           # execute rewrite
    python rotate_encryption_key.py --table documents # scope by table name

Environment variables required:
    FIELD_ENCRYPTION_KEY        new active key (base64, 32 bytes)
    FIELD_ENCRYPTION_KEY_ID     new active key ID (e.g. "2")
    FIELD_ENCRYPTION_KEYS_OLD   JSON map of retired keys (e.g. {"1":"<old_b64>"})
    DATABASE_URL                owner-role connection string
"""

import argparse
import os
import sys

# Add parent to path so we can import crypto
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from crypto import decrypt, encrypt, _active_key_id

# Tables and their encrypted TEXT columns that need rotation
ENCRYPTED_COLUMNS: dict[str, list[str]] = {
    "structured_reports": ["extracted_data", "phi_map"],
    "documents": [],  # add encrypted columns here as the schema grows
}


def _needs_rotation(value: str, active_key_id: str) -> bool:
    if not value:
        return False
    prefix = f"v{active_key_id}:"
    return not value.startswith(prefix)


def rotate_table(cur, table: str, columns: list[str], dry_run: bool, active_key_id: str) -> int:
    if not columns:
        return 0
    col_list = ", ".join(["id"] + columns)
    cur.execute(f'SELECT {col_list} FROM "{table}"')
    rows = cur.fetchall()

    updated = 0
    for row in rows:
        row_id = row[0]
        updates: dict[str, str] = {}
        for i, col in enumerate(columns):
            val = row[i + 1]
            if val and _needs_rotation(val, active_key_id):
                try:
                    plaintext = decrypt(val)
                    new_ct = encrypt(plaintext)
                    updates[col] = new_ct
                except Exception as exc:
                    print(f"  ERROR {table}.{col} id={row_id}: {exc}", file=sys.stderr)

        if updates:
            if dry_run:
                print(f"  [dry-run] would rewrite {table} id={row_id} columns: {list(updates)}")
            else:
                set_clause = ", ".join(f'"{c}" = %s' for c in updates)
                values = list(updates.values()) + [str(row_id)]
                cur.execute(f'UPDATE "{table}" SET {set_clause} WHERE id = %s', values)
                print(f"  rewritten {table} id={row_id}")
            updated += 1

    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Rotate AES-GCM encryption keys in database")
    parser.add_argument("--apply", action="store_true", help="Execute writes (default is dry-run)")
    parser.add_argument("--table", help="Scope to a single table name")
    args = parser.parse_args()

    dry_run = not args.apply
    active_key_id = _active_key_id()

    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    # Convert asyncpg URL to psycopg2 format
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    print(f"Active key ID: {active_key_id}")
    print(f"Mode: {'DRY RUN' if dry_run else 'APPLY'}")
    print()

    tables = ENCRYPTED_COLUMNS
    if args.table:
        if args.table not in tables:
            print(f"ERROR: unknown table '{args.table}'", file=sys.stderr)
            sys.exit(1)
        tables = {args.table: tables[args.table]}

    conn = psycopg2.connect(db_url)
    try:
        conn.autocommit = False
        cur = conn.cursor()
        total = 0
        for table, columns in tables.items():
            print(f"Scanning {table}...")
            count = rotate_table(cur, table, columns, dry_run, active_key_id)
            print(f"  {count} rows {'would be' if dry_run else ''} rewritten")
            total += count
        if not dry_run:
            conn.commit()
            print(f"\nCommitted. Total rows rewritten: {total}")
        else:
            conn.rollback()
            print(f"\nDry-run complete. Total rows that would be rewritten: {total}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
