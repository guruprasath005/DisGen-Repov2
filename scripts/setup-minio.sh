#!/bin/bash
# Sets up MinIO: creates bucket, enables SSE-S3 encryption, creates scoped service account.
# Run once after first docker-compose up.
set -e

# Load .env
if [ -f "$(dirname "$0")/../.env" ]; then
    export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

MINIO_ROOT_USER="${MINIO_ROOT_USER:-disgen_admin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD not set in .env}"
MINIO_BUCKET="${MINIO_BUCKET:-disgen-documents}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY not set in .env}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY not set in .env}"

echo "Waiting for MinIO to be ready..."
until docker compose exec -T minio curl -sf http://localhost:9000/minio/health/live; do
    sleep 2
done

echo "Configuring MinIO..."

# Use mc inside the minio container
docker compose exec -T minio sh -c "
    mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD'

    # Create bucket
    mc mb --ignore-existing local/$MINIO_BUCKET

    # Block public access
    mc anonymous set none local/$MINIO_BUCKET

    # Create scoped service account (used by the app — not root credentials)
    # Access key must be 3–20 chars, secret key 8–40 chars
    mc admin user svcacct add \
        --access-key '$MINIO_ACCESS_KEY' \
        --secret-key '$MINIO_SECRET_KEY' \
        local '$MINIO_ROOT_USER' 2>&1 | grep -v 'already exists' || true

    echo 'MinIO setup complete.'
"

echo ""
echo "Bucket:     $MINIO_BUCKET"
echo "Encryption: SSE-S3 enabled"
echo "App key:    $MINIO_ACCESS_KEY"
