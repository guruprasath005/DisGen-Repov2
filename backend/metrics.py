"""
Prometheus metrics for DisGen.

Import from this module wherever instrumentation is needed. A single module
prevents duplicate registration errors across multiple imports.

Multiprocess setup: PROMETHEUS_MULTIPROC_DIR must be in the process environment
before Python starts (set via docker-compose environment:). The API's /metrics
endpoint uses MultiProcessCollector to aggregate files written by both the
FastAPI process and any Celery worker processes.
"""

from prometheus_client import Counter, Gauge, Histogram

disgen_upload_total = Counter(
    "disgen_upload_total",
    "Total documents successfully uploaded",
)

disgen_ocr_duration_seconds = Histogram(
    "disgen_ocr_duration_seconds",
    "AWS Textract OCR time (seconds)",
    buckets=[5, 10, 20, 30, 60, 90, 120, 180, 300],
)

disgen_llm_extraction_duration_seconds = Histogram(
    "disgen_llm_extraction_duration_seconds",
    "LLM structured-data extraction time (seconds)",
    buckets=[5, 10, 20, 30, 60, 90, 120],
)

disgen_generation_duration_seconds = Histogram(
    "disgen_generation_duration_seconds",
    "Discharge summary generation time (seconds)",
    buckets=[5, 10, 20, 30, 60, 90, 120],
)

disgen_ocr_confidence = Histogram(
    "disgen_ocr_confidence",
    "AWS Textract OCR confidence score (0–1)",
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
)

disgen_document_status_total = Counter(
    "disgen_document_status_total",
    "Cumulative documents reaching each workflow status",
    ["status"],
)

disgen_auth_failures_total = Counter(
    "disgen_auth_failures_total",
    "Total failed login attempts",
)

# livesum: only the API process ever writes this gauge, so summing live
# processes gives the correct current count. Resets to 0 on API restart.
disgen_active_sessions = Gauge(
    "disgen_active_sessions",
    "Active user sessions (refresh tokens currently in Redis)",
    multiprocess_mode="livesum",
)

# livesum: set by the admin health endpoint on each check call.
disgen_celery_workers = Gauge(
    "disgen_celery_workers",
    "Online Celery workers (as of last /admin/health call)",
    multiprocess_mode="livesum",
)

disgen_errors_total = Counter(
    "disgen_errors_total",
    "Unhandled exceptions captured by error tracking (GlitchTip)",
)

disgen_chromadb_failures_total = Counter(
    "disgen_chromadb_failures_total",
    "ChromaDB RAG retrieval failures by scheme",
    ["scheme_id"],
)

disgen_stuck_documents_total = Counter(
    "disgen_stuck_documents_total",
    "Documents flipped to failed by the stuck-job janitor",
)
