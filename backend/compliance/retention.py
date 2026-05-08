"""
DPDP retention enforcement — core logic.

Called daily by the Celery Beat task in tasks/retention_tasks.py.

Two modes, controlled by retention_settings.anonymize_on_expiry:

  anonymize_on_expiry=True  (default, recommended):
    - Patient-identifying fields in structured_reports.data are replaced with
      "[REDACTED]" and re-encrypted.
    - documents.ocr_text is replaced with an encrypted "[REDACTED]" sentinel.
    - generated_summaries.summary_text is replaced with an encrypted sentinel.
    - consent_records.patient_name is redacted.
    - The Document row and MinIO file are retained (document is NOT soft-deleted).
    - Clinical fields (diagnosis, medications, vitals) are kept for medical record
      and audit purposes — only direct and quasi-identifiers are removed.

  anonymize_on_expiry=False  (hard delete):
    - Document row is soft-deleted (deleted_at = now()).
    - MinIO file is permanently deleted.
    - Structured report and generated summaries are left in place (orphaned but
      accessible to Super Admin for compliance audit until their own retention
      window expires).

Every processed document receives a RETENTION_ENFORCED audit log entry.
MinIO deletion errors are logged but do not abort the run — DB changes are
committed regardless so the document is not reprocessed on the next run.

Batch size: 50 documents per run. A document that errors in isolation is
logged and skipped; the remainder of the batch continues.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from config import settings as app_settings
from crypto import decrypt, encrypt
from database import AsyncSessionLocal
from models.audit import AuditLog
from models.compliance import ConsentRecord, RetentionSettings
from models.document import Document
from models.scheme import GeneratedSummary
from models.structured_report import StructuredReport
from storage.minio_client import get_minio

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50

# Direct identifiers and quasi-identifiers that must be redacted.
# Clinical fields (diagnosis, medications, investigations, vitals) are kept
# so the anonymised record retains medical record value.
_PHI_SCALAR_FIELDS: frozenset[str] = frozenset({
    "patient_name",
    "uhid",
    "abha_id",
    "phone",
    "age",
    "gender",
    "admission_date",
    "discharge_date",
    "ward",
    "bed_number",
    "consultant",
    "surgeon",
    "anesthetist",
    "follow_up_date",
})

_REDACTED = "[REDACTED]"
_REDACTED_SENTINEL = "[REDACTED - retention period expired]"


# ── Public entry point ─────────────────────────────────────────────────────────


async def enforce_retention_policy() -> dict:
    """
    Run one retention enforcement cycle.

    Returns a stats dict: {examined, anonymized, deleted, errors}.
    """
    stats = {"examined": 0, "anonymized": 0, "deleted": 0, "errors": 0}

    # ── Read retention configuration ───────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RetentionSettings).where(RetentionSettings.id == 1)
        )
        retention_cfg = result.scalar_one_or_none()

    if retention_cfg is None:
        logger.error(
            "Retention settings row not found (id=1). "
            "Run seed-db.sh to initialise. Skipping retention run."
        )
        return stats

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_cfg.retention_days)
    anonymize = retention_cfg.anonymize_on_expiry

    logger.info(
        "Retention run started: cutoff=%s mode=%s",
        cutoff.date().isoformat(),
        "anonymize" if anonymize else "delete",
    )

    # ── Collect expired document IDs (no data loaded — just IDs) ──────────────
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Document.id)
            .where(Document.deleted_at.is_(None))
            .where(Document.created_at < cutoff)
            .order_by(Document.created_at)
            .limit(_BATCH_SIZE)
        )
        doc_ids = [row[0] for row in rows.all()]

    stats["examined"] = len(doc_ids)
    logger.info("Retention: %d document(s) eligible for processing", len(doc_ids))

    # ── Process each document in its own transaction ───────────────────────────
    for doc_id in doc_ids:
        try:
            if anonymize:
                await _anonymize_document(doc_id, cutoff)
                stats["anonymized"] += 1
            else:
                await _delete_document(doc_id)
                stats["deleted"] += 1
        except Exception:
            logger.exception("Retention failed for document %s — skipping", doc_id)
            stats["errors"] += 1

    logger.info(
        "Retention run complete: examined=%d anonymized=%d deleted=%d errors=%d",
        stats["examined"],
        stats["anonymized"],
        stats["deleted"],
        stats["errors"],
    )
    return stats


# ── Anonymisation path ─────────────────────────────────────────────────────────


async def _anonymize_document(doc_id, cutoff: datetime) -> None:
    """
    Redact PHI fields in structured_reports.data, documents.ocr_text,
    generated_summaries.summary_text, and consent_records.patient_name.
    The Document row remains active (not soft-deleted).
    """
    async with AsyncSessionLocal() as db:
        # Document
        doc_row = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_row.scalar_one_or_none()
        if doc is None or doc.deleted_at is not None:
            return

        # Redact OCR text — the raw OCR output contains all identifiers
        if doc.ocr_text:
            doc.ocr_text = encrypt(json.dumps({"redacted": _REDACTED_SENTINEL}))

        # Structured report
        sr_row = await db.execute(
            select(StructuredReport).where(StructuredReport.document_id == doc_id)
        )
        report = sr_row.scalar_one_or_none()
        if report is not None:
            try:
                data = json.loads(decrypt(report.data))
                data = _redact_phi(data)
                report.data = encrypt(json.dumps(data, ensure_ascii=False))
            except Exception:
                logger.exception(
                    "Could not decrypt/re-encrypt structured report for document %s", doc_id
                )
                # Still continue — mark other fields

        # Generated summaries — the full narrative contains patient identifiers
        summaries_row = await db.execute(
            select(GeneratedSummary).where(GeneratedSummary.document_id == doc_id)
        )
        for summary in summaries_row.scalars().all():
            summary.summary_text = encrypt(_REDACTED_SENTINEL)

        # Consent record — redact patient name; keep consent evidence intact
        consent_row = await db.execute(
            select(ConsentRecord).where(ConsentRecord.document_id == doc_id)
        )
        for consent in consent_row.scalars().all():
            consent.patient_name = _REDACTED

        # Audit entry
        db.add(AuditLog(
            user_id=None,
            username="system",
            role="system",
            action="RETENTION_ENFORCED",
            document_id=doc_id,
            ip_address="127.0.0.1",
            details={
                "mode": "anonymize",
                "cutoff": cutoff.date().isoformat(),
            },
        ))
        await db.commit()

    logger.info("Retention: anonymized document %s", doc_id)


# ── Hard-delete path ───────────────────────────────────────────────────────────


async def _delete_document(doc_id) -> None:
    """
    Soft-delete the Document row and permanently remove the MinIO file.
    Structured report and generated summaries are orphaned in place for
    compliance audit until their own retention window expires.
    """
    async with AsyncSessionLocal() as db:
        doc_row = await db.execute(select(Document).where(Document.id == doc_id))
        doc = doc_row.scalar_one_or_none()
        if doc is None or doc.deleted_at is not None:
            return

        minio_key = doc.minio_key
        doc.deleted_at = datetime.now(timezone.utc)

        db.add(AuditLog(
            user_id=None,
            username="system",
            role="system",
            action="RETENTION_ENFORCED",
            document_id=doc_id,
            ip_address="127.0.0.1",
            details={"mode": "delete"},
        ))
        await db.commit()

    # MinIO deletion outside the DB transaction — a storage error must not
    # roll back the soft-delete (document would otherwise be reprocessed).
    try:
        get_minio().remove_object(app_settings.minio_bucket, minio_key)
    except Exception:
        logger.exception(
            "Retention: MinIO deletion failed for key '%s' (document %s) — "
            "file may need manual removal",
            minio_key,
            doc_id,
        )

    logger.info("Retention: deleted document %s (MinIO key: %s)", doc_id, minio_key)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _redact_phi(data: dict) -> dict:
    """
    Replace all PHI scalar fields with [REDACTED].
    Clinical fields (diagnosis, medications, investigations, vitals) are preserved.
    """
    result = dict(data)
    for field_name in _PHI_SCALAR_FIELDS:
        if field_name in result and result[field_name] is not None:
            result[field_name] = _REDACTED
    return result
