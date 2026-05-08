"""
Document management endpoints.

POST  /documents/upload                   Doctor only — upload, enqueue OCR pipeline
GET   /documents                          Doctor (own) / Admin + SuperAdmin (all)
GET   /documents/stats                    Admin + SuperAdmin — aggregated counts
GET   /documents/{id}                     Role-scoped single document
GET   /documents/{id}/status              All roles — lightweight status polling
GET   /documents/{id}/structured          Role-scoped — decrypt + return clinical data
PATCH /documents/{id}/structured          Doctor only — partial update, re-encrypt
POST  /documents/{id}/structured/confirm  Doctor only — lock data for generation
DELETE /documents/{id}                    Super Admin only — soft delete

Upload flow:
  1. Rate limit (10/min per doctor via Redis)
  2. Read file bytes — magic-byte MIME validation
  3. SHA-256 dedup — return existing document if duplicate within hospital
  4. Upload to MinIO
  5. Insert Document row (status: processing)
  6. Validate consent and insert ConsentRecord
  7. Write UPLOAD audit entry
  8. Enqueue Celery process_document task
  9. Return {document_id, status: "processing"}

Structured data update:
  - Only allowed when status is 'ready' or 'confirmed'
  - Partial merge: only provided fields are updated
  - icd10_* and extraction_source fields are system-managed — never overwritten
  - excluded_fields stored in plaintext on structured_reports; rest re-encrypted
  - Version incremented on every PATCH
"""

from __future__ import annotations

import dataclasses
import hashlib
import io
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import magic
import redis.asyncio as aioredis
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_role
from compliance.abha import abha_error_message, validate_abha_id
from compliance.consent import validate_consent_payload
from metrics import disgen_document_status_total, disgen_upload_total
from auth.service import client_ip as _client_ip
from config import settings
from crypto import decrypt, encrypt
from database import get_db
from llm.extractor import StructuredData
from models.audit import AuditLog
from models.compliance import ConsentRecord, HospitalConfig
from models.document import Document
from models.scheme import GeneratedSummary, Scheme
from models.structured_report import StructuredReport
from models.user import User
from storage.minio_client import get_minio
from tasks.ocr_tasks import process_document

router = APIRouter(prefix="/documents", tags=["Documents"])

# ── Constants ──────────────────────────────────────────────────────────────────

_ALLOWED_MIME_TYPES: frozenset[str] = frozenset({
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/tiff",
})

_MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB — nginx also enforces this

_UPLOAD_RATE_LIMIT = 10  # uploads per minute per doctor

# Statuses from which a doctor may edit structured data
_EDITABLE_STATUSES: frozenset[str] = frozenset({"ready", "confirmed"})

# Structured fields that doctors may update; system-assigned ICD-10 / metadata excluded
_EDITABLE_FIELDS: frozenset[str] = frozenset(
    f.name
    for f in dataclasses.fields(StructuredData)
    if f.name
    not in (
        "icd10_primary",
        "icd10_secondary",
        "icd10_primary_candidates",
        "icd10_secondary_candidates",
        "extraction_source",
    )
)

# ── Redis (rate limiting) ──────────────────────────────────────────────────────

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def _check_upload_rate_limit(user_id: uuid.UUID) -> bool:
    """Return True if this doctor has exceeded 10 uploads per minute."""
    key = f"ratelimit:upload:{user_id}"
    r = _get_redis()
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, 60)
    return count > _UPLOAD_RATE_LIMIT


# ── Pydantic schemas ───────────────────────────────────────────────────────────


class DocumentResponse(BaseModel):
    id: str
    filename: str
    status: str
    pages: int | None
    ocr_confidence: float | None
    created_at: datetime
    uploaded_by: str
    hospital_id: str
    sha256_hash: str


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int
    page: int
    per_page: int


class StatusResponse(BaseModel):
    document_id: str
    status: str


class StructuredDataResponse(BaseModel):
    document_id: str
    data: dict
    data_confirmed: bool
    version: int
    updated_at: datetime
    excluded_fields: list


