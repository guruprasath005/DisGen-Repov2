#!/bin/bash
# Generates RSA-2048 key pair for RS256 JWT signing.
# Private key stays on server only — never expose it.
set -e

KEYS_DIR="$(dirname "$0")/../backend/auth/keys"
mkdir -p "$KEYS_DIR"

openssl genrsa -out "$KEYS_DIR/private.pem" 2048
openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem"

chmod 600 "$KEYS_DIR/private.pem"
chmod 644 "$KEYS_DIR/public.pem"

echo "JWT keys generated:"
echo "  Private: $KEYS_DIR/private.pem  (keep secret — back up offline)"
echo "  Public:  $KEYS_DIR/public.pem"
