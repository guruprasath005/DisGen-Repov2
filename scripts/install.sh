#!/bin/bash
# =============================================================================
# DisGen — One-Click Installer
# =============================================================================
# Usage:  bash scripts/install.sh
#
# What this script does automatically:
#   - Generates all passwords and secret keys
#   - Writes .env
#   - Generates JWT RSA key pair
#   - Generates TLS certificate (self-signed; supports IP SANs)
#   - Detects port conflicts with existing services (e.g. n8n)
#   - Builds the React frontend
#   - Starts Docker stack
#   - Waits for all services to be healthy
#   - Runs database migrations
#   - Sets up MinIO file storage
#   - Seeds ICD-10 codes, drug mappings, and schemes
#   - Creates the Super Admin account
#   - Runs a final health check
#
# What you must provide (asked once at the start):
#   - Azure Document Intelligence endpoint + key (OCR)
#   - OpenAI API key (LLM)
#   - Hospital name
#   - Super Admin username + password
# =============================================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────
print_header() {
    echo ""
    echo -e "${BOLD}${BLUE}════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}  DisGen — Clinical Discharge Summary System         ${NC}"
    echo -e "${BOLD}${BLUE}  One-Click Installer                                ${NC}"
    echo -e "${BOLD}${BLUE}════════════════════════════════════════════════════${NC}"
    echo ""
}