class StructuredDataPatch(BaseModel):
    """
    Partial update request for structured clinical data.

    Only fields listed here can be updated. ICD-10 mapping fields and
    extraction_source are system-managed and are never overwritten by this endpoint.

    excluded_fields is stored in plaintext on structured_reports (not inside
    the encrypted blob) and controls which sections are skipped during generation.
    """

    patient_name: str | None = None
    age: str | None = None
    gender: str | None = None
    uhid: str | None = None
    abha_id: str | None = None
    phone: str | None = None
    admission_date: str | None = None
    discharge_date: str | None = None
    ward: str | None = None
    bed_number: str | None = None
    primary_diagnosis: str | None = None
    secondary_diagnoses: list[str] | None = None
    presenting_complaints: list[str] | None = None
    blood_pressure: str | None = None
    pulse_rate: str | None = None
    temperature: str | None = None
    oxygen_saturation: str | None = None
    weight: str | None = None
    height: str | None = None
    investigations: list[dict] | None = None
    procedures: list[dict] | None = None
    medications_during_stay: list[dict] | None = None
    discharge_medications: list[dict] | None = None
    follow_up_instructions: str | None = None
    follow_up_date: str | None = None
    diet_advice: str | None = None
    allergies: str | None = None
    consultant: str | None = None
    surgeon: str | None = None
    anesthetist: str | None = None
    excluded_fields: list[str] | None = None


class StatsResponse(BaseModel):
    total_documents: int
    by_status: dict[str, int]
    avg_ocr_confidence: float | None
    uploads_last_7_days: list[dict]


class GenerateRequest(BaseModel):
    scheme_id: str


class GenerateResponse(BaseModel):
    document_id: str
    scheme_id: str
    status: str  # "queued"


class SummaryResponse(BaseModel):
    id: str
    document_id: str
    scheme: str
    status: str
    version: int
    summary_text: str | None = None      # legacy free-text (nullable since 0007)
    summary_fields: dict | None = None   # field-based workflow
    validation_notes: dict | None
    generated_by: str
    approved_by: str | None
    approved_at: datetime | None
    created_at: datetime


class UpdateFieldsRequest(BaseModel):
    fields: dict[str, str | None]
    scheme_id: str | None = None


# ── Private helpers ────────────────────────────────────────────────────────────


def _safe_filename(raw: str) -> str:
    """Strip directory components and limit filename length."""
    import os

    return os.path.basename(raw)[:200] or "document"


def _doc_to_response(doc: Document) -> DocumentResponse:
    return DocumentResponse(
        id=str(doc.id),
        filename=doc.filename,
        status=doc.status,
        pages=doc.pages,
        ocr_confidence=doc.ocr_confidence,
        created_at=doc.created_at,
        uploaded_by=str(doc.uploaded_by),
        hospital_id=doc.hospital_id,
        sha256_hash=doc.sha256_hash,
    )


async def _fetch_doc(
    doc_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Document:
    """
    Fetch a non-deleted document and enforce role-scoped access.

    Doctors may only access documents they uploaded.
    Admin and Super Admin see any document in the hospital.
    """
    row = await db.execute(select(Document).where(Document.id == doc_id))
    doc = row.scalar_one_or_none()

    if doc is None or doc.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if user.role == "doctor" and doc.uploaded_by != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return doc


async def _fetch_report(doc_id: uuid.UUID, db: AsyncSession) -> StructuredReport:
    """Fetch the structured report for a document, raising 404 if absent."""
    row = await db.execute(
        select(StructuredReport).where(StructuredReport.document_id == doc_id)
    )
    report = row.scalar_one_or_none()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Structured data not yet available — document may still be processing",
        )
    return report


# ── POST /upload ───────────────────────────────────────────────────────────────


