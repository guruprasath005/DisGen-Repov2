"""
Celery task: LLM extraction + ICD-10 mapping + drug normalization.

Runs after OCR completes (enqueued by ocr_tasks.process_document).

Flow:
  1. Fetch Document — verify status is ocr_complete
  2. Decrypt and deserialize the encrypted OCR payload
  3. Set document status → extracting
  4. Call LLM extractor (configured LLM provider) + NLP/regex fallback merge
  5. Map raw diagnoses → ICD-10 codes via pg_trgm
  6. Normalize drug names via pg_trgm
  7. Encrypt final StructuredData → upsert into structured_reports
  8. Set document status → ready
  9. Write EXTRACT_COMPLETE audit log

The LLM call (step 4) is synchronous (provider SDK). It runs inside asyncio.run()
the same way as the OCR task — safe under Celery prefork concurrency.

Retry policy: 2 retries for transient errors (LLM 5xx, DB unavailable).
Extraction failure is more recoverable than OCR failure — the doctor can
manually fill in all fields — so we always end in `ready` status even with
partial/empty data, rather than blocking the workflow.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from celery import Task
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy import select

from crypto import decrypt, encrypt
from database import task_db
from metrics import disgen_document_status_total, disgen_llm_extraction_duration_seconds
from llm.extractor import (
    StructuredData,
    extract_structured,
    map_drug_names,
    map_icd10_codes,
)
from models.audit import AuditLog
from models.document import Document
from models.structured_report import StructuredReport
from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="tasks.extract_tasks.extract_structured_data",
    bind=True,
    max_retries=2,
    default_retry_delay=45,
    acks_late=True,
    reject_on_worker_lost=True,
)
def extract_structured_data(self: Task, document_id: str) -> dict:
    """
    LLM extraction pipeline entry point — synchronous Celery task.
    Delegates to async pipeline via asyncio.run().
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
                logger.error("Extract task: document %s not found", document_id)
                return {"status": "not_found", "document_id": document_id}

            if doc.deleted_at is not None:
                logger.warning("Extract task: document %s is soft-deleted — skipping", document_id)
                return {"status": "deleted", "document_id": document_id}

            # Idempotency: already past extraction
            if doc.status not in ("ocr_complete", "extracting"):
                logger.info(
                    "Extract task: document %s already in status=%s — skipping",
                    document_id, doc.status,
                )
                return {"status": "already_processed", "document_id": document_id}

            if not doc.ocr_text:
                logger.error("Extract task: document %s has no OCR text", document_id)
                return {"status": "no_ocr_text", "document_id": document_id}

            encrypted_ocr: str = doc.ocr_text
            uploaded_by: uuid.UUID = doc.uploaded_by

        # ── 2. Decrypt OCR payload ─────────────────────────────────────────────
        try:
            ocr_data: dict = json.loads(decrypt(encrypted_ocr))
        except Exception as exc:
            logger.error("Extract task: OCR decrypt failed for %s: %s", document_id, exc)
            await _store_empty_and_ready(doc_uuid, uploaded_by, f"OCR decrypt error: {exc}", make_session)
            return {"status": "decrypt_error", "document_id": document_id}

        # ── 3. Set status → extracting ─────────────────────────────────────────
        async with make_session() as db:
            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one()
            doc.status = "extracting"
            await db.commit()

        # ── 4. LLM extraction + NLP fallback (synchronous, may take 10–60 s) ──
        # Run in a thread so the event loop remains free for any concurrent DB work.
        try:
            _extract_start = time.monotonic()
            structured: StructuredData = await asyncio.to_thread(
                extract_structured, ocr_data
            )
            disgen_llm_extraction_duration_seconds.observe(time.monotonic() - _extract_start)
        except Exception as exc:
            logger.error("Extract task: extraction raised unexpectedly for %s: %s", document_id, exc)
            try:
                raise task.retry(exc=exc, countdown=45)
            except MaxRetriesExceededError:
                await _store_empty_and_ready(doc_uuid, uploaded_by, f"Extraction error: {exc}", make_session)
                return {"status": "extraction_error", "document_id": document_id}

        # ── 5–6. ICD-10 + drug mapping (requires DB) ───────────────────────────
        async with make_session() as db:
            (
                icd10_primary,
                icd10_primary_candidates,
                icd10_secondary,
                icd10_secondary_candidates,
            ) = await map_icd10_codes(
                structured.primary_diagnosis,
                structured.secondary_diagnoses,
                db,
            )

            mapped_stay_meds = await map_drug_names(
                structured.medications_during_stay, db
            )
            mapped_discharge_meds = await map_drug_names(
                structured.discharge_medications, db
            )

        # Patch ICD-10 and drug results into the structured data object
        structured.icd10_primary = icd10_primary
        structured.icd10_primary_candidates = icd10_primary_candidates
        structured.icd10_secondary = icd10_secondary
        structured.icd10_secondary_candidates = icd10_secondary_candidates
        structured.medications_during_stay = mapped_stay_meds
        structured.discharge_medications = mapped_discharge_meds

        # ── 7–9. Persist, update status, audit ────────────────────────────────
        encrypted_data = encrypt(json.dumps(structured.to_dict(), ensure_ascii=False))

        async with make_session() as db:
            # Upsert structured report (unique constraint on document_id)
            existing = (
                await db.execute(
                    select(StructuredReport).where(StructuredReport.document_id == doc_uuid)
                )
            ).scalar_one_or_none()

            if existing:
                existing.data = encrypted_data
                existing.version += 1
            else:
                db.add(
                    StructuredReport(
                        document_id=doc_uuid,
                        data=encrypted_data,
                        data_confirmed=False,
                        excluded_fields=[],
                        version=1,
                    )
                )

            # Update document status → ready
            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one()
            doc.status = "ready"
            disgen_document_status_total.labels(status="ready").inc()

            # Audit entry
            db.add(
                AuditLog(
                    user_id=uploaded_by,
                    username="system",
                    role="system",
                    action="EXTRACT_COMPLETE",
                    document_id=doc_uuid,
                    ip_address="127.0.0.1",
                    details={
                        "extraction_source": structured.extraction_source,
                        "icd10_primary_auto": icd10_primary is not None,
                        "icd10_primary_candidates": len(icd10_primary_candidates),
                        "icd10_secondary_count": len(icd10_secondary),
                        "medications_normalized": sum(
                            1 for m in mapped_discharge_meds if m.get("normalized")
                        ),
                        "investigations_count": len(structured.investigations),
                    },
                )
            )
            await db.commit()

    logger.info(
        "Extract complete document=%s source=%s icd10_auto=%s",
        document_id,
        structured.extraction_source,
        icd10_primary is not None,
    )

    return {
        "document_id": document_id,
        "status": "ready",
        "extraction_source": structured.extraction_source,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _store_empty_and_ready(
    doc_uuid: uuid.UUID,
    uploaded_by: uuid.UUID,
    reason: str,
    make_session,
) -> None:
    """
    Store an empty StructuredData and mark the document ready so the doctor
    can enter data manually. Used when extraction is unrecoverable.
    """
    logger.warning(
        "Extract task: storing empty structured data for %s — reason: %s",
        doc_uuid, reason,
    )
    empty = StructuredData(extraction_source="failed")
    encrypted_data = encrypt(json.dumps(empty.to_dict(), ensure_ascii=False))

    try:
        async with make_session() as db:
            existing = (
                await db.execute(
                    select(StructuredReport).where(StructuredReport.document_id == doc_uuid)
                )
            ).scalar_one_or_none()

            if existing:
                existing.data = encrypted_data
                existing.version += 1
            else:
                db.add(
                    StructuredReport(
                        document_id=doc_uuid,
                        data=encrypted_data,
                        data_confirmed=False,
                        excluded_fields=[],
                        version=1,
                    )
                )

            row = await db.execute(select(Document).where(Document.id == doc_uuid))
            doc = row.scalar_one_or_none()
            if doc:
                doc.status = "ready"

            db.add(
                AuditLog(
                    user_id=uploaded_by,
                    username="system",
                    role="system",
                    action="EXTRACT_COMPLETE",
                    document_id=doc_uuid,
                    ip_address="127.0.0.1",
                    details={"extraction_source": "failed", "reason": reason},
                )
            )
            await db.commit()
    except Exception as db_exc:
        logger.error(
            "Extract task: failed to store empty report for %s: %s", doc_uuid, db_exc
        )
