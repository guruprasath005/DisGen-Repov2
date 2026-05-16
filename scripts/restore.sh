#!/bin/bash
# Restore a PostgreSQL dump produced by scripts/backup.sh.
#
#   bash scripts/restore.sh backups/20260516_120000
#
# DESTRUCTIVE: overwrites the current `disgen` database. Take a fresh backup
# first. MinIO object data lives on the `minio_data` Docker volume — restore it
# separately from your volume/offsite backup if needed (see OPS_RUNBOOK.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BACKUP_DIR="${1:-}"
[ -n "$BACKUP_DIR" ] || { echo "Usage: bash scripts/restore.sh <backup-dir>"; exit 1; }
DUMP="$BACKUP_DIR/disgen.dump"
[ -f "$DUMP" ] || { echo "Dump not found: $DUMP"; exit 1; }

echo "About to OVERWRITE the live 'disgen' database from:"
echo "  $DUMP"
read -r -p "Type 'RESTORE' to proceed: " confirm
[ "$confirm" = "RESTORE" ] || { echo "Aborted."; exit 1; }

TS=$(date +%Y%m%d_%H%M%S)
echo "[$TS] Safety backup of current DB before restore..."
bash "$SCRIPT_DIR/backup.sh" || echo "  (pre-restore backup failed — continuing as instructed)"

echo "Copying dump into the postgres container..."
docker compose cp "$DUMP" postgres:/tmp/restore_$TS.dump

echo "Restoring (pg_restore --clean)..."
docker compose exec -T postgres pg_restore \
    -U disgen -d disgen --no-password --clean --if-exists \
    /tmp/restore_$TS.dump

docker compose exec -T postgres rm -f /tmp/restore_$TS.dump

echo "Restarting backend + workers so connections reset cleanly..."
docker compose restart backend celery_worker celery_beat

echo "Restore complete. Verify: curl -sk https://localhost/api/health"