@router.post("/upload")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    patient_name: str = Form(...),
    consent_given: bool = Form(...),
    consent_method: str = Form(...),
    consent_date: date | None = Form(None),
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """
    Upload a discharge document and start the OCR + extraction pipeline.

    Accepted formats: PDF, JPEG, PNG, TIFF (validated by magic bytes, not extension).
    Returns HTTP 200 with duplicate=true if an identical file already exists for
    this hospital. Returns HTTP 201 on successful new upload.
    """
    # ── Rate limit ─────────────────────────────────────────────────────────────
    if await _check_upload_rate_limit(user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upload rate limit exceeded — maximum 10 uploads per minute per user",
        )

    # ── Consent validation ─────────────────────────────────────────────────────
    try:
        validate_consent_payload(consent_given, consent_method, patient_name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # ── Read and validate file bytes ───────────────────────────────────────────
    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty",
        )
    if len(file_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds the maximum allowed size of 25 MB",
        )

    # Magic-byte MIME detection — ignores the Content-Type header which can be spoofed
    detected_mime = magic.from_buffer(file_bytes[:2048], mime=True)
    if detected_mime not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unsupported file type detected: {detected_mime}. "
                "Allowed types: PDF, JPEG, PNG, TIFF"
            ),
        )

    # ── SHA-256 deduplication ──────────────────────────────────────────────────
    sha256 = hashlib.sha256(file_bytes).hexdigest()
    dup_row = await db.execute(
        select(Document).where(
            Document.hospital_id == settings.hospital_id,
            Document.sha256_hash == sha256,
            Document.deleted_at.is_(None),
        )
    )
    existing = dup_row.scalar_one_or_none()
    if existing is not None:
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "document_id": str(existing.id),
                "status": existing.status,
                "duplicate": True,
            },
        )

    # ── MinIO upload ───────────────────────────────────────────────────────────
    doc_id = uuid.uuid4()
    safe_name = _safe_filename(file.filename or "document")
    minio_key = f"{settings.hospital_id}/{doc_id}/{safe_name}"

    try:
        get_minio().put_object(
            settings.minio_bucket,
            minio_key,
            io.BytesIO(file_bytes),
            length=len(file_bytes),
            content_type=detected_mime,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="File storage is temporarily unavailable — please retry",
        ) from exc

    # ── Persist document + consent record + audit log ──────────────────────────
    doc = Document(
        id=doc_id,
        hospital_id=settings.hospital_id,
        uploaded_by=user.id,
        filename=safe_name,
        minio_key=minio_key,
        sha256_hash=sha256,
        status="processing",
    )
    db.add(doc)

    # flush so the Document PK exists before ConsentRecord FK is inserted
    await db.flush()

    db.add(
        ConsentRecord(
            document_id=doc_id,
            patient_name=patient_name,
            consent_given=consent_given,
            consent_method=consent_method,
            consent_date=consent_date or date.today(),
            recorded_by=user.id,
        )
    )
    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="UPLOAD",
            document_id=doc_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={
                "filename": safe_name,
                "size_bytes": len(file_bytes),
                "mime_type": detected_mime,
                "sha256": sha256,
            },
        )
    )
    await db.commit()

    # ── Enqueue OCR pipeline ───────────────────────────────────────────────────
    process_document.delay(str(doc_id))

    disgen_upload_total.inc()
    disgen_document_status_total.labels(status="processing").inc()

    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={"document_id": str(doc_id), "status": "processing", "duplicate": False},
    )


# ── GET /documents ─────────────────────────────────────────────────────────────


