# DisGen → Production-Grade Security Upgrade Plan

> This document is the authoritative implementation guide for hardening DisGen to match the security posture of Stobaeus Voice. Every fix is ordered, cross-referenced to the exact files that must change, and annotated with the specific care instructions that prevent data loss or silent regressions during implementation.
>
> **Do not skip or reorder fixes.** Several fixes have hard dependencies on earlier ones (noted inline).

---

## Starter Prompt

```
You are implementing the production-grade security upgrades for DisGen, a clinical discharge summary generation system (Python FastAPI + Celery + PostgreSQL + React Native).

The upgrade plan is in UPGRADE_TO_PROD_GRADE.md. Work through the fixes in order. Each fix has: what to change, which files to touch, and care notes you must follow exactly. Do not add features beyond what the fix describes. Do not modify migration files that are already applied — always create a new numbered migration. Run the test suite after each fix before moving to the next.

Start with Fix 1: Argon2id password hashing.
```

---

## Table of Contents

1. [Argon2id Password Hashing](#fix-1-argon2id-password-hashing)
2. [Encryption Key Rotation](#fix-2-encryption-key-rotation)
3. [Audit Hash Chain + Append-Only Role](#fix-3-audit-hash-chain--append-only-role)
4. [Refresh Token DB Persistence + Family Revocation](#fix-4-refresh-token-db-persistence--family-revocation)
5. [TOTP / Multi-Factor Authentication](#fix-5-totp--multi-factor-authentication)
6. [PHI De-identification Before LLM](#fix-6-phi-de-identification-before-llm)
7. [Boot Guard Hardening](#fix-7-boot-guard-hardening)
8. [Tenant Isolation Design](#fix-8-tenant-isolation-design)

---

## Fix 1: Argon2id Password Hashing

### What is wrong

`backend/auth/password.py` uses bcrypt exclusively. Bcrypt is parallelisable on GPUs — a database leak can be cracked orders of magnitude faster than argon2id. There is no upgrade path for existing accounts.

### What to implement

Replace the passlib `CryptContext` with argon2id as the primary scheme and bcrypt as a deprecated fallback. Passlib handles both transparently — `verify()` accepts either hash; `needs_rehash()` returns `True` for old bcrypt hashes so you can upgrade lazily on the next successful login.

Add a `password_algo` column to `users` to track which algorithm each account uses. This is auditable and useful for migration reporting.

**Files to change:**
- `backend/auth/password.py` — replace CryptContext
- `backend/models/user.py` — add `password_algo` column
- `backend/auth/router.py` — add lazy rehash on successful login
- `backend/migrations/versions/0009_argon2id.py` — new migration (ADD COLUMN)
- `backend/requirements.txt` — add `argon2-cffi`

**Implementation:**

```python
# backend/auth/password.py
from passlib.context import CryptContext

_pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["bcrypt"],
    argon2__memory_cost=65536,   # 64 MB — tuned for hospital-grade server
    argon2__time_cost=3,
    argon2__parallelism=4,
    bcrypt__rounds=12,           # kept for legacy verification only
)

def hash_password(plaintext: str) -> str:
    return _pwd_context.hash(plaintext)       # always argon2id for new hashes

def verify_password(plaintext: str, hashed: str) -> bool:
    return _pwd_context.verify(plaintext, hashed)

def needs_rehash(hashed: str) -> bool:
    return _pwd_context.needs_update(hashed)
```

```python
# In login success handler (backend/auth/router.py), after verify_password passes:
from auth.password import needs_rehash, hash_password

if needs_rehash(user.hashed_password):
    user.hashed_password = hash_password(body.password)
    user.password_algo = "argon2id"
    # db.add(user) is already called below — no extra flush needed
```

**Migration:**
```sql
ALTER TABLE users ADD COLUMN password_algo VARCHAR(20) NOT NULL DEFAULT 'bcrypt';
```
After migration, existing rows default to `'bcrypt'`. On first successful login they are upgraded to `'argon2id'` by the lazy rehash above.

### Care notes

- `argon2-cffi` must be installed before the migration runs. Add to `requirements.txt`, rebuild the image.
- Do NOT change `hashed_password` format for existing rows in the migration — the lazy upgrade in the login handler does it safely at runtime.
- The argon2 memory parameter (65536 = 64 MB) will add ~100 ms to login. Acceptable for clinical logins; do not reduce below 32 MB (32768).
- Test with `test_auth_password.py` — add cases for bcrypt-hash verify success and needs_rehash returning True.

---

## Fix 2: Encryption Key Rotation

### What is wrong

`backend/crypto.py` uses a single key with no version tracking. The wire format is `base64(nonce | ciphertext+tag)` — there is no `keyId` embedded. If the key is ever rotated, every encrypted row in the database becomes permanently unreadable. In practice this means the key is never rotated, which means a key compromise is permanent.

### What to implement

Add a `keyId` prefix to every new ciphertext. Keep old keys in a JSON keyring env var (`FIELD_ENCRYPTION_KEYS_OLD`) for decryption of historical rows. Write a walker script that rewrites old-keyId rows to the new active key.

New wire format: `v{keyId}:{base64(nonce | ciphertext+tag)}`

Old format (3 parts, no version prefix) must still decrypt — `safe_decrypt()` detects it by the absence of a `v` prefix.

**Files to change:**
- `backend/crypto.py` — full rewrite
- `backend/config.py` — add `FIELD_ENCRYPTION_KEY_ID`, `FIELD_ENCRYPTION_KEYS_OLD`
- `backend/scripts/rotate_encryption_key.py` — new walker script
- `.env.example` — document new vars
- Alembic migration: not needed (column types unchanged, just the stored string format changes)

**Implementation:**

```python
# backend/crypto.py
import base64, json, os
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

class TamperDetectedError(Exception):
    pass

def _decode_key(b64: str) -> bytes:
    key = base64.b64decode(b64 + "==")
    if len(key) != 32:
        raise RuntimeError(f"Encryption key must be 32 bytes (got {len(key)})")
    return key

def _active_key_id() -> str:
    return os.environ.get("FIELD_ENCRYPTION_KEY_ID", "1")

def _active_key() -> bytes:
    return _decode_key(os.environ["FIELD_ENCRYPTION_KEY"])

def _keyring() -> dict[str, bytes]:
    """Active key + all retired keys keyed by their id."""
    ring = {_active_key_id(): _active_key()}
    old = os.environ.get("FIELD_ENCRYPTION_KEYS_OLD", "")
    if old:
        for kid, b64 in json.loads(old).items():
            ring[kid] = _decode_key(b64)
    return ring

def encrypt(plaintext: str) -> str:
    key_id = _active_key_id()
    aesgcm = AESGCM(_active_key())
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    blob = base64.b64encode(nonce + ct).decode()
    return f"v{key_id}:{blob}"

def decrypt(token: str) -> str:
    ring = _keyring()
    if token.startswith("v") and ":" in token:
        key_id, blob = token[1:].split(":", 1)
    else:
        # Legacy format — try every key in the ring (oldest deployments)
        blob = token
        for key_id, key_bytes in ring.items():
            try:
                return _decrypt_blob(blob, key_bytes)
            except (TamperDetectedError, ValueError):
                continue
        raise TamperDetectedError("Legacy ciphertext did not decrypt under any known key")
    key_bytes = ring.get(key_id)
    if not key_bytes:
        raise RuntimeError(f"Encryption key id '{key_id}' not found in keyring")
    return _decrypt_blob(blob, key_bytes)

def _decrypt_blob(blob: str, key_bytes: bytes) -> str:
    aesgcm = AESGCM(key_bytes)
    data = base64.b64decode(blob)
    if len(data) < 28:
        raise ValueError("Ciphertext too short")
    try:
        return aesgcm.decrypt(data[:12], data[12:], None).decode()
    except InvalidTag as e:
        raise TamperDetectedError("GCM tag verification failed") from e

def safe_decrypt(token: str | None) -> str | None:
    """Decrypt; return None if token is None or plaintext (pre-encryption rows)."""
    if not token:
        return None
    try:
        return decrypt(token)
    except Exception:
        return token  # plaintext legacy row — return as-is
```

**Walker script** (`backend/scripts/rotate_encryption_key.py`):
- Reads all rows where the stored ciphertext does NOT start with `v{ACTIVE_KEY_ID}:`
- Decrypts with the old key, re-encrypts with the new active key
- Updates the row
- Idempotent — safe to re-run after a crash
- `--dry-run` flag (default) shows what would change; `--apply` executes
- `--table` flag to scope by table name

**.env.example additions:**
```env
FIELD_ENCRYPTION_KEY_ID=1
FIELD_ENCRYPTION_KEYS_OLD={}
# When rotating: set KEY_ID to 2, move old key to KEYS_OLD={"1":"<old_key>"}
```

### Care notes

- **Do Fix 1 first.** Fix 2 does not depend on Fix 1 directly, but the deployment window (image rebuild) is shared — bundle the `requirements.txt` change once.
- **Take a full database backup before rotating any key.** The walker script must run as the database owner, not the application role.
- New `encrypt()` calls start producing `v1:...` immediately after deployment. Old `v`-less rows still decrypt via the legacy path. The walker can then rewrite them at leisure.
- Never remove a key from the keyring until the walker reports zero rows remaining with that key ID.
- Test: round-trip a `v1:...` ciphertext, then simulate rotation (set KEY_ID=2, old key in KEYS_OLD) and verify the old ciphertext still decrypts.

---

## Fix 3: Audit Hash Chain + Append-Only Role

### What is wrong

`audit_logs` is a plain table. Any actor with database access — or a successful SQL injection — can silently alter or erase audit history. There is no cryptographic integrity check and no DB-level write restriction. For a clinical system this breaks regulatory audit requirements.

### What to implement

**Part A — Hash chain:** Add `prev_hash TEXT` and `hash TEXT` columns to `audit_logs`. Every insert computes `SHA-256(prev_hash || canonical(row))` and stores it. A verification walk can replay the chain and detect any tampered row.

**Part B — Advisory lock:** Use `pg_advisory_xact_lock` keyed on the hospital id before each insert to prevent concurrent fork (two rows written simultaneously would both claim the same `prev_hash`).

**Part C — Append-only DB role:** Create a `disgen_app` Postgres role with `NOSUPERUSER NOBYPASSRLS`. Grant it `SELECT, INSERT` on `audit_logs`. Explicitly `REVOKE UPDATE, DELETE, TRUNCATE` on `audit_logs`. The application connects as this role. A compromised app process cannot rewrite history.

**Files to change:**
- `backend/migrations/versions/0009_audit_chain.py` — add columns, create role, revoke privs
- `backend/models/audit.py` — add `prev_hash`, `hash` columns
- `backend/audit.py` — new module: `create_audit_log()`, `verify_audit_chain()`
- Every call site that does `db.add(AuditLog(...))` — replace with `await create_audit_log(...)`
- `backend/config.py` — add `APP_DATABASE_URL` (connection string for the restricted app role)
- `backend/database.py` — default engine uses `APP_DATABASE_URL`; owner engine used only in migration/rotation scripts

**Canonical fields** (these must never be encrypted columns — hash chain must survive key rotation):
```
id, user_id, username, role, action, document_id, ip_address, created_at, prev_hash
```

**Core implementation:**
```python
# backend/audit.py
import hashlib, json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from models.audit import AuditLog

def _canonicalize(row: dict) -> str:
    fields = ["id","user_id","username","role","action","document_id","ip_address","created_at","prev_hash"]
    return json.dumps({k: str(row[k]) if row[k] is not None else None for k in fields}, sort_keys=True)

async def create_audit_log(db: AsyncSession, *, hospital_id: str, **kwargs) -> AuditLog:
    # Advisory lock scoped to this transaction — prevents concurrent inserts forking the chain
    lock_key = hash(hospital_id) & 0x7FFFFFFFFFFFFFFF  # pg_advisory needs int64
    await db.execute(text(f"SELECT pg_advisory_xact_lock({lock_key})"))

    # Fetch the last hash for this hospital
    result = await db.execute(
        text("SELECT hash FROM audit_logs WHERE hospital_id = :hid ORDER BY created_at DESC LIMIT 1"),
        {"hid": hospital_id},
    )
    row = result.fetchone()
    prev_hash = row[0] if row else "0" * 64  # genesis

    # Build the row (without hash first, to get the id assigned)
    entry = AuditLog(**kwargs, hospital_id=hospital_id, prev_hash=prev_hash)
    db.add(entry)
    await db.flush()  # assigns entry.id + created_at from DB default

    # Compute hash over canonical fields now that id/created_at are known
    canonical = _canonicalize({
        "id": entry.id, "user_id": entry.user_id, "username": entry.username,
        "role": entry.role, "action": entry.action, "document_id": entry.document_id,
        "ip_address": entry.ip_address, "created_at": entry.created_at,
        "prev_hash": prev_hash,
    })
    entry.hash = hashlib.sha256(canonical.encode()).hexdigest()
    db.add(entry)
    return entry
```

**Migration additions:**
```sql
-- 0009_audit_chain.py
ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN hash TEXT;
ALTER TABLE audit_logs ADD COLUMN hospital_id VARCHAR(100);

-- App role (restricted)
CREATE ROLE disgen_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD 'changeme-set-in-env';
GRANT CONNECT ON DATABASE disgen TO disgen_app;
GRANT USAGE ON SCHEMA public TO disgen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO disgen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO disgen_app;
-- Lock audit_logs down: app can only append
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM disgen_app;
```

**Verification endpoint** (`GET /admin/audit/verify`):
Walk all rows ordered by `created_at`, recompute each hash, check `hash == computed` and `prev_hash == previous_row.hash`. Return `{ok: bool, first_broken_id: str | null, total_checked: int}`.

### Care notes

- **The advisory lock is critical.** Without it two concurrent requests can both read the same `prev_hash` as their predecessor and the chain forks. The lock is transaction-scoped — it releases automatically on commit/rollback.
- `hospital_id` column on `audit_logs` is required because the chain is per-hospital (needed for Fix 8 multi-tenant design). Even in single-tenant mode, add it now — set it from `settings.hospital_id`.
- Canonical fields must NOT include `details` (JSONB) because JSONB serialization is not deterministic across Postgres versions. Stick to scalar fields only.
- The `prev_hash` for the first row in a new hospital is the string `"0" * 64` (the genesis sentinel).
- Replace every `db.add(AuditLog(...))` call site with `await create_audit_log(db, ...)` before deploying. A mix of hashed and non-hashed rows will break the verification walk.
- Existing rows before the migration will have `prev_hash = NULL` and `hash = NULL`. The verification walk must treat any row with `hash = NULL` as the start of a new chain segment (pre-hardening legacy rows). Document this boundary clearly in the verifier output.
- Test: insert two audit rows in a transaction, verify chain. Then manually UPDATE a row's `action` field as the owner role and verify that the verifier catches it.

---

## Fix 4: Refresh Token DB Persistence + Family Revocation

### What is wrong

Refresh tokens exist only in Redis. A Redis flush (restart, eviction, data loss) silently invalidates all revocation state — previously revoked tokens become valid again. There is also no `family_id` concept: when reuse is detected, all sessions for the user are nuked rather than just the compromised family. You cannot tell which login session was stolen.

### What to implement

**Part A — RefreshToken table:** Add a `refresh_tokens` table as the authoritative record. Redis remains as a fast-path cache. On reuse detection, the DB is the ground truth.

**Part B — Family ID:** Add `family_id` (UUID, set at login, inherited through every rotation). One login = one family. Reuse of a revoked token revokes only that family, not all sessions. The Super Admin can see which family was compromised without logging everyone else out.

**Files to change:**
- `backend/migrations/versions/0010_refresh_tokens.py` — new table
- `backend/models/refresh_token.py` — new SQLAlchemy model
- `backend/auth/service.py` — `create_refresh_token`, `try_blacklist_token`, `revoke_all_sessions`
- `backend/auth/router.py` — login: set `family_id`; refresh: pass `family_id` forward; reuse: call `revoke_family` not `revoke_all_sessions`

**Schema:**
```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jti UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id),
    family_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(50),   -- 'used', 'logout', 'reuse', 'admin'
    created_ip VARCHAR(45),
    created_ua TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON refresh_tokens (user_id);
CREATE INDEX ON refresh_tokens (family_id);
CREATE INDEX ON refresh_tokens (jti);
```

**Revocation logic:**
```python
# On reuse detected: revoke only this family
async def revoke_family(db: AsyncSession, family_id: uuid.UUID, reason: str = "reuse") -> int:
    result = await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at == None)
        .values(revoked_at=datetime.now(timezone.utc), revoke_reason=reason)
        .returning(RefreshToken.jti, RefreshToken.expires_at)
    )
    rows = result.fetchall()
    for jti, exp in rows:
        await blacklist_token(str(jti), int(exp.timestamp()))  # warm Redis cache
    return len(rows)
```

**JWT payload addition:** Embed `family_id` in the refresh token JWT so the rotation handler can read it without a DB round-trip.

### Care notes

- The DB is authoritative. Redis is a cache. On any Redis miss, fall back to DB check: `SELECT revoked_at FROM refresh_tokens WHERE jti = $1`.
- The `REVOKE UPDATE, DELETE` grant from Fix 3 applies only to `audit_logs`. `refresh_tokens` still needs `UPDATE` for the `revoked_at` column — do not accidentally restrict it.
- Mobile clients receive the refresh token in the response body. The `family_id` is embedded in the JWT, so mobile clients do not need any schema changes.
- Test: simulate a refresh token reuse (rotate once, then send the original token again). Verify: only the family is revoked, not the user's other families (other logins from different devices).

---

## Fix 5: TOTP / Multi-Factor Authentication

### What is wrong

DisGen has no MFA. A stolen password is a full compromise. For a system handling patient clinical records this is unacceptable.

### What to implement

RFC 6238 TOTP (same spec as Stobaeus Voice): 6-digit, 30-second window, ±1 tolerance for clock skew, HMAC-SHA1, Base-32 secret.

Flow:
1. Admin or doctor logs in with password → receives a **setup token** (scoped JWT, short-lived, accepted only on TOTP setup endpoints).
2. Setup endpoint returns QR code URL + manual entry key.
3. Verify endpoint accepts the TOTP code, marks `totp_enabled = True` on the user, returns `must_reauthenticate = True`.
4. On subsequent logins: after password check, if `totp_enabled`, require TOTP code in the login request before issuing access + refresh tokens.
5. Env vars: `ADMIN_REQUIRE_TOTP=true`, `DOCTOR_REQUIRE_TOTP=false` (matches Stobaeus Voice pattern).

**Files to change:**
- `backend/totp.py` — new module (generate secret, generate QR URL, verify code)
- `backend/auth/router.py` — add TOTP check in login, add `/auth/totp-setup` and `/auth/totp-verify` endpoints
- `backend/auth/service.py` — `create_setup_token()` (scoped JWT, 10 min)
- `backend/auth/dependencies.py` — `get_current_user` must reject setup-scoped tokens on regular endpoints
- `backend/models/user.py` — add `totp_secret TEXT` (encrypted), `totp_enabled BOOLEAN`
- `backend/config.py` — add `ADMIN_REQUIRE_TOTP`, `DOCTOR_REQUIRE_TOTP`
- `backend/migrations/versions/0011_totp.py` — ADD COLUMN totp_secret, totp_enabled

**Core TOTP library:** use `pyotp` (add to `requirements.txt`).

```python
# backend/totp.py
import pyotp, base64, os

ISSUER = "DisGen"

def generate_secret() -> str:
    return pyotp.random_base32()

def totp_uri(secret: str, username: str) -> str:
    return pyotp.totp.TOTP(secret).provisioning_uri(name=username, issuer_name=ISSUER)

def verify_code(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)
```

**Scoped setup token:** Add `scope: "totp-setup"` to the JWT payload. `get_current_user` must reject any token with a `scope` field unless the endpoint explicitly declares it accepts that scope. Default-deny on unknown scopes prevents a setup token from being used as a regular access token.

**TOTP secret storage:** Encrypt with `crypto.encrypt()` before writing to DB. Decrypt with `crypto.decrypt()` when verifying. Do this in the router, not in the model.

### Care notes

- The setup token must expire in 10 minutes. If a user starts TOTP setup and doesn't finish, they must re-login.
- The setup and verify endpoints must be exempt from the regular CSRF check (no CSRF cookie exists at that point for a fresh setup flow). Mark them explicitly. Do not exempt the entire `/auth/` prefix — that would exempt logout too.
- After `totp_enabled` is set to `True`, the next login attempt must require the TOTP code. Do not issue an access token without it.
- Window ±1 is sufficient. Do not increase it — a wider window weakens the time-based protection.
- On mobile: the setup QR flow happens in a WebView or the user manually enters the key into their authenticator app. The API is the same; there is no mobile-specific code change needed.
- Test: enroll TOTP, then try to login without the code — expect 401. Login with the code — expect 200.

---

## Fix 6: PHI De-identification Before LLM

### What is wrong

DisGen sends raw patient data (name, DOB, UHID, diagnosis, medications) directly to OpenAI for extraction and summary generation. The `config.py` acknowledges this: `"NOT DPDP-compliant for a production Indian hospital"`. Even after switching to an in-India LLM provider, de-identification is a defense-in-depth layer that protects against LLM provider breaches or logging.

### What to implement

A two-layer de-identification pipeline applied to the OCR text **before** it is sent to the LLM for extraction. Structured fields extracted by the LLM will be placeholders; re-identification happens after the LLM returns its structured output.

**Layer 1 — Anchored (from the structured report):** If a structured report already exists for this document (edit/regenerate flow), use the confirmed patient fields to build an anchored replacement map. Replace patient name (all variants: Mr., Mrs., Dr., Shri, Smt.), UHID, DOB (multiple date formats), phone, address with `{{PATIENT_FULL_NAME}}`, `{{PATIENT_UHID}}`, etc. This is exact and never misfires.

**Layer 2 — Regex sweep:** Run regex patterns over the Layer 1 output for: Aadhaar (12-digit, with/without spaces), ABHA (14-digit XX-XXXX-XXXX-XXXX), PAN (AAAAA9999A), phone (10-digit Indian formats), email addresses, Indian pincodes, dates in 8 formats, address suffixes (Nagar, Colony, Street, Road, etc.). Apply spaCy NER (already present in `nlp/pipeline.py`) for any remaining PERSON entities not caught by Layer 1.

**Re-identification:** After the LLM returns the structured extraction, replace all placeholders back with real values before persisting the structured report. Sort replacements by placeholder length descending to prevent partial-key conflicts.

**Files to change:**
- `backend/nlp/deidentify.py` — new module: `deidentify(text, patient_fields)` → `(clean_text, replacements_map)`
- `backend/nlp/phi_filter.py` — new module: regex sweep + spaCy NER layer
- `backend/nlp/reidentify.py` — new module: `reidentify(text, replacements_map)` → restored text
- `backend/tasks/extract_tasks.py` — call deidentify before LLM extraction, reidentify after
- `backend/tasks/generate_tasks.py` — call deidentify on confirmed structured data before generation prompt, reidentify on LLM output before saving
- `backend/config.py` — add `PHI_LLM_PREPASS_ENABLED=false` (optional LLM sweep, off by default, requires in-India provider)

**Placeholder map:**
```python
PLACEHOLDERS = {
    "full_name":    "{{PATIENT_FULL_NAME}}",
    "uhid":         "{{PATIENT_UHID}}",
    "dob":          "{{PATIENT_DOB}}",
    "phone":        "{{PATIENT_PHONE}}",
    "address":      "{{PATIENT_ADDRESS}}",
    "aadhaar":      "{{PATIENT_AADHAAR}}",
    "abha_id":      "{{PATIENT_ABHA}}",
}
```

**DPDP health check:** Update the `/health` endpoint to report `dpdp_phi_deidentified: true` once this fix is deployed, separate from the LLM provider residency field.

### Care notes

- Layer 1 (anchored) runs only when patient fields are available. On a first-upload extraction, patient name may not yet be in the structured report. Layer 2 regex must catch it.
- The replacements map must be stored (encrypted) alongside the document record for the re-identification step. Add an `phi_map TEXT` column to `structured_reports` (encrypted, nullable). Migration: `0012_phi_map.py`.
- Medical terms (diagnoses, drug names, procedure names) must be explicitly excluded from the spaCy NER PERSON filter — "Metformin" and "Pancreatitis" will not be flagged as person names. Maintain an exclusion list in `nlp/phi_filter.py`.
- The re-identification step must happen BEFORE the structured report is written to the database. The DB must never store a de-identified structured report — only the encrypted phi_map for reconstruction.
- Switching the LLM to an in-India provider is not a substitute for de-identification — it just reduces one attack surface. Both are needed.

---

## Fix 7: Boot Guard Hardening

### What is wrong

`main.py` lifespan checks only 6 fields for the string `"changeme"`. It misses: JWT key paths (a committed test key would not be caught), OpenAI API key, and the patterns `"dummy"` and `"your-"` that appear in many example `.env` files.

### What to implement

Expand `_assert_secret()` to check multiple placeholder patterns. Add checks for JWT key file content (not just the path), and for the OpenAI/Azure keys.

```python
# backend/main.py — replace _assert_secret and extend the lifespan guard

_PLACEHOLDER_PATTERNS = re.compile(r"changeme|dummy|your[-_]|example|replace.?me", re.IGNORECASE)

def _assert_secret(value: str, name: str, hint: str = "") -> None:
    if not value or _PLACEHOLDER_PATTERNS.search(value):
        msg = f"[BOOT GUARD] {name} contains a placeholder value — set a real secret before deploying"
        if hint:
            msg += f" ({hint})"
        raise RuntimeError(msg)

# In lifespan(), add:
_assert_secret(settings.openai_api_key, "OPENAI_API_KEY") if settings.llm_provider == "openai" else None
_assert_secret(settings.azure_document_key, "AZURE_DOCUMENT_KEY")

# Verify the JWT key files contain actual PEM content, not placeholder text
for path_attr, label in [("jwt_private_key_path", "JWT_PRIVATE_KEY"), ("jwt_public_key_path", "JWT_PUBLIC_KEY")]:
    path = getattr(settings, path_attr)
    try:
        content = open(path).read()
        if "changeme" in content.lower() or "BEGIN RSA" not in content:
            raise RuntimeError(f"[BOOT GUARD] {label} at {path} does not look like a real RSA PEM key")
    except FileNotFoundError:
        raise RuntimeError(f"[BOOT GUARD] {label} file not found at {path}")
```

**Files to change:**
- `backend/main.py` — extend `_assert_secret`, add new checks in `lifespan()`
- `backend/config.py` — add `import re` if not present

### Care notes

- This fix is purely additive — no schema changes, no data migration.
- Do it in the same deployment as Fix 1 (image rebuild already required). Zero extra cost.
- The JWT key content check (`"BEGIN RSA" not in content`) is a basic sanity check, not a full key validation. It catches the common mistake of pointing at a placeholder file.

---

## Fix 8: Tenant Isolation Design

### Current state

DisGen is **single-tenant by design**: one deployment, one hospital, `hospital_id` is a static config value (`settings.hospital_id`). This is a deliberate and valid architecture for a hospital that wants its own isolated server.

However, the current code has no DB-level enforcement of tenant isolation — if a bug or injection somehow queries with the wrong `hospital_id`, Postgres will not stop it.

### Decision point: choose your deployment model

Before implementing Fix 8, you must decide which model this product will use.

---

### Option A — Stay single-tenant (recommended for v1)

**What it means:** Each hospital gets its own Docker stack on its own server (or VM). `hospital_id` remains a config value. No cross-hospital queries are possible by construction — different databases.

**What to add for safety:**
1. Add `hospital_id` to every request log entry (already in JWT payload).
2. In every router that reads documents, assert `document.hospital_id == settings.hospital_id` after fetch. Raise 403 if they differ — this is a canary, not expected to fire, but it catches bugs.
3. Add an integration test: create a document with `hospital_id = "other-hospital"`, assert that every document endpoint returns 404 or 403 for it.

**Operational model:**
- `scripts/install.sh` provisions one stack per hospital.
- Each hospital has its own `.env` with its own `HOSPITAL_ID`, `DATABASE_URL`, encryption key, JWT keypair.
- Hospitals cannot see each other's data because they are on different servers with different databases.

**This is the correct default.** It is simpler, easier to audit, and gives hospitals the strongest possible isolation guarantee. Most Indian hospitals will prefer this model.

---

### Option B — Multi-tenant on one server (future, if required)

**What it means:** Multiple hospitals share one database. Isolation is enforced by Postgres Row Level Security (RLS).

**If you take this path, implement the following exactly:**

**Step 1 — Create the app role:**
```sql
-- scripts/db/create-app-role.sql
CREATE ROLE disgen_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
GRANT CONNECT ON DATABASE disgen TO disgen_app;
GRANT USAGE ON SCHEMA public TO disgen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO disgen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO disgen_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM disgen_app;
-- NOBYPASSRLS is the critical flag — superusers bypass RLS silently
```

**Step 2 — Enable FORCE RLS on PHI tables:**
```sql
ALTER TABLE documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents      FORCE ROW LEVEL SECURITY;
ALTER TABLE structured_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE structured_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs     FORCE ROW LEVEL SECURITY;

CREATE POLICY documents_hospital_isolation ON documents
  USING (hospital_id = current_setting('app.hospital_id', true));

CREATE POLICY structured_reports_hospital_isolation ON structured_reports
  USING (
    document_id IN (
      SELECT id FROM documents WHERE hospital_id = current_setting('app.hospital_id', true)
    )
  );

CREATE POLICY audit_logs_hospital_isolation ON audit_logs
  USING (hospital_id = current_setting('app.hospital_id', true));
```

**Step 3 — Set the session variable before every query:**

Use a SQLAlchemy event listener or middleware that runs `SET LOCAL app.hospital_id = '<id>'` at the start of every request session. This is the same pattern Stobaeus Voice uses via its Prisma extension.

```python
# backend/database.py addition
from sqlalchemy import event

@event.listens_for(AsyncSession, "after_begin")
def set_hospital_context(session, transaction, connection):
    hospital_id = _hospital_id_context.get()  # contextvars.ContextVar
    if hospital_id:
        connection.exec_driver_sql(f"SET LOCAL app.hospital_id = '{hospital_id}'")
    elif _is_phi_operation(session):
        raise RuntimeError("PHI query attempted without hospital context — fail closed")
```

**Step 4 — Fail-closed guard:**
Any PHI model query without a hospital_id context set must raise immediately, before hitting the DB. This prevents a missing middleware or a forgotten context from silently returning cross-tenant data.

**Step 5 — Worker bypass:**
Celery tasks that operate across hospitals (retention, janitor) must use a bypass context. This requires connecting as the database **owner** role (not `disgen_app`). Wrap worker DB sessions with explicit bypass:
```python
# tasks connect as owner role with RLS bypass
BYPASS_DATABASE_URL = settings.owner_database_url  # separate env var
```

**When to choose Option B:**
- You want to serve multiple hospitals from one deployment for cost reasons.
- You have the ops capacity to manage a shared database with strict RLS.
- You have done a full security review of the RLS policies with a Postgres expert.

**When to stay with Option A:**
- You are launching v1.
- Your hospital customers prefer data sovereignty (their data on their server).
- You want the simplest possible audit story.

---

## Implementation Order

| Order | Fix | Blocking dependency | Estimated effort |
|---|---|---|---|
| 1 | Argon2id | None | 2 hours |
| 2 | Encryption key rotation | None | 4 hours |
| 3 | Audit hash chain + app role | Fix 2 (keyring needed for phi_map later) | 1 day |
| 4 | Refresh token DB + family ID | Fix 3 (app role created) | 6 hours |
| 5 | TOTP | Fix 2 (TOTP secret needs encrypt()) | 1 day |
| 6 | PHI de-identification | Fix 2 (phi_map needs encrypt()) | 2 days |
| 7 | Boot guard hardening | None — but do with Fix 1 deploy | 1 hour |
| 8 | Tenant isolation | Fix 3 (app role), all above done | Depends on Option A or B |

Run `pnpm ci` / `pytest` after each fix before merging. Fix 3 and Fix 6 are the highest-risk changes — test them against a staging database with a real dump before production.

---

## Testing Checklist per Fix

After each fix, the following must pass before the next fix begins.

**Fix 1:** `pytest tests/unit/test_auth_password.py` — add case: bcrypt hash → verify succeeds + needs_rehash True.

**Fix 2:** `pytest tests/unit/test_crypto.py` — add cases: v1 round-trip, legacy format still decrypts, wrong key raises TamperDetectedError, rotation: v1 ciphertext decrypts under KEYS_OLD after KEY_ID bumped to 2.

**Fix 3:** Integration test: insert 10 audit rows, manually UPDATE one row's `action`, run verifier, assert `ok: false`. Also: connect as `disgen_app`, attempt DELETE on `audit_logs`, assert permission denied.

**Fix 4:** Integration test: login → rotate token once → send original token again → assert family revoked, other logins unaffected.

**Fix 5:** Unit test: enroll TOTP, login without code → 401, login with code → 200. Setup token rejected on non-setup endpoints → 401.

**Fix 6:** Unit test: OCR text containing a patient name, UHID, and Aadhaar number passes through deidentify → assert none appear in output. Reidentify the output → assert all appear restored.

**Fix 7:** Start app with `FIELD_ENCRYPTION_KEY=changeme-...` → assert RuntimeError raised before first request is served.

---

*End of upgrade plan. When a fix is complete, mark it done in this document rather than deleting it — the implementation notes are valuable context for future developers.*
