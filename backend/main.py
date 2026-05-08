import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from logging_config import PHIScrubFilter, setup_logging
from middleware.csrf import CSRFMiddleware
from middleware.idempotency import IdempotencyMiddleware
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.field_encryption_key.startswith("changeme"):
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is still the placeholder default — "
            "set a real 32-byte base64 key before starting in production"
        )

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
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token", "Idempotency-Key"],
)
app.add_middleware(CSRFMiddleware)
app.add_middleware(IdempotencyMiddleware)

# Prometheus — internal only (nginx does not expose /metrics externally)
app.mount("/metrics", _make_metrics_app())

app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(schemes_router)
app.include_router(admin_router)
app.include_router(superadmin_router)


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
    return {"service": "DisGen API", "docs": "/docs"}
