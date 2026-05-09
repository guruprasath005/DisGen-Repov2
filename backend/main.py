import logging
import os
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from config import settings
from logging_config import PHIScrubFilter, setup_logging
from middleware.csrf import CSRFMiddleware
from middleware.idempotency import IdempotencyMiddleware
from middleware.rate_limit import GlobalRateLimitMiddleware
# SecurityHeadersMiddleware is intentionally omitted — nginx already injects
# HSTS, CSP, X-Frame-Options etc. Adding them again at the app layer would
# duplicate headers. The middleware file is kept for deployments without nginx.
from auth.router import router as auth_router
from routers.admin import router as admin_router
from routers.documents import router as documents_router
from routers.schemes import router as schemes_router
from routers.superadmin import router as superadmin_router

# Install PHI scrubbing on all loggers before anything else logs
setup_logging()

logger = logging.getLogger(__name__)

_phi_scrubber = PHIScrubFilter()


def _scrub_sentry_event(event: dict, hint: dict) -> dict | None:
    """Strip PHI from GlitchTip error events before they leave the process."""
    req = event.get("request", {})
    body = req.get("data", "")
    if isinstance(body, str):
        req["data"] = _phi_scrubber._scrub(body)
    for k, v in list(event.get("extra", {}).items()):
        if isinstance(v, str):
            event["extra"][k] = _phi_scrubber._scrub(v)

    from metrics import disgen_errors_total
    disgen_errors_total.inc()
    return event


if settings.glitchtip_dsn:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=settings.glitchtip_dsn,
            integrations=[StarletteIntegration(), FastApiIntegration()],
            traces_sample_rate=0.0,
            before_send=_scrub_sentry_event,
        )
        logger.info("GlitchTip error tracking active")
    except Exception:
        logger.exception("GlitchTip initialisation failed — error tracking disabled")


def _make_metrics_app():
    """Return a Prometheus ASGI app, multiprocess-aware when the env var is set."""
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        from prometheus_client import CollectorRegistry, make_asgi_app
        from prometheus_client.multiprocess import MultiProcessCollector

        registry = CollectorRegistry()
        MultiProcessCollector(registry)
        return make_asgi_app(registry=registry)
    from prometheus_client import make_asgi_app

    return make_asgi_app()


def _assert_secret(value: str, name: str, hint: str = "") -> None:
    if "changeme" in value.lower():
        msg = f"{name} is still the placeholder default — set a real value before deploying"
        if hint:
            msg += f" ({hint})"
        raise RuntimeError(msg)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Secrets guard — refuse to boot with any placeholder credential ────────
    _assert_secret(settings.field_encryption_key, "FIELD_ENCRYPTION_KEY", "openssl rand -base64 32")
    _assert_secret(settings.database_url, "DATABASE_URL")
    _assert_secret(settings.redis_password, "REDIS_PASSWORD")
    _assert_secret(settings.minio_secret_key, "MINIO_SECRET_KEY")
    _assert_secret(settings.minio_access_key, "MINIO_ACCESS_KEY")
    _assert_secret(settings.celery_broker_url, "CELERY_BROKER_URL")

    # Seed built-in scheme RAG collections in ChromaDB. Idempotent — skips
    # any collection that already has documents. Wrapped in try/except so a
    # ChromaDB outage does not block API startup; generation will fall back
    # to no-RAG behaviour (logged warning) until ChromaDB recovers.
    try:
        from rag.chromadb import seed_all_builtin_schemes

        seed_all_builtin_schemes()
    except Exception:
        logger.exception("ChromaDB seeding failed at startup — RAG will degrade until reachable")

    yield


app = FastAPI(
    title="DisGen API",
    version="2.0.0",
    description="Clinical Discharge Summary Generation System",
    # Always disable the auto-generated docs routes — we serve them
    # manually below so we can gate them behind HTTP Basic Auth.
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token", "Idempotency-Key"],
)
app.add_middleware(GlobalRateLimitMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(IdempotencyMiddleware)

# Prometheus — internal only (nginx does not expose /metrics externally)
app.mount("/metrics", _make_metrics_app())

app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(schemes_router)
app.include_router(admin_router)
app.include_router(superadmin_router)


if settings.docs_enabled:
    _basic = HTTPBasic()

    def _verify_docs(credentials: HTTPBasicCredentials = Depends(_basic)) -> None:
        ok_user = secrets.compare_digest(credentials.username, settings.docs_username)
        ok_pass = secrets.compare_digest(credentials.password, settings.docs_password)
        if not (ok_user and ok_pass):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
                headers={"WWW-Authenticate": "Basic"},
            )

    @app.get("/docs", include_in_schema=False)
    async def swagger_ui(_: None = Depends(_verify_docs)):
        return get_swagger_ui_html(openapi_url="/openapi.json", title="DisGen API")

    @app.get("/redoc", include_in_schema=False)
    async def redoc_ui(_: None = Depends(_verify_docs)):
        return get_redoc_html(openapi_url="/openapi.json", title="DisGen API")

    @app.get("/openapi.json", include_in_schema=False)
    async def openapi_schema(_: None = Depends(_verify_docs)):
        return app.openapi()

    _assert_secret(settings.docs_password, "DOCS_PASSWORD")
    logger.warning("API docs enabled — ensure DOCS_USERNAME/DOCS_PASSWORD are set to strong credentials")


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", os.urandom(8).hex())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health", tags=["System"])
def health():
    return {"status": "ok"}


@app.get("/", tags=["System"])
def root():
    return {"service": "DisGen API"}
