#!/bin/bash
# Seeds the database with ICD-10 codes, drug mappings, and built-in schemes.
# Run once after migrations are applied.
# Safe to re-run — all seeds are idempotent.
set -e

CONTAINER="disgen-backend-1"

echo "=== DisGen Seed Script ==="
echo "Checking backend container is running..."
docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null | grep -q "running" || {
    echo "ERROR: $CONTAINER is not running. Start with: docker compose up -d"
    exit 1
}

echo ""
echo "[1/3] Seeding drug brand→generic mappings (NLEM 2022 + Jan Aushadhi)..."
docker exec "$CONTAINER" python3 /app/seed/drugs.py
echo "      Drug seed done."

echo ""
echo "[2/3] Seeding ICD-10-CM 2026 codes from CDC..."
echo "      (Downloads ~4 MB from ftp.cdc.gov — may take 1-2 minutes)"
docker exec "$CONTAINER" python3 /app/seed/icd10.py
echo "      ICD-10 seed done."

echo ""
echo "[3/3] Seeding built-in schemes (PM-JAY, CGHS, ESI, CMCHIS, Private) to DB + ChromaDB..."
docker exec "$CONTAINER" python3 /app/seed/schemes.py
echo "      Scheme seed done."

echo ""
echo "=== Seed complete ==="
echo "Rows in icd10_codes:"
docker exec disgen-postgres-1 psql -U disgen -t -c "SELECT COUNT(*) FROM icd10_codes;"
echo "Rows in drug_mappings:"
docker exec disgen-postgres-1 psql -U disgen -t -c "SELECT COUNT(*) FROM drug_mappings;"
echo "Built-in schemes:"
docker exec disgen-postgres-1 psql -U disgen -t -c "SELECT id, name FROM schemes WHERE is_builtin = TRUE ORDER BY id;"