@router.get("", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentListResponse:
    """
    List documents with pagination.

    Doctors see only their own documents. Admin and Super Admin see all.
    """
    base = [Document.deleted_at.is_(None)]

    if user.role == "doctor":
        base.append(Document.uploaded_by == user.id)

    if status_filter is not None:
        base.append(Document.status == status_filter)

    total = (
        await db.execute(select(func.count(Document.id)).where(*base))
    ).scalar() or 0

    rows = await db.execute(
        select(Document)
        .where(*base)
        .order_by(Document.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    docs = rows.scalars().all()

    return DocumentListResponse(
        documents=[_doc_to_response(d) for d in docs],
        total=total,
        page=page,
        per_page=per_page,
    )


# ── GET /documents/stats — MUST be declared before /{id} ──────────────────────


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StatsResponse:
    """
    Aggregated document statistics.

    Admins and super-admins see global stats across all documents.
    Doctors see stats scoped to their own uploaded documents.
    """
    is_admin = user.role in ("admin", "super_admin")
    not_deleted = Document.deleted_at.is_(None)

    # Scope filter — doctors only see their own documents
    scope = (
        [not_deleted]
        if is_admin
        else [not_deleted, Document.uploaded_by == user.id]
    )

    # Total count
    total = (
        await db.execute(select(func.count(Document.id)).where(*scope))
    ).scalar() or 0

    # Count per status
    status_rows = await db.execute(
        select(Document.status, func.count(Document.id).label("cnt"))
        .where(*scope)
        .group_by(Document.status)
    )
    by_status = {row.status: row.cnt for row in status_rows}

    # Average OCR confidence
    avg_conf = (
        await db.execute(
            select(func.avg(Document.ocr_confidence)).where(
                *scope,
                Document.ocr_confidence.is_not(None),
            )
        )
    ).scalar()
    avg_ocr_confidence = round(float(avg_conf), 4) if avg_conf is not None else None

    # Upload counts for the past 7 days, grouped by date
    since = datetime.now(timezone.utc) - timedelta(days=7)
    day_rows = await db.execute(
        select(
            func.date(Document.created_at).label("day"),
            func.count(Document.id).label("cnt"),
        )
        .where(*scope, Document.created_at >= since)
        .group_by(func.date(Document.created_at))
        .order_by(func.date(Document.created_at))
    )
    uploads_last_7_days = [
        {"date": str(row.day), "count": row.cnt} for row in day_rows
    ]

    return StatsResponse(
        total_documents=total,
        by_status=by_status,
        avg_ocr_confidence=avg_ocr_confidence,
        uploads_last_7_days=uploads_last_7_days,
    )


# ── GET /documents/{id} ────────────────────────────────────────────────────────


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    """Return document metadata. Does not include OCR text or structured data."""
    doc = await _fetch_doc(document_id, user, db)
    return _doc_to_response(doc)


# ── GET /documents/{id}/status ─────────────────────────────────────────────────


@router.get("/{document_id}/status", response_model=StatusResponse)
async def get_document_status(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StatusResponse:
    """
    Lightweight polling endpoint. Frontend polls every 3 s while status is
    'processing' or 'extracting'. Returns only the current status string.
    """
    doc = await _fetch_doc(document_id, user, db)
    return StatusResponse(document_id=str(doc.id), status=doc.status)


# ── GET /documents/{id}/structured ────────────────────────────────────────────


@router.get("/{document_id}/structured", response_model=StructuredDataResponse)
async def get_structured_data(
    document_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StructuredDataResponse:
    """
    Decrypt and return the structured clinical data for a document.

    Available once the document reaches 'ready' status. Doctors may only
    access their own documents; Admin and Super Admin see all.
    """
    doc = await _fetch_doc(document_id, user, db)
    report = await _fetch_report(document_id, db)

    data = json.loads(decrypt(report.data))

    return StructuredDataResponse(
        document_id=str(doc.id),
        data=data,
        data_confirmed=report.data_confirmed,
        version=report.version,
        updated_at=report.updated_at,
        excluded_fields=report.excluded_fields or [],
    )


# ── PATCH /documents/{id}/structured ──────────────────────────────────────────


@router.patch("/{document_id}/structured", response_model=StructuredDataResponse)
async def update_structured_data(
    document_id: uuid.UUID,
    patch: StructuredDataPatch,
    request: Request,
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> StructuredDataResponse:
    """
    Partially update structured clinical data.

    Only fields explicitly provided in the request body are modified.
    System fields (ICD-10 codes, extraction_source) are never overwritten.
    Document must be in 'ready' or 'confirmed' status.
    Each update increments the version counter for audit trail purposes.
    """
    doc = await _fetch_doc(document_id, user, db)

    if doc.status not in _EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot edit structured data when document status is '{doc.status}'. "
                f"Allowed statuses: {sorted(_EDITABLE_STATUSES)}"
            ),
        )

    report = await _fetch_report(document_id, db)

    # Decrypt current data
    current_data: dict = json.loads(decrypt(report.data))

    # Separate excluded_fields (DB column) from clinical fields (encrypted)
    clinical_updates = patch.model_dump(exclude_unset=True, exclude={"excluded_fields"})

    # Apply only fields within the allowed set
    updated_keys: list[str] = []
    for key, value in clinical_updates.items():
        if key in _EDITABLE_FIELDS:
            current_data[key] = value
            updated_keys.append(key)

    report.data = encrypt(json.dumps(current_data, ensure_ascii=False))
    report.version += 1

    if patch.excluded_fields is not None:
        report.excluded_fields = patch.excluded_fields

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="STRUCTURED_UPDATE",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={"fields_updated": updated_keys, "new_version": report.version},
        )
    )
    await db.commit()
    await db.refresh(report)

    return StructuredDataResponse(
        document_id=str(document_id),
        data=current_data,
        data_confirmed=report.data_confirmed,
        version=report.version,
        updated_at=report.updated_at,
        excluded_fields=report.excluded_fields or [],
    )


# ── POST /documents/{id}/structured/confirm ───────────────────────────────────


@router.post(
    "/{document_id}/structured/confirm",
    response_model=StructuredDataResponse,
)
async def confirm_structured_data(
    document_id: uuid.UUID,
    request: Request,
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> StructuredDataResponse:
    """
    Lock the structured data and mark the document ready for summary generation.

    Sets data_confirmed=True, records who confirmed and when, and transitions
    the document status to 'confirmed'. Generation is blocked until this is called.
    """
    doc = await _fetch_doc(document_id, user, db)
    report = await _fetch_report(document_id, db)

    if doc.status not in _EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot confirm structured data when document status is '{doc.status}'. "
                "Document must be in 'ready' or 'confirmed' status."
            ),
        )

    # Decrypt first so we can run compliance checks before locking
    data = json.loads(decrypt(report.data))

    # ABHA validation — blocks confirmation if a value is present but malformed.
    # An absent (None / empty) ABHA ID is always valid; patients are not required
    # to have one.
    if not validate_abha_id(data.get("abha_id")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=abha_error_message(),
        )

    now = datetime.now(timezone.utc)
    report.data_confirmed = True
    report.confirmed_by = user.id
    report.confirmed_at = now

    # Advance status if currently 'ready'
    if doc.status == "ready":
        doc.status = "confirmed"
        disgen_document_status_total.labels(status="confirmed").inc()

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="STRUCTURED_CONFIRM",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={"version": report.version},
        )
    )
    await db.commit()
    await db.refresh(report)

    return StructuredDataResponse(
        document_id=str(document_id),
        data=data,
        data_confirmed=report.data_confirmed,
        version=report.version,
        updated_at=report.updated_at,
        excluded_fields=report.excluded_fields or [],
    )


