"""
Typed schemas for AuditLog.details JSONB field.

Each AuditAction has a corresponding TypedDict that documents the expected
shape of the details payload. Use these types at write-sites to get static
type checking. The column stays untyped JSONB in the DB — no migration needed.

Usage:
    from models.audit_details import AuditDetailsUpload
    db.add(AuditLog(action="UPLOAD", details=AuditDetailsUpload(
        filename="report.pdf", size_bytes=1024, mime_type="application/pdf", sha256="abc..."
    )))
"""

from __future__ import annotations
from typing import TypedDict


class AuditDetailsUpload(TypedDict):
    filename: str
    size_bytes: int
    mime_type: str
    sha256: str


class AuditDetailsOcrComplete(TypedDict):
    pages: int
    confidence: float
    tables_extracted: int
    key_values_extracted: int
    sections_extracted: int


class AuditDetailsExtractComplete(TypedDict):
    extraction_source: str   # "llm" | "nlp_fallback" | "merged" | "failed"
    icd10_primary_matched: bool
    secondary_count: int


class AuditDetailsStructuredUpdate(TypedDict):
    fields_updated: list[str]
    new_version: int


class AuditDetailsStructuredConfirm(TypedDict):
    version: int


class AuditDetailsGenerate(TypedDict):
    scheme_id: str
    version: int
    summary_chars: int
    validation_passed: bool
    validation_issues: list[str]
    rag_rules_used: int


class AuditDetailsGenerateFailed(TypedDict):
    scheme_id: str
    reason: str


class AuditDetailsApprove(TypedDict):
    summary_id: str
    scheme: str
    version: int


class AuditDetailsPdfDownload(TypedDict):
    summary_id: str
    scheme: str
    version: int
    summary_status: str
    bytes: int


class AuditDetailsLoginFailed(TypedDict):
    reason: str


class AuditDetailsAccountLocked(TypedDict):
    failed_attempts: int
    locked_until: str   # ISO 8601


class AuditDetailsDocumentDelete(TypedDict):
    previous_status: str


class AuditDetailsUserCreate(TypedDict):
    target_username: str
    target_role: str


class AuditDetailsUserDeactivate(TypedDict):
    target_username: str
    sessions_revoked: int


class AuditDetailsSettingsChange(TypedDict):
    changed_keys: list[str]


class AuditDetailsRetentionEnforced(TypedDict):
    anonymized_count: int
    deleted_count: int
    cutoff_date: str