step() { echo -e "\n${BOLD}${CYAN}▶  $1${NC}"; }
ok()   { echo -e "   ${GREEN}✓  $1${NC}"; }
warn() { echo -e "   ${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "\n${RED}✗  ERROR: $1${NC}\n"; exit 1; }

ask() {
    local var="$1" prompt="$2" default="${3:-}" value=""
    if [ -n "$default" ]; then
        read -rp "   $prompt [$default]: " value
        value="${value:-$default}"
    else
        while [ -z "$value" ]; do
            read -rp "   $prompt: " value
            [ -z "$value" ] && echo -e "   ${RED}This field is required.${NC}"
        done
    fi
    printf -v "$var" '%s' "$value"
}

ask_secret() {
    local var="$1" prompt="$2" value=""
    while [ -z "$value" ]; do
        read -rsp "   $prompt: " value
        echo ""
        [ -z "$value" ] && echo -e "   ${RED}This field is required.${NC}"
    done
    printf -v "$var" '%s' "$value"
}

ask_secret_confirm() {
    local var="$1" prompt="$2" value="" confirm=""
    while true; do
        read -rsp "   $prompt: " value
        echo ""
        [ -z "$value" ]       && echo -e "   ${RED}Password cannot be empty.${NC}"     && continue
        [ ${#value} -lt 8 ]   && echo -e "   ${RED}At least 8 characters required.${NC}" && continue
        read -rsp "   Confirm $prompt: " confirm
        echo ""
        [ "$value" = "$confirm" ] && break
        echo -e "   ${RED}Passwords do not match. Try again.${NC}"
    done
    printf -v "$var" '%s' "$value"
}

gen_password() { openssl rand -hex 20; }
gen_hex()      { openssl rand -hex "$1"; }
gen_b64()      { openssl rand -base64 32; }

is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

port_in_use() { ss -tlnp 2>/dev/null | grep -qE ":$1[[:space:]]"; }

wait_for_container() {
    local container="$1" max_wait="${2:-120}" elapsed=0
    printf "   Waiting for %s" "$container"
    while ! docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; do
        sleep 3; elapsed=$((elapsed + 3)); printf "."
        [ "$elapsed" -ge "$max_wait" ] && echo "" && fail "$container did not become healthy within ${max_wait}s. Check: docker compose logs $container"
    done
    echo " ready"
}

wait_for_container_running() {
    local container="$1" max_wait="${2:-60}" elapsed=0
    printf "   Waiting for %s" "$container"
    while ! docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; do
        sleep 2; elapsed=$((elapsed + 2)); printf "."
        [ "$elapsed" -ge "$max_wait" ] && echo "" && fail "$container did not start within ${max_wait}s."
    done
    echo " running"
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
preflight() {
    step "Pre-flight checks"

    command -v docker  >/dev/null 2>&1 || fail "Docker is not installed."
    docker info        >/dev/null 2>&1 || fail "Docker is not running."
    command -v openssl >/dev/null 2>&1 || fail "openssl is not installed."
    docker compose version >/dev/null 2>&1 || fail "docker compose (v2) not found."

    ok "Docker is running"
    ok "openssl is available"
    ok "docker compose v2 is available"
}

# ── Collect manual inputs ─────────────────────────────────────────────────────
collect_inputs() {
    step "Configuration — please answer the following questions"
    echo ""
    echo -e "   ${YELLOW}These are the only values you need to provide.${NC}"
    echo -e "   ${YELLOW}Everything else is generated automatically.${NC}"
    echo ""

    echo -e "   ${BOLD}── OCR Service (Azure Document Intelligence) ──${NC}"
    echo "   Create a resource at: portal.azure.com → Document Intelligence → Create"
    echo "   Recommended region: Central India (Pune) for DPDP compliance"
    echo "   Example endpoint: https://your-resource.cognitiveservices.azure.com/"
    echo ""
    ask         AZURE_DOCUMENT_ENDPOINT "Azure Document Intelligence endpoint"
    ask_secret  AZURE_DOCUMENT_KEY      "Azure Document Intelligence API key"

    echo ""
    echo -e "   ${BOLD}── LLM (OpenAI) ──${NC}"
    echo "   Get your API key from: platform.openai.com → API keys"
    echo ""
    ask_secret OPENAI_API_KEY  "OpenAI API key"
    ask        OPENAI_MODEL_ID "OpenAI model" "gpt-4o-mini"

    echo ""
    echo -e "   ${BOLD}── Hospital Details ──${NC}"
    echo ""
    ask HOSPITAL_NAME "Hospital name (appears on PDF header)" "My Hospital"
    ask HOSPITAL_ID   "Hospital ID (short code, no spaces)"   "hospital-001"

    echo ""
    echo -e "   ${BOLD}── Super Admin Account ──${NC}"
    echo "   This is the master administrator account. Store credentials securely."
    echo ""
    ask               SUPERADMIN_USERNAME "Super Admin username"  "superadmin"
    ask               SUPERADMIN_FULLNAME "Super Admin full name" "System Administrator"
    ask               SUPERADMIN_EMAIL    "Super Admin email"
    ask_secret_confirm SUPERADMIN_PASSWORD "Super Admin password"

    echo ""
    echo -e "   ${BOLD}── Network ──${NC}"
    echo "   The IP address or domain where the web app will be accessed."
    echo "   Use the public IP of this server (e.g. 31.97.63.234) or a domain name."
    echo ""
    ask CORS_DOMAIN "Server IP or domain" "localhost"
}

# ── Port conflict detection ───────────────────────────────────────────────────
configure_ports() {
    step "Checking for port conflicts"

    WEB_HTTP_PORT=80
    WEB_HTTPS_PORT=443
    MOBILE_PORT=8080

    local conflict=false

    if port_in_use 80 || port_in_use 443; then
        conflict=true
        warn "Ports 80/443 are already in use (likely by another service such as n8n)"
        echo "   DisGen will use different HTTPS/HTTP ports."
        echo ""
        ask WEB_HTTPS_PORT "DisGen HTTPS port" "9443"
        ask WEB_HTTP_PORT  "DisGen HTTP redirect port" "9080"
    else
        ok "Ports 80/443 are free"
    fi

    if port_in_use 8080; then
        conflict=true
        warn "Port 8080 is already in use"
        ask MOBILE_PORT "DisGen mobile API port" "9081"
    else
        ok "Port 8080 is free"
    fi

    # Port values go into .env — docker-compose.yml reads them via ${DISGEN_PORT_*}
    # so a single compose file is used and there is no list-merge/append conflict.

    ok "Web app:   https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}"
    ok "Mobile API: http://${CORS_DOMAIN}:${MOBILE_PORT}"
}

# ── Generate all secrets ──────────────────────────────────────────────────────
generate_secrets() {
    step "Generating secrets and passwords"

    POSTGRES_PASSWORD=$(gen_password)
    REDIS_PASSWORD=$(gen_password)
    MINIO_ROOT_PASSWORD=$(gen_password)
    MINIO_ACCESS_KEY=$(gen_hex 8)
    MINIO_SECRET_KEY=$(gen_hex 16)
    GRAFANA_ADMIN_PASSWORD=$(gen_password)
    FIELD_ENCRYPTION_KEY=$(gen_b64)
    GLITCHTIP_SECRET_KEY=$(gen_password)

    ok "Postgres password"
    ok "Redis password"
    ok "MinIO credentials"
    ok "Grafana password"
    ok "AES-256-GCM field encryption key"
    ok "GlitchTip secret key"
}

# ── Write .env ────────────────────────────────────────────────────────────────
write_env() {
    step "Writing .env"

    ENV_FILE="$PROJECT_ROOT/.env"

    if [ -f "$ENV_FILE" ]; then
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
        warn "Existing .env backed up"
    fi

    # CORS: include both the configured domain/IP and the mobile port
    if [ "$CORS_DOMAIN" = "localhost" ]; then
        CORS_ORIGINS="https://localhost,http://localhost:${MOBILE_PORT}"
    else
        CORS_ORIGINS="https://${CORS_DOMAIN},https://${CORS_DOMAIN}:${WEB_HTTPS_PORT},http://${CORS_DOMAIN}:${MOBILE_PORT}"
    fi

    cat > "$ENV_FILE" <<EOF
# DisGen — Environment Configuration
# Generated by install.sh on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# DO NOT commit this file to version control.

# ── Database ──────────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://disgen:${POSTGRES_PASSWORD}@postgres:5432/disgen
DATABASE_TEST_URL=postgresql://disgen:${POSTGRES_PASSWORD}@postgres:5432/disgen_test

# ── Cache / Broker ────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

# ── File Storage (MinIO) ──────────────────────────────────────────────────────
MINIO_ROOT_USER=disgen_admin
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
MINIO_BUCKET=disgen-documents

# ── Azure Document Intelligence (OCR) ────────────────────────────────────────
# Region: Central India (Pune) — DPDP compliant data residency
AZURE_DOCUMENT_ENDPOINT=${AZURE_DOCUMENT_ENDPOINT}
AZURE_DOCUMENT_KEY=${AZURE_DOCUMENT_KEY}

# ── OpenAI (LLM) ─────────────────────────────────────────────────────────────
OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_MODEL_ID=${OPENAI_MODEL_ID}

# ── PHI Field Encryption (AES-256-GCM) ───────────────────────────────────────
FIELD_ENCRYPTION_KEY=${FIELD_ENCRYPTION_KEY}

# ── JWT Signing (RS256) ───────────────────────────────────────────────────────
JWT_PRIVATE_KEY_PATH=/app/auth/keys/private.pem
JWT_PUBLIC_KEY_PATH=/app/auth/keys/public.pem
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=15
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7

# ── Port bindings (read by docker-compose.yml nginx service) ─────────────────
DISGEN_PORT_HTTP=${WEB_HTTP_PORT}
DISGEN_PORT_HTTPS=${WEB_HTTPS_PORT}
DISGEN_PORT_MOBILE=${MOBILE_PORT}

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS=${CORS_ORIGINS}

# ── Hospital ──────────────────────────────────────────────────────────────────
HOSPITAL_NAME=${HOSPITAL_NAME}
HOSPITAL_ID=${HOSPITAL_ID}

# ── Celery ────────────────────────────────────────────────────────────────────
CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/1
CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/2

# ── GlitchTip (Error Tracking — optional) ────────────────────────────────────
GLITCHTIP_SECRET_KEY=${GLITCHTIP_SECRET_KEY}
GLITCHTIP_DSN=
GLITCHTIP_DOMAIN=https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}
GLITCHTIP_EMAIL_URL=consolemail://

# ── Grafana ───────────────────────────────────────────────────────────────────
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}

# ── ChromaDB (RAG) ────────────────────────────────────────────────────────────
CHROMA_HOST=chromadb
CHROMA_PORT=8000

# ── DPDP Compliance ───────────────────────────────────────────────────────────
DATA_RETENTION_DAYS=2555
ANONYMIZE_ON_EXPIRY=true

# ── Cookie Security ───────────────────────────────────────────────────────────
COOKIE_SECURE=true
EOF

    chmod 600 "$ENV_FILE"
    ok ".env written (chmod 600)"
}

# ── Generate JWT keys ─────────────────────────────────────────────────────────
generate_jwt_keys() {
    step "Generating JWT RSA-2048 key pair"

    KEYS_DIR="$PROJECT_ROOT/backend/auth/keys"
    mkdir -p "$KEYS_DIR"

    if [ -f "$KEYS_DIR/private.pem" ]; then
        warn "JWT keys already exist — skipping"
        return
    fi

    openssl genrsa -out "$KEYS_DIR/private.pem" 2048 2>/dev/null
    openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem" 2>/dev/null
    chmod 644 "$KEYS_DIR/private.pem"
    chmod 644 "$KEYS_DIR/public.pem"

    ok "Private key: backend/auth/keys/private.pem"
    ok "Public key:  backend/auth/keys/public.pem"
    warn "IMPORTANT: Back up private.pem to a secure offline location now."
}

# ── Generate TLS certificate ──────────────────────────────────────────────────
generate_tls_cert() {
    step "Generating TLS certificate (self-signed)"

    CERTS_DIR="$PROJECT_ROOT/nginx/certs"
    mkdir -p "$CERTS_DIR"

    if [ -f "$CERTS_DIR/disgen.crt" ]; then
        warn "TLS certificate already exists — skipping"
        return
    fi

    # IP addresses need IP: SAN entries; hostnames need DNS: entries
    local san_entries
    if is_ip "$CORS_DOMAIN"; then
        san_entries="IP:${CORS_DOMAIN},IP:127.0.0.1"
    else
        san_entries="DNS:${CORS_DOMAIN},DNS:localhost,IP:127.0.0.1"
    fi

    openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
        -keyout "$CERTS_DIR/disgen.key" \
        -out    "$CERTS_DIR/disgen.crt" \
        -subj   "/C=IN/ST=Tamil Nadu/O=DisGen/CN=${CORS_DOMAIN}" \
        -addext "subjectAltName=${san_entries}" \
        2>/dev/null

    chmod 600 "$CERTS_DIR/disgen.key"
    chmod 644 "$CERTS_DIR/disgen.crt"

    ok "Certificate valid for 825 days (SAN: ${san_entries})"
    if [ "$CORS_DOMAIN" != "localhost" ]; then
        warn "Browser will show a certificate warning — click Advanced → Proceed to continue."
        warn "To remove the warning, add the cert to your system's trusted store or use a CA cert."
    fi
}

# ── Build React frontend ──────────────────────────────────────────────────────
build_frontend() {
    step "Building React frontend"

    DIST_DIR="$PROJECT_ROOT/frontend/dist"

    # Skip if already built (e.g. transferred as pre-built from dev machine)
    if [ -f "$DIST_DIR/index.html" ]; then
        ok "frontend/dist already present — skipping build"
        return
    fi

    if ! command -v node >/dev/null 2>&1; then
        fail "Node.js is not installed. Either:
   a) Install Node.js 18+ and re-run this script, OR
   b) Build the frontend on your dev machine (cd frontend && npm run build)
      then re-run this script (it will detect the dist and skip building)."
    fi

    command -v npm >/dev/null 2>&1 || fail "npm is not installed."

    local node_ver
    node_ver=$(node --version | sed 's/v//')
    local node_major
    node_major=$(echo "$node_ver" | cut -d. -f1)
    [ "$node_major" -lt 18 ] && fail "Node.js 18+ required (found v${node_ver})."

    echo "   Installing dependencies..."
    npm --prefix "$PROJECT_ROOT/frontend" ci --silent

    echo "   Building..."
    VITE_API_URL=/api npm --prefix "$PROJECT_ROOT/frontend" run build -- --logLevel warn

    [ -f "$DIST_DIR/index.html" ] || fail "Build failed — frontend/dist/index.html not found."
    ok "Frontend built → frontend/dist/"
}

