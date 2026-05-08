"""
Celery Beat task: daily DPDP retention enforcement.

Scheduled in celery_app.py to run every 24 hours. Delegates all logic to
compliance/retention.py so the task file stays thin and the business logic
is independently testable.

Routing: maintenance queue (worker must subscribe with -Q ocr,generate,maintenance).
"""

from __future__ import annotations

import asyncio
import logging

from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="tasks.retention_tasks.enforce_retention",
    acks_late=True,
    reject_on_worker_lost=True,
)
def enforce_retention() -> dict:
    """
    Run one retention enforcement cycle synchronously inside a fresh event loop.

    Returns a stats dict: {examined, anonymized, deleted, errors}.
    Exceptions are caught inside enforce_retention_policy() per document;
    any unhandled exception here is captured by GlitchTip via sentry-sdk.
    """
    from compliance.retention import enforce_retention_policy  # noqa: PLC0415

    logger.info("Retention task started")
    stats = asyncio.run(enforce_retention_policy())
    logger.info("Retention task finished: %s", stats)
    return stats