# ── DELETE /documents/{id} ─────────────────────────────────────────────────────


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    request: Request,
    user: User = Depends(require_role("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Soft-delete a document (sets deleted_at). Super Admin only.

    The MinIO file and structured report are retained for DPDP audit compliance.
    Hard deletion and PHI anonymization are handled by the retention task (Step 15).

    Note: no `-> None` return annotation — FastAPI 0.115 turns `-> None` into
    `response_model = NoneType` (a truthy class), which fails its 204-no-body
    assertion at route registration. Routes that return 204 must omit the
    return annotation entirely.
    """
    row = await db.execute(select(Document).where(Document.id == document_id))
    doc = row.scalar_one_or_none()

    if doc is None or doc.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    doc.deleted_at = datetime.now(timezone.utc)

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="DOCUMENT_DELETE",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={"previous_status": doc.status},
        )
    )
    await db.commit()


# ── POST /documents/{id}/generate ──────────────────────────────────────────────


@router.post(
    "/{document_id}/generate",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=GenerateResponse,
)
async def trigger_generation(
    document_id: uuid.UUID,
    body: GenerateRequest,
    request: Request,
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> GenerateResponse:
    """
    Enqueue a discharge summary generation job.

    Doctor only — must own the document. Document must have its structured
    data confirmed (`data_confirmed = true`). Allowed source statuses are
    `confirmed`, `generated`, and `validation_failed` so doctors can
    regenerate after edits or after a validation failure.

    The generation runs asynchronously on the `generate` Celery queue. The
    document transitions to `generating` synchronously here; the eventual
    outcome is reflected in the document status (`generated` /
    `validation_failed` / `failed`) and surfaced via the existing status
    polling endpoint.
    """
    doc = await _fetch_doc(document_id, user, db)
    report = await _fetch_report(document_id, db)

    if not report.data_confirmed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Confirm structured data before generating a summary",
        )

    allowed = {"confirmed", "generated", "validation_failed"}
    if doc.status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot generate from status '{doc.status}'. "
                f"Allowed source statuses: {sorted(allowed)}"
            ),
        )

    scheme = (
        await db.execute(select(Scheme).where(Scheme.id == body.scheme_id))
    ).scalar_one_or_none()
    if scheme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown scheme '{body.scheme_id}'",
        )

    doc.status = "generating"
    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="GENERATE",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={"scheme_id": body.scheme_id, "trigger": "user_initiated"},
        )
    )
    await db.commit()

    # Local import keeps Celery import out of the FastAPI startup path
    from tasks.generate_tasks import generate_summary as celery_generate_summary

    celery_generate_summary.delay(str(document_id), body.scheme_id, str(user.id))

    return GenerateResponse(
        document_id=str(document_id),
        scheme_id=body.scheme_id,
        status="queued",
    )


# ── GET /documents/{id}/summary/latest ────────────────────────────────────────


@router.get(
    "/{document_id}/summary/latest",
    response_model=SummaryResponse,
)
async def get_latest_summary(
    document_id: uuid.UUID,
    scheme_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SummaryResponse:
    """
    Return the most recently generated summary for a document.

    Decrypts the stored summary text. Doctors are scoped to their own documents;
    Admin and Super Admin can see all. If `scheme_id` is provided, only that
    scheme's summaries are considered.
    """
    doc = await _fetch_doc(document_id, user, db)

    where_clauses = [
        GeneratedSummary.document_id == doc.id,
        GeneratedSummary.is_active == True,  # noqa: E712
    ]
    if scheme_id:
        where_clauses.append(GeneratedSummary.scheme == scheme_id)

    row = await db.execute(
        select(GeneratedSummary)
        .where(*where_clauses)
        .order_by(GeneratedSummary.created_at.desc())
        .limit(1)
    )
    summary = row.scalar_one_or_none()
    if summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No summary generated for this document yet",
        )

    return SummaryResponse(
        id=str(summary.id),
        document_id=str(summary.document_id),
        scheme=summary.scheme,
        status=summary.status,
        version=summary.version,
        summary_text=decrypt(summary.summary_text) if summary.summary_text else None,
        summary_fields=summary.summary_fields,
        validation_notes=summary.validation_notes,
        generated_by=str(summary.generated_by),
        approved_by=str(summary.approved_by) if summary.approved_by else None,
        approved_at=summary.approved_at,
        created_at=summary.created_at,
    )


# ── PATCH /documents/{id}/summary/latest/fields ───────────────────────────────


@router.patch(
    "/{document_id}/summary/latest/fields",
    response_model=SummaryResponse,
)
async def update_summary_fields(
    document_id: uuid.UUID,
    body: UpdateFieldsRequest,
    request: Request,
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> SummaryResponse:
    """
    Merge doctor-edited field values into the latest active summary.

    Only the keys provided in `body.fields` are updated — existing fields
    not mentioned are preserved. Pass null to explicitly clear a field.
    The summary must be in 'draft' status (approved summaries are locked).
    """
    doc = await _fetch_doc(document_id, user, db)

    where_clauses = [
        GeneratedSummary.document_id == doc.id,
        GeneratedSummary.is_active == True,  # noqa: E712
    ]
    if body.scheme_id:
        where_clauses.append(GeneratedSummary.scheme == body.scheme_id)

    summary = (
        await db.execute(
            select(GeneratedSummary)
            .where(*where_clauses)
            .order_by(GeneratedSummary.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No summary found for this document",
        )
    if summary.status == "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Approved summaries are locked — regenerate to make changes",
        )

    # Merge: start from existing fields, overlay doctor edits
    merged = dict(summary.summary_fields or {})
    merged.update(body.fields)

    # Fetch the scheme to re-validate required fields
    scheme = (
        await db.execute(select(Scheme).where(Scheme.id == summary.scheme))
    ).scalar_one_or_none()
    required_fields = list(scheme.required_fields or []) if scheme else []

    from llm.validator import validate_fields as _validate_fields
    result = _validate_fields(summary_fields=merged, required_fields=required_fields)

    summary.summary_fields = merged
    summary.validation_notes = result.notes

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="FIELD_EDIT",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={
                "summary_id": str(summary.id),
                "scheme": summary.scheme,
                "fields_updated": list(body.fields.keys()),
                "missing_required": result.notes.get("empty_required_fields", []),
            },
        )
    )
    await db.commit()
    await db.refresh(summary)

    return SummaryResponse(
        id=str(summary.id),
        document_id=str(summary.document_id),
        scheme=summary.scheme,
        status=summary.status,
        version=summary.version,
        summary_text=decrypt(summary.summary_text) if summary.summary_text else None,
        summary_fields=summary.summary_fields,
        validation_notes=summary.validation_notes,
        generated_by=str(summary.generated_by),
        approved_by=str(summary.approved_by) if summary.approved_by else None,
        approved_at=summary.approved_at,
        created_at=summary.created_at,
    )


# ── GET /documents/{id}/summary/latest/pdf ────────────────────────────────────


@router.get(
    "/{document_id}/summary/latest/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
)
async def download_latest_summary_pdf(
    document_id: uuid.UUID,
    request: Request,
    scheme_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Render and stream the latest summary as a PDF.

    Looks up the latest `GeneratedSummary` for the document (optionally
    scoped to a specific `scheme_id`), gathers the related Scheme,
    StructuredReport, HospitalConfig, and User records, decrypts what is
    encrypted, and renders to PDF via WeasyPrint.

    A `DRAFT` watermark is rendered when the summary is not yet approved.
    Doctors are restricted to their own documents.
    """
    doc = await _fetch_doc(document_id, user, db)

    where_clauses = [
        GeneratedSummary.document_id == doc.id,
        GeneratedSummary.is_active == True,  # noqa: E712
    ]
    if scheme_id:
        where_clauses.append(GeneratedSummary.scheme == scheme_id)

    summary = (
        await db.execute(
            select(GeneratedSummary)
            .where(*where_clauses)
            .order_by(GeneratedSummary.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No summary generated for this document yet",
        )

    scheme = (
        await db.execute(select(Scheme).where(Scheme.id == summary.scheme))
    ).scalar_one_or_none()
    if scheme is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scheme '{summary.scheme}' is missing — orphaned summary",
        )

    report = await _fetch_report(document_id, db)
    structured_data = json.loads(decrypt(report.data))

    hospital_config = (
        await db.execute(select(HospitalConfig).where(HospitalConfig.id == 1))
    ).scalar_one_or_none()
    if hospital_config is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Hospital configuration missing — please run /admin/hospital setup",
        )

    generator = (
        await db.execute(select(User).where(User.id == summary.generated_by))
    ).scalar_one_or_none()
    generated_by_name = generator.full_name if generator else "Unknown user"

    approved_by_name: str | None = None
    if summary.approved_by:
        approver = (
            await db.execute(select(User).where(User.id == summary.approved_by))
        ).scalar_one_or_none()
        approved_by_name = approver.full_name if approver else None

    summary_text = decrypt(summary.summary_text) if summary.summary_text else None

    # Local import so a missing PDF dependency doesn't break the whole API
    from pdf.renderer import render_pdf, safe_pdf_filename

    try:
        pdf_bytes = render_pdf(
            summary_fields=summary.summary_fields,
            summary_text=summary_text,
            structured_data=structured_data,
            scheme=scheme,
            document=doc,
            summary=summary,
            hospital_config=hospital_config,
            generated_by_name=generated_by_name,
            approved_by_name=approved_by_name,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF rendering failed: {type(exc).__name__}",
        ) from exc

    filename = safe_pdf_filename(structured_data, summary.scheme, summary.version)

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="PDF_DOWNLOAD",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={
                "summary_id": str(summary.id),
                "scheme": summary.scheme,
                "version": summary.version,
                "summary_status": summary.status,
                "bytes": len(pdf_bytes),
            },
        )
    )
    await db.commit()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


