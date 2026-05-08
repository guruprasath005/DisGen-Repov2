from celery import Celery

from config import settings

celery_app = Celery(
    "disgen",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    # Explicit imports so the worker process registers every task at startup.
    # Without this the `-A tasks.celery_app` worker would only load the Celery
    # instance — task modules are imported lazily by the API process but never
    # by the worker, leaving every `*.delay(...)` enqueued message unconsumed.
    imports=(
        "tasks.ocr_tasks",
        "tasks.extract_tasks",
        "tasks.generate_tasks",
        "tasks.retention_tasks",
        "tasks.janitor_tasks",
    ),
    task_routes={
        "tasks.ocr_tasks.*": {"queue": "ocr"},
        "tasks.extract_tasks.*": {"queue": "ocr"},          # extraction follows OCR in the same queue
        "tasks.generate_tasks.*": {"queue": "generate"},
        "tasks.retention_tasks.*": {"queue": "maintenance"},  # daily background jobs
        "tasks.janitor_tasks.*": {"queue": "maintenance"},
    },
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "enforce-retention-daily": {
            "task": "tasks.retention_tasks.enforce_retention",
            "schedule": 86400.0,  # every 24 hours
        },
        "unstick-documents-every-10m": {
            "task": "tasks.janitor_tasks.unstick_documents",
            "schedule": 600.0,  # every 10 minutes
        },
    },
)
