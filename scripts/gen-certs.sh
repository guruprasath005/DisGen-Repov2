#!/bin/bash
# Generates a self-signed TLS certificate for local deployment.
# For production, replace with a real certificate from your CA.
set -e

CERTS_DIR="$(dirname "$0")/../nginx/certs"
mkdir -p "$CERTS_DIR"

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
    -keyout "$CERTS_DIR/disgen.key" \
    -out "$CERTS_DIR/disgen.crt" \
    -subj "/C=IN/ST=Tamil Nadu/L=Chennai/O=DisGen Hospital System/CN=disgen.local" \
    -addext "subjectAltName=DNS:disgen.local,DNS:localhost,IP:127.0.0.1"

chmod 600 "$CERTS_DIR/disgen.key"
chmod 644 "$CERTS_DIR/disgen.crt"

echo "TLS certificate generated:"
echo "  Key:  $CERTS_DIR/disgen.key"
echo "  Cert: $CERTS_DIR/disgen.crt"
echo ""
echo "Valid for 825 days. For production, install a real certificate from your CA."
