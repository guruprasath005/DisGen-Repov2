#!/bin/bash
# Creates extra databases in postgres on first container boot.
# The main 'disgen' DB is created automatically by POSTGRES_DB env var.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE disgen_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'disgen_test')\gexec
    SELECT 'CREATE DATABASE glitchtip' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'glitchtip')\gexec
EOSQL

echo "Extra databases ready: disgen_test, glitchtip"
