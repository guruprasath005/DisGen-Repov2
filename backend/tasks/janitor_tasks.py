"""
Celery beat task: stuck-document janitor.

Scans the documents table every 10 minutes for records that have been in an
in-flight processing status longer than the configured timeout and transitions
them to 'failed'. This prevents documents from being permanently stuck when
a Celery worker crashes, a broker restart drops a message, or an external
service (Azure DI, Bedrock) hangs without returning.

Stuck thresholds:
  processing / ocr_complete / extracting  →  15 minutes  (OCR + extraction pipeline)
  generating                               →  10 minutes  (LLM generation)

These are generous: OCR typically completes in < 60 s, generation in < 120 s.
A document exceeding the threshold has almost certainly hit a permanent error.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from database import task_db
from models.document import Document
from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Status groups and their max allowed in-flight duration
_STUCK_THRESHOLDS: dict[frozenset, timedelta] = {
    frozenset({"processing", "ocr_complete", "extracting"}): timedelta(minutes=15),
    frozenset({"generating"}): timedelta(minutes=10),
}


@celery_app.task(
    name="tasks.janitor_tasks.cleanup_stuck_documents",
    bind=False,
    acks_late=True,
)
def cleanup_stuck_documents() -> dict:
    """
    Periodic beat task — flip stuck documents to 'failed'.
    Runs every 10 minutes via beat_schedule in celery_app.py.
    """
    return asyncio.run(_run())


async def _run() -> dict:
    now = datetime.now(timezone.utc)
    total_flipped = 0

    async with task_db() as make_session:
        for statuses, max_age in _STUCK_THRESHOLDS.items():
            cutoff = now - max_age
            stuck_statuses = list(statuses)

            async with make_session() as db:
                rows = (
                    await db.execute(
                        select(Document.id, Document.status, Document.created_at).where(
                            Document.status.in_(stuck_statuses),
                            Document.created_at < cutoff,
                            Document.deleted_at.is_(None),
                        )
                    )
                ).fetchall()

                if not rows:
                    continue

                ids = [r.id for r in rows]
                for row in rows:
                    age_minutes = (now - row.created_at.replace(tzinfo=timezone.utc)).total_seconds() / 60
                    logger.warning(
                        "Janitor: document %s stuck in status='%s' for %.1f min — marking failed",
                        row.id,
                        row.status,
                        age_minutes,
                    )

                await db.execute(
                    update(Document)
                    .where(Document.id.in_(ids))
                    .values(status="failed")
                )
                await db.commit()
                total_flipped += len(ids)

    if total_flipped:
        logger.info("Janitor: flipped %d stuck document(s) to 'failed'", total_flipped)
    else:
        logger.debug("Janitor: no stuck documents found")

    return {"flipped": total_flipped, "checked_at": now.isoformat()}