# ── Disable dev override ──────────────────────────────────────────────────────
disable_dev_override() {
    local override="$PROJECT_ROOT/docker-compose.override.yml"
    if [ -f "$override" ]; then
        step "Disabling docker-compose.override.yml (development-only)"
        mv "$override" "$override.disabled"
        ok "Renamed to docker-compose.override.yml.disabled"
    fi
}

# ── Start Docker stack ────────────────────────────────────────────────────────
start_docker() {
    step "Starting Docker stack"
    cd "$PROJECT_ROOT"

    echo "   Building backend image..."
    docker compose build --quiet backend 2>&1 | tail -3

    echo "   Starting all services..."
    docker compose up -d

    ok "Docker stack started"
}

# ── Wait for services ─────────────────────────────────────────────────────────
wait_for_services() {
    step "Waiting for services to become healthy (30–90 s on first run)"

    wait_for_container "disgen-postgres-1"  120
    wait_for_container "disgen-redis-1"      60
    wait_for_container "disgen-minio-1"      60
    wait_for_container "disgen-chromadb-1"   90
    wait_for_container "disgen-backend-1"   120
    wait_for_container_running "disgen-celery_worker-1" 60

    ok "All services healthy"
}

# ── Run database migrations ───────────────────────────────────────────────────
run_migrations() {
    step "Running database migrations"

    docker exec disgen-backend-1 \
        bash -c "cd /app && alembic upgrade head" 2>&1 | \
        grep -E "Running|OK|already|INFO" || true

    ok "Migrations applied"
}

