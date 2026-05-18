"""
Celery task: discharge summary generation (field-based workflow).

Pipeline
────────
  1. Fetch Document + StructuredReport + Scheme (with FK guards)
  2. Verify data_confirmed = True — abort with audit if not
  3. Decrypt structured data (AES-256-GCM)
  4. Call llm.generator.generate_scheme_fields() → {field_name: value | null}
  5. Validate with llm.validator.validate_fields()
  6. Retire previous active summary (set is_active=False, superseded_by_id)
  7. Persist new GeneratedSummary with summary_fields (is_active=True)
     Status is always 'draft' — doctor fills any null fields via PATCH.
  8. Update Document status: 'generated'
  9. Audit log: GENERATE | GENERATE_FAILED

Same retry / acks_late semantics as the OCR pipeline.
asyncio.run() wraps the async pipeline inside the sync Celery task.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

from celery import Task
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from crypto import decrypt, encrypt
from database import task_db
from llm.generator import generate_scheme_fields as llm_generate_scheme_fields
from llm.validator import validate_fields
from audit import create_audit_log
from models.audit import AuditLog
from models.document import Document
from models.scheme import GeneratedSummary, Scheme
from models.structured_report import StructuredReport
from metrics import (
    disgen_document_status_total,
    disgen_generation_duration_seconds,
)
from nlp.reidentify import reidentify
from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="tasks.generate_tasks.generate_summary",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
    reject_on_worker_lost=True,
)
def generate_summary(self: Task, document_id: str, scheme_id: str, user_id: str) -> dict:
    """Synchronous Celery entry point — delegates to the async pipeline."""
    return asyncio.run(_pipeline(self, document_id, scheme_id, user_id))


# ── Pipeline ──────────────────────────────────────────────────────────────────


async def _pipeline(
    task: Task,
    document_id: str,
    scheme_id: str,
    user_id: str,
) -> dict:
    doc_uuid = uuid.UUID(document_id)
    user_uuid = uuid.UUID(user_id)

    async with task_db() as make_session:
        # ── 1–3. Fetch + verify + decrypt ─────────────────────────────────────
        async with make_session() as db:
            doc = (
                await db.execute(select(Document).where(Document.id == doc_uuid))
            ).scalar_one_or_none()
            if doc is None or doc.deleted_at is not None:
                logger.warning(
                    "Generate task: document %s not found or deleted", document_id
                )
                return {"status": "not_found", "document_id": document_id}

            report = (
                await db.execute(
                    select(StructuredReport).where(
                        StructuredReport.document_id == doc_uuid
                    )
                )
            ).scalar_one_or_none()
            if report is None:
                logger.error(
                    "Generate task: no structured report for %s", document_id
                )
                await _write_failure_audit(
                    db, doc_uuid, user_uuid, scheme_id, "no_structured_report"
                )
                await db.commit()
                return {"status": "no_structured_report", "document_id": document_id}

            if not report.data_confirmed:
                logger.error(
                    "Generate task: data not confirmed for %s — aborting", document_id
                )
                await _write_failure_audit(
                    db, doc_uuid, user_uuid, scheme_id, "data_not_confirmed"
                )
                await db.commit()
                return {"status": "not_confirmed", "document_id": document_id}

            scheme = (
                await db.execute(select(Scheme).where(Scheme.id == scheme_id))
            ).scalar_one_or_none()
            if scheme is None:
                logger.error("Generate task: unknown scheme=%s", scheme_id)
                await _write_failure_audit(
                    db, doc_uuid, user_uuid, scheme_id, "scheme_not_found"
                )
                await db.commit()
                return {
                    "status": "scheme_not_found",
                    "document_id": document_id,
                    "scheme_id": scheme_id,
                }

            # Snapshot fields needed outside the session
            encrypted_data: str = report.data
            encrypted_phi_map: str | None = report.phi_map
            scheme_name: str = scheme.name
            scheme_required_fields: list = list(scheme.required_fields or [])
            scheme_optional_fields: list = list(scheme.optional_fields or [])

            if doc.status not in ("generating",):
                doc.status = "generating"
            await db.commit()

        structured_data: dict = json.loads(decrypt(encrypted_data))

        # ── 3b. De-identify before LLM call ───────────────────────────────────
        # Reuse the phi_map built during extraction. We serialize the structured
        # dict, swap real PHI values for their placeholders, then send the
        # de-identified dict to the LLM. After the LLM returns, we re-identify
        # before persisting so the DB still stores real patient data.
        phi_map: dict[str, str] = {}
        if encrypted_phi_map:
            try:
                phi_map = json.loads(decrypt(encrypted_phi_map))
            except Exception as exc:
                logger.warning(
                    "Generate task: phi_map decrypt failed for %s — proceeding "
                    "without de-identification: %s", document_id, exc,
                )
                phi_map = {}

        if phi_map:
            data_json = json.dumps(structured_data, ensure_ascii=False)
            # Replace longer values first to avoid partial-substring conflicts
            for placeholder in sorted(phi_map, key=lambda k: len(phi_map[k]), reverse=True):
                value = phi_map[placeholder]
                if value:
                    data_json = data_json.replace(value, placeholder)
            structured_data_clean = json.loads(data_json)
        else:
            structured_data_clean = structured_data

        # ── 4. LLM field extraction ───────────────────────────────────────────
        try:
            _gen_start = time.monotonic()
            summary_fields: dict = await asyncio.to_thread(
                llm_generate_scheme_fields,
                structured_data=structured_data_clean,
                scheme_id=scheme_id,
                scheme_name=scheme_name,
                required_fields=scheme_required_fields,
                optional_fields=scheme_optional_fields,
                hospital_name=settings.hospital_name,
            )
            disgen_generation_duration_seconds.observe(time.monotonic() - _gen_start)

            # Re-identify: replace placeholders back with real PHI before persist
            if phi_map and summary_fields:
                fields_json = json.dumps(summary_fields, ensure_ascii=False)
                fields_json = reidentify(fields_json, phi_map)
                summary_fields = json.loads(fields_json)
        except Exception as exc:
            logger.error(
                "Field generation failed document=%s scheme=%s: %s",
                document_id,
                scheme_id,
                exc,
            )
            try:
                raise task.retry(exc=exc, countdown=60)
            except MaxRetriesExceededError:
                await _mark_failed(
                    doc_uuid, user_uuid, scheme_id, f"LLM error: {exc}", make_session
                )
                return {"status": "generation_error", "document_id": document_id}

        # ── 5. Validate (injection scan + required field presence) ────────────
        result = validate_fields(
            summary_fields=summary_fields,
            required_fields=scheme_required_fields,
        )
        # Status is always 'draft' — doctor fills any null fields via PATCH.
        # validation_notes records which fields are missing so the UI can
        # highlight them immediately without a separate API call.
        final_status = "draft"

        # ── 6–9. Retire previous + persist new + audit ────────────────────────
        async with make_session() as db:
            max_version = (
                await db.execute(
                    select(
                        func.coalesce(func.max(GeneratedSummary.version), 0)
                    ).where(
                        GeneratedSummary.document_id == doc_uuid,
                        GeneratedSummary.scheme == scheme_id,
                    )
                )
            ).scalar() or 0
            new_version = int(max_version) + 1

            gs = GeneratedSummary(
                document_id=doc_uuid,
                scheme=scheme_id,
                summary_text=None,
                summary_fields=summary_fields,
                status=final_status,
                validation_notes=result.notes,
                generated_by=user_uuid,
                version=new_version,
                is_active=True,
            )
            db.add(gs)
            await db.flush()

            # Retire all previously active summaries for this (document, scheme).
            await db.execute(
                update(GeneratedSummary)
                .where(
                    GeneratedSummary.document_id == doc_uuid,
                    GeneratedSummary.scheme == scheme_id,
                    GeneratedSummary.id != gs.id,
                    GeneratedSummary.is_active == True,  # noqa: E712
                )
                .values(is_active=False, superseded_by_id=gs.id)
            )

            doc = (
                await db.execute(select(Document).where(Document.id == doc_uuid))
            ).scalar_one()
            doc.status = "generated"
            disgen_document_status_total.labels(status="generated").inc()

            missing_fields = result.notes.get("empty_required_fields", [])
            await create_audit_log(
                db,
                user_id=user_uuid,
                username="system",
                role="system",
                action="GENERATE",
                document_id=doc_uuid,
                ip_address="127.0.0.1",
                details={
                    "scheme_id": scheme_id,
                    "version": new_version,
                    "fields_total": len(summary_fields),
                    "fields_null": len(missing_fields),
                    "missing_required": missing_fields,
                },
            )
            summary_id = str(gs.id)
            await db.commit()

    logger.info(
        "Generate complete document=%s scheme=%s version=%d fields=%d null=%d",
        document_id,
        scheme_id,
        new_version,
        len(summary_fields),
        len(result.notes.get("empty_required_fields", [])),
    )
    return {
        "document_id": document_id,
        "scheme_id": scheme_id,
        "summary_id": summary_id,
        "version": new_version,
        "status": final_status,
        "fields_total": len(summary_fields),
        "missing_required": result.notes.get("empty_required_fields", []),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _write_failure_audit(
    db: AsyncSession,
    doc_uuid: uuid.UUID,
    user_uuid: uuid.UUID,
    scheme_id: str,
    reason: str,
) -> None:
    """
    Record a GENERATE_FAILED audit entry. Caller is responsible for commit()
    so this can be composed with other DB writes in the same transaction.
    """
    await create_audit_log(
        db,
        user_id=user_uuid,
        username="system",
        role="system",
        action="GENERATE_FAILED",
        document_id=doc_uuid,
        ip_address="127.0.0.1",
        details={"scheme_id": scheme_id, "reason": reason},
    )


async def _mark_failed(
    doc_uuid: uuid.UUID,
    user_uuid: uuid.UUID,
    scheme_id: str,
    reason: str,
    make_session,
) -> None:
    """
    Permanent-failure path: flip the document to 'failed' and record audit.
    Wrapped in try/except — a secondary DB error must never mask the original
    LLM/transport failure.
    """
    logger.error(
        "Generate permanently failed document=%s scheme=%s reason=%s",
        doc_uuid,
        scheme_id,
        reason,
    )
    try:
        async with make_session() as db:
            doc = (
                await db.execute(select(Document).where(Document.id == doc_uuid))
            ).scalar_one_or_none()
            if doc is not None:
                doc.status = "failed"
                disgen_document_status_total.labels(status="failed").inc()
            await _write_failure_audit(db, doc_uuid, user_uuid, scheme_id, reason)
            await db.commit()
    except Exception as db_exc:
        logger.error(
            "Generate task: failed to write failure status for %s: %s",
            doc_uuid,
            db_exc,
        )
