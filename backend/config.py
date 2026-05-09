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

    # ── OpenAI (LLM — development use) ───────────────────────────────────────
    # For production hospital deployment replace with AWS Bedrock (ap-south-1)
    # to restore DPDP data-residency compliance (data must stay in India).
    openai_api_key: str = ""
    openai_model_id: str = "gpt-4o-mini"

    # ── Field Encryption (AES-256-GCM) ────────────────────────────────────────
    # Must be exactly 32 bytes, base64-encoded. Generate: openssl rand -base64 32
    field_encryption_key: str = "changeme-must-be-32-bytes-base64="

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