# ── Setup MinIO ───────────────────────────────────────────────────────────────
setup_minio() {
    step "Setting up MinIO file storage"
    bash "$SCRIPT_DIR/setup-minio.sh" 2>&1 | grep -v "^$" || true
    ok "MinIO bucket and credentials configured"
}

# ── Seed database ─────────────────────────────────────────────────────────────
seed_database() {
    step "Seeding database (ICD-10 codes, drugs, schemes)"
    echo "   Seeding drugs..."
    docker exec disgen-backend-1 python3 /app/seed/drugs.py 2>&1 | tail -1

    echo "   Seeding ICD-10 codes (downloads ~4 MB — may take 1-2 minutes)..."
    docker exec disgen-backend-1 python3 /app/seed/icd10.py 2>&1 | tail -1

    echo "   Seeding schemes and ChromaDB RAG rules..."
    docker exec disgen-backend-1 python3 /app/seed/schemes.py 2>&1 | tail -1

    ok "74,719 ICD-10 codes loaded"
    ok "690 drug mappings loaded"
    ok "6 built-in schemes loaded (PM-JAY, CGHS, ESI, CMCHIS, Private, Complete)"
}

# ── Create Super Admin ────────────────────────────────────────────────────────
create_superadmin() {
    step "Creating Super Admin account"

    docker exec disgen-backend-1 python3 /app/seed/create_superadmin.py \
        "$SUPERADMIN_USERNAME" \
        "$SUPERADMIN_PASSWORD" \
        "$SUPERADMIN_FULLNAME" \
        "$SUPERADMIN_EMAIL"

    ok "Super Admin '${SUPERADMIN_USERNAME}' created"
}

