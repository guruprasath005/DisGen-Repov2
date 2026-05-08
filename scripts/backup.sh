#!/bin/bash
# Manual backup: PostgreSQL dump + MinIO data snapshot.
# Automated daily backups run via the postgres_backup container.
set -e

if [ -f "$(dirname "$0")/../.env" ]; then
    export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$(dirname "$0")/../backups/$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo "[$TIMESTAMP] Starting backup..."

# PostgreSQL dump
echo "  Dumping PostgreSQL..."
docker compose exec -T postgres pg_dump \
    -U disgen \
    -d disgen \
    --no-password \
    -F c \
    -f /tmp/disgen_$TIMESTAMP.dump

docker compose cp postgres:/tmp/disgen_$TIMESTAMP.dump "$BACKUP_DIR/disgen.dump"
docker compose exec -T postgres rm /tmp/disgen_$TIMESTAMP.dump

echo "  PostgreSQL dump saved: $BACKUP_DIR/disgen.dump"
echo ""
echo "Backup complete: $BACKUP_DIR"
echo "Note: MinIO data is backed up automatically by the postgres_backup container."