# ── POST /documents/{id}/summary/latest/approve ───────────────────────────────


@router.post(
    "/{document_id}/summary/latest/approve",
    response_model=SummaryResponse,
)
async def approve_latest_summary(
    document_id: uuid.UUID,
    request: Request,
    scheme_id: str | None = Query(default=None),
    user: User = Depends(require_role("doctor")),
    db: AsyncSession = Depends(get_db),
) -> SummaryResponse:
    """
    Approve the latest draft summary for this document.

    Doctor only — must own the document. Only summaries currently in
    `draft` status may be approved (validation_failed summaries must be
    regenerated first). On approval, the summary status is set to
    `approved`, `approved_by` and `approved_at` are recorded, and the
    document status is advanced from `generated` to `approved`.

    Once approved, the PDF rendered for this summary no longer carries the
    DRAFT watermark.
    """
    doc = await _fetch_doc(document_id, user, db)

    where_clauses = [
        GeneratedSummary.document_id == doc.id,
        GeneratedSummary.is_active == True,  # noqa: E712
    ]
    if scheme_id:
        where_clauses.append(GeneratedSummary.scheme == scheme_id)

    summary = (
        await db.execute(
            select(GeneratedSummary)
            .where(*where_clauses)
            .order_by(GeneratedSummary.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if summary is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No summary available to approve",
        )

    if summary.status == "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Summary is already approved",
        )
    if summary.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot approve a summary in status '{summary.status}'. "
                "Only draft summaries may be approved — regenerate first."
            ),
        )

    # Ensure all required fields are filled before approving
    scheme = (
        await db.execute(select(Scheme).where(Scheme.id == summary.scheme))
    ).scalar_one_or_none()
    if scheme:
        from llm.validator import validate_fields as _validate_fields
        vr = _validate_fields(
            summary_fields=summary.summary_fields or {},
            required_fields=list(scheme.required_fields or []),
        )
        missing = vr.notes.get("empty_required_fields", [])
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "message": "Cannot approve — required fields are empty",
                    "missing_fields": missing,
                },
            )

    summary.status = "approved"
    summary.approved_by = user.id
    summary.approved_at = datetime.now(timezone.utc)

    if doc.status == "generated":
        doc.status = "approved"
        disgen_document_status_total.labels(status="approved").inc()

    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="APPROVE",
            document_id=document_id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={
                "summary_id": str(summary.id),
                "scheme": summary.scheme,
                "version": summary.version,
            },
        )
    )
    await db.commit()
    await db.refresh(summary)

    return SummaryResponse(
        id=str(summary.id),
        document_id=str(summary.document_id),
        scheme=summary.scheme,
        status=summary.status,
        version=summary.version,
        summary_text=decrypt(summary.summary_text) if summary.summary_text else None,
        summary_fields=summary.summary_fields,
        validation_notes=summary.validation_notes,
        generated_by=str(summary.generated_by),
        approved_by=str(summary.approved_by) if summary.approved_by else None,
        approved_at=summary.approved_at,
        created_at=summary.created_at,
    )