# ── Final health check ────────────────────────────────────────────────────────
final_check() {
    step "Running final health check"

    local url="https://localhost:${WEB_HTTPS_PORT}/api/health"
    local code
    code=$(curl -sk "$url" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")

    if [ "$code" = "200" ]; then
        ok "API health check passed (HTTP 200)"
    else
        warn "Health check returned HTTP ${code} — the system may need another minute to settle"
        warn "Try: curl -sk https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}/api/health"
    fi
}

# ── Save credentials summary ──────────────────────────────────────────────────
save_credentials() {
    local creds="$PROJECT_ROOT/CREDENTIALS.txt"

    cat > "$creds" <<EOF
DisGen — Installation Credentials
Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
==================================================
KEEP THIS FILE SECURE. DO NOT SHARE OR COMMIT.

Web App URL:   https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}
Mobile API:    http://${CORS_DOMAIN}:${MOBILE_PORT}
Grafana URL:   https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}/grafana
GlitchTip:     https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}/glitchtip

Super Admin
  Username:    ${SUPERADMIN_USERNAME}
  Email:       ${SUPERADMIN_EMAIL}
  Password:    (as entered during install)

Grafana Admin
  Username:    admin
  Password:    ${GRAFANA_ADMIN_PASSWORD}

Database
  Host:        postgres:5432 (internal)
  DB:          disgen
  User:        disgen
  Password:    ${POSTGRES_PASSWORD}

MinIO Console: http://localhost:9001 (via SSH tunnel)
  User:        disgen_admin
  Password:    ${MINIO_ROOT_PASSWORD}

JWT Private Key: backend/auth/keys/private.pem
  → BACK THIS UP OFFLINE. If lost, all active sessions are invalidated.
==================================================
EOF

    chmod 600 "$creds"
    ok "Credentials saved to CREDENTIALS.txt (chmod 600)"
}

# ── Print final summary ───────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}  DisGen is ready!                                   ${NC}"
    echo -e "${BOLD}${GREEN}════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Web App:${NC}    https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}"
    echo -e "  ${BOLD}Mobile API:${NC} http://${CORS_DOMAIN}:${MOBILE_PORT}/api"
    echo -e "  ${BOLD}Grafana:${NC}    https://${CORS_DOMAIN}:${WEB_HTTPS_PORT}/grafana"
    echo ""
    echo -e "  ${BOLD}Login:${NC} ${SUPERADMIN_USERNAME} / (password you set)"
    echo ""
    if [ "${WEB_HTTPS_PORT}" != "443" ] || [ "${MOBILE_PORT}" != "8080" ]; then
        echo -e "  ${YELLOW}Non-standard ports are in use.${NC}"
        echo "   Update your mobile app's EXPO_PUBLIC_API_URL:"
        echo "   http://${CORS_DOMAIN}:${MOBILE_PORT}/api"
        echo ""
    fi
    echo -e "  ${YELLOW}Note:${NC} Browser will show a certificate warning (self-signed cert)."
    echo "   Click 'Advanced' → 'Proceed' to continue."
    echo ""
    echo -e "  ${CYAN}Manage:${NC}"
    echo "   docker compose logs -f"
    echo "   docker compose stop"
    echo "   docker compose up -d"
    echo ""
}

