from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "postgresql://disgen:changeme@postgres:5432/disgen"
    database_test_url: str = "postgresql://disgen:changeme@postgres:5432/disgen_test"

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_url: str = "redis://:changeme@redis:6379/0"
    redis_password: str = "changeme"

    # ── MinIO ─────────────────────────────────────────────────────────────────
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "changeme"
    minio_secret_key: str = "changeme"
    minio_bucket: str = "disgen-documents"

    # ── Azure Document Intelligence (OCR — Central India, Pune) ─────────────
    # DPDP compliant — data stays in India.
    # Handles degraded photocopies, handwriting, and mixed-format hospital forms.
    azure_document_endpoint: str = ""
    azure_document_key: str = ""

    # ── LLM provider ─────────────────────────────────────────────────────────
    # Pluggable via llm/provider.py. "openai" processes prompts (patient PHI)
    # in the US — NOT DPDP-compliant for a production Indian hospital. The
    # hospital has agreed to switch to an in-India provider post-approval;
    # that switch is just LLM_PROVIDER + a provider class, no rewrite.
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_model_id: str = "gpt-4o"

    # Per-chunk source-token budget for long-document extraction. Smaller =
    # safer against the 16K output cap (no silent JSON truncation on 10–20
    # page K-shapes); larger = fewer LLM calls. 6000 keeps output well clear
    # of the cap with margin for lab-heavy documents.
    extraction_chunk_token_budget: int = 6000

    # ── Field Encryption (AES-256-GCM) ────────────────────────────────────────
    # Must be exactly 32 bytes, base64-encoded. Generate: openssl rand -base64 32
    field_encryption_key: str = "changeme-must-be-32-bytes-base64="
    # Key versioning for rotation. Increment KEY_ID and move old key to KEYS_OLD.
    field_encryption_key_id: str = "1"
    field_encryption_keys_old: str = "{}"  # JSON: {"<old_id>": "<old_b64_key>"}

    # ── Auth JWT ──────────────────────────────────────────────────────────────
    jwt_private_key_path: str = "/app/auth/keys/private.pem"
    jwt_public_key_path: str = "/app/auth/keys/public.pem"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7
    cookie_secure: bool = True  # set False in dev (.env: COOKIE_SECURE=false)

    # ── CORS ──────────────────────────────────────────────────────────────────
    cors_origins: str = "https://localhost"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    # ── Hospital ──────────────────────────────────────────────────────────────
    hospital_name: str = "Hospital"
    hospital_id: str = "hospital-001"

    # ── API Docs ──────────────────────────────────────────────────────────────
    # Disabled by default. Set DOCS_ENABLED=true + strong credentials in staging.
    # Never enable in production — /docs exposes the full API surface.
    docs_enabled: bool = False
    docs_username: str = "disgen-dev"
    docs_password: str = "changeme-docs"

    # ── GlitchTip / Sentry error tracking ────────────────────────────────────
    glitchtip_dsn: str = ""

    # ── ChromaDB ─────────────────────────────────────────────────────────────
    chroma_host: str = "chromadb"
    chroma_port: int = 8000

    # ── Celery ────────────────────────────────────────────────────────────────
    celery_broker_url: str = "redis://:changeme@redis:6379/1"
    celery_result_backend: str = "redis://:changeme@redis:6379/2"

    # ── TOTP / MFA ────────────────────────────────────────────────────────────
    admin_require_totp: bool = True
    doctor_require_totp: bool = False

    # ── PHI De-identification ─────────────────────────────────────────────────
    phi_llm_prepass_enabled: bool = False  # optional LLM sweep, requires in-India provider

    # ── DPDP / Compliance ─────────────────────────────────────────────────────
    data_retention_days: int = 2555
    anonymize_on_expiry: bool = True

    # ── Derived helpers ───────────────────────────────────────────────────────
    @property
    def async_database_url(self) -> str:
        return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    @property
    def async_test_database_url(self) -> str:
        return self.database_test_url.replace("postgresql://", "postgresql+asyncpg://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Module-level singleton — import as `from config import settings`
settings = get_settings()
