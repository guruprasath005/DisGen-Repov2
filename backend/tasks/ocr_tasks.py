"""
Celery task: OCR pipeline for a single document.

Flow:
  1. Fetch Document row from DB
  2. Download file bytes from MinIO
  3. Send to Azure Document Intelligence (Central India, Pune)
     - Handles both images and PDFs natively — no temporary S3 upload needed
     - Uses prebuilt-layout model with KEY_VALUE_PAIRS feature
  4. Encrypt OCR payload and persist to Document row
  5. Write OCR_COMPLETE audit entry
  6. Enqueue LLM extraction task

Retry policy: up to 3 retries on transient errors (MinIO unavailable, Azure 5xx).
The document status stays "processing" during retries and transitions to
"ocr_failed" only when all retries are exhausted.

acks_late=True: the task message is acknowledged only after the function returns
(or raises permanently), so a worker crash during OCR will not silently lose the job.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
import time

from celery import Task
from celery.exceptions import MaxRetriesExceededError
from minio.error import S3Error
from sqlalchemy import select

from audit import create_audit_log
from config import settings
from crypto import encrypt
from database import task_db
from metrics import disgen_document_status_total, disgen_ocr_confidence, disgen_ocr_duration_seconds
from storage.minio_client import get_minio
from models.audit import AuditLog
from models.document import Document
from ocr.azure_document import AzureDocumentClient, OCRFailedError, OCRResult
from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# ── Content-type helper ────────────────────────────────────────────────────────

_EXT_TO_CONTENT_TYPE: dict[str, str] = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def _content_type(filename: str) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _EXT_TO_CONTENT_TYPE.get(f".{suffix}", "application/octet-stream")


# ── Celery task ────────────────────────────────────────────────────────────────


@celery_app.task(
    name="tasks.ocr_tasks.process_document",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_document(self: Task, document_id: str) -> dict:
    """
    OCR pipeline entry point — synchronous Celery task.

    asyncio.run() creates a fresh event loop for each task invocation.
    Safe under prefork concurrency (each worker process is single-threaded).
    """
    return asyncio.run(_pipeline(self, document_id))


# ── Pipeline ───────────────────────────────────────────────────────────────────


async def _pipeline(task: Task, document_id: str) -> dict:
    doc_uuid = uuid.UUID(document_id)

    async with task_db() as make_session:
        # ── 1. Fetch document ──────────────────────────────────────────────────
        async with make_session() as db:
            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one_or_none()

            if doc is None:
                logger.error("OCR task: document %s not found in DB", document_id)
                return {"status": "not_found", "document_id": document_id}

            if doc.deleted_at is not None:
                logger.warning("OCR task: document %s is soft-deleted — skipping", document_id)
                return {"status": "deleted", "document_id": document_id}

            # Idempotency: if a previous task run already completed OCR, do not
            # re-process. This can happen when acks_late causes a redelivery after
            # the worker committed but before the ack was sent.
            if doc.status not in ("processing", "ocr_failed"):
                logger.info(
                    "OCR task: document %s already in status=%s — skipping",
                    document_id,
                    doc.status,
                )
                return {"status": "already_processed", "document_id": document_id}

            minio_key: str = doc.minio_key
            filename: str = doc.filename
            uploaded_by: uuid.UUID = doc.uploaded_by

        # ── 2. Download from MinIO ─────────────────────────────────────────────
        file_bytes = await _download_file(task, doc_uuid, minio_key, make_session)

        # ── 3. Azure Document Intelligence OCR ────────────────────────────────
        _ocr_start = time.monotonic()
        ocr_result = await _run_ocr(task, doc_uuid, file_bytes, filename, make_session)
        disgen_ocr_duration_seconds.observe(time.monotonic() - _ocr_start)
        disgen_ocr_confidence.observe(ocr_result.confidence)

        # ── 4. Encrypt OCR payload and persist ────────────────────────────────
        ocr_payload = json.dumps(
            {
                "full_text": ocr_result.full_text,
                "tables": ocr_result.tables,
                "key_values": ocr_result.key_values,
                "sections": ocr_result.sections,
                "confidence": ocr_result.confidence,
                "pages": ocr_result.pages,
            },
            ensure_ascii=False,
        )
        encrypted_ocr = encrypt(ocr_payload)

        async with make_session() as db:
            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one()

            doc.ocr_text = encrypted_ocr
            doc.pages = ocr_result.pages
            doc.ocr_confidence = ocr_result.confidence
            doc.status = "ocr_complete"
            disgen_document_status_total.labels(status="ocr_complete").inc()

            # ── 5. Audit entry ─────────────────────────────────────────────────
            await create_audit_log(
                db,
                user_id=uploaded_by,
                username="system",
                role="system",
                action="OCR_COMPLETE",
                document_id=doc_uuid,
                ip_address="127.0.0.1",
                details={
                    "pages": ocr_result.pages,
                    "confidence": ocr_result.confidence,
                    "tables_extracted": len(ocr_result.tables),
                    "key_values_extracted": len(ocr_result.key_values),
                    "sections_extracted": len(ocr_result.sections),
                },
            )
            await db.commit()

    logger.info(
        "OCR complete document=%s pages=%d confidence=%.3f tables=%d",
        document_id,
        ocr_result.pages,
        ocr_result.confidence,
        len(ocr_result.tables),
    )

    # ── 6. Enqueue LLM extraction ──────────────────────────────────────────────
    from tasks.extract_tasks import extract_structured_data  # noqa: PLC0415

    extract_structured_data.delay(document_id)
    logger.info("Enqueued LLM extraction for document=%s", document_id)

    return {
        "document_id": document_id,
        "pages": ocr_result.pages,
        "confidence": ocr_result.confidence,
        "status": "ocr_complete",
    }


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _download_file(
    task: Task,
    doc_uuid: uuid.UUID,
    minio_key: str,
    make_session,
) -> bytes:
    """Download file from MinIO. Retries on S3Error; marks failed on exhaustion."""
    try:
        response = get_minio().get_object(settings.minio_bucket, minio_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    except S3Error as exc:
        logger.error("OCR MinIO download failed key=%s error=%s", minio_key, exc)
        try:
            raise task.retry(exc=exc, countdown=30)
        except MaxRetriesExceededError:
            await _mark_failed(doc_uuid, f"MinIO download failed after {task.max_retries} retries", make_session)
            raise


async def _run_ocr(
    task: Task,
    doc_uuid: uuid.UUID,
    file_bytes: bytes,
    filename: str,
    make_session,
) -> OCRResult:
    """Call Azure Document Intelligence. Retries on transient errors; marks failed on exhaustion."""
    try:
        ct = _content_type(filename)
        return AzureDocumentClient.get_instance().analyze_document(file_bytes, ct)
    except OCRFailedError as exc:
        logger.error("OCR Azure Document Intelligence failed document=%s error=%s", doc_uuid, exc)
        try:
            raise task.retry(exc=exc, countdown=60)
        except MaxRetriesExceededError:
            await _mark_failed(doc_uuid, f"Azure OCR failed after {task.max_retries} retries: {exc}", make_session)
            raise


async def _mark_failed(doc_uuid: uuid.UUID, reason: str, make_session) -> None:
    """Set document status to ocr_failed and log the reason."""
    logger.error("OCR permanently failed document=%s reason=%s", doc_uuid, reason)
    try:
        async with make_session() as db:
            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one_or_none()
            if doc is not None:
                doc.status = "ocr_failed"
                disgen_document_status_total.labels(status="ocr_failed").inc()
                await db.commit()
    except Exception as db_exc:
        # Never let a DB failure inside error handling mask the original error.
        logger.error("Failed to write ocr_failed status for %s: %s", doc_uuid, db_exc)