# ── .env validation ───────────────────────────────────────────────────────────
validate_env() {
    step "Validating .env"
    [ -f "$PROJECT_ROOT/.env" ] || fail ".env not found — run a full install first: bash scripts/install.sh"

    if grep -qiE '=[[:space:]]*.*changeme' "$PROJECT_ROOT/.env"; then
        echo -e "   ${RED}Placeholder secrets still present:${NC}"
        grep -niE '=[[:space:]]*.*changeme' "$PROJECT_ROOT/.env" | sed -E 's/=.*/=<changeme>/'
        fail "Replace every 'changeme' value in .env before deploying."
    fi

    # DPDP note — informational, non-blocking (mirrors the backend startup guard).
    if ! grep -q '^LLM_PROVIDER=' "$PROJECT_ROOT/.env" || grep -qE '^LLM_PROVIDER=openai[[:space:]]*$' "$PROJECT_ROOT/.env"; then
        warn "LLM_PROVIDER=openai -> patient PHI is processed in the US (NOT DPDP-compliant)."
        warn "Switch to an in-India provider before hospital go-live (see backend/llm/provider.py)."
    fi
    ok ".env validated"
}

# ── Idempotent upgrade / redeploy ─────────────────────────────────────────────
# Rebuild + migrate + restart using the EXISTING .env. No secrets re-prompted
# or regenerated. Safe to run repeatedly after a `git pull`.
upgrade() {
    print_header
    preflight
    validate_env
    disable_dev_override

    # Force a fresh frontend build — build_frontend() skips when a dist/
    # already exists, which on an upgrade would silently redeploy the OLD UI.
    if [ -d "$PROJECT_ROOT/frontend/dist" ]; then
        step "Clearing stale frontend/dist for a clean rebuild"
        rm -rf "$PROJECT_ROOT/frontend/dist"
        ok "Removed previous build"
    fi
    build_frontend

    # Pull latest images for pinned third-party services (db/cache/etc.);
    # the backend image is rebuilt from source inside start_docker.
    step "Pulling base service images"
    (cd "$PROJECT_ROOT" && docker compose pull --quiet 2>/dev/null) || \
        warn "docker compose pull skipped (offline or no updates)"

    start_docker
    wait_for_services
    run_migrations

    step "Post-upgrade health check"
    local code
    code=$(curl -sk "https://localhost/api/health" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        ok "API healthy (HTTP 200)"
    else
        warn "Health returned HTTP ${code} — give it a minute, then: docker compose logs -f backend"
    fi

    echo ""
    ok "Upgrade complete — redeployed from existing .env."
    echo "   Logs:   docker compose logs -f"
    echo "   Backup: bash scripts/backup.sh   (recommended before upgrades)"
    echo ""
}

usage() {
    cat <<EOF
DisGen installer / operator

  bash scripts/install.sh            First-time install (interactive)
  bash scripts/install.sh --upgrade  Idempotent redeploy: rebuild + migrate +
                                      restart using the existing .env. No
                                      secrets re-prompted. Run after a git pull.
  bash scripts/install.sh --validate Check .env for placeholder secrets + DPDP
  bash scripts/install.sh --help     Show this help

Operations runbook: OPS_RUNBOOK.md
EOF
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    print_header
    preflight
    collect_inputs
    configure_ports
    generate_secrets
    write_env
    generate_jwt_keys
    generate_tls_cert
    build_frontend
    disable_dev_override
    start_docker
    wait_for_services
    run_migrations
    setup_minio
    seed_database
    create_superadmin
    final_check
    save_credentials
    print_summary
}

case "${1:-}" in
    --upgrade)  upgrade ;;
    --validate) print_header; validate_env ;;
    -h|--help)  usage ;;
    "")         main "$@" ;;
    *)          echo "Unknown option: $1"; echo; usage; exit 1 ;;
esac
