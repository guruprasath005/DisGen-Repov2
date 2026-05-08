"""
Admin endpoints.

GET  /admin/audit-logs              Admin (own + doc-lifecycle), Super Admin (all)
GET  /admin/health                  Admin, Super Admin — live service health check
GET  /admin/analytics               Admin, Super Admin — aggregated usage stats
GET  /admin/users                   Admin only — list doctor accounts
POST /admin/users                   Admin only — create a doctor account
POST /admin/users/{id}/deactivate   Admin only — deactivate a doctor account

Access rules:
  - Admin can only read/manage doctor-role accounts.
  - Admin audit log view is restricted to their own actions plus document-lifecycle
    events (UPLOAD, OCR_COMPLETE, EXTRACT_COMPLETE, GENERATE, APPROVE, PDF_DOWNLOAD).
  - Super Admin sees all audit logs and all users — but that surface is also
    available via /superadmin (Step 14). These endpoints share the same data.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import cast, func, select, text
from sqlalchemy.types import Date as SADate
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_role
from auth.password import hash_password
from auth.service import client_ip as _client_ip
from config import settings
from database import get_db
from metrics import disgen_celery_workers
from models.audit import AuditLog
from models.document import Document
from models.scheme import GeneratedSummary
from models.user import User
from storage.minio_client import get_minio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

# Module-level uptime reference
_started_at: datetime = datetime.now(timezone.utc)

# Audit actions visible to an Admin for non-self entries
_ADMIN_VISIBLE_ACTIONS: frozenset[str] = frozenset({
    "UPLOAD",
    "OCR_COMPLETE",
    "EXTRACT_COMPLETE",
    "GENERATE",
    "APPROVE",
    "PDF_DOWNLOAD",
})


# ── Pydantic schemas ───────────────────────────────────────────────────────────


class AuditLogResponse(BaseModel):
    id: str
    user_id: str | None
    username: str
    role: str
    action: str
    document_id: str | None
    target_user_id: str | None
    ip_address: str
    details: dict | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    logs: list[AuditLogResponse]
    total: int
    page: int
    per_page: int


class ServiceStatus(BaseModel):
    status: str              # "ok" | "degraded" | "error" | "unconfigured"
    latency_ms: float | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    overall: str             # "ok" | "degraded" | "error"
    uptime_seconds: float
    services: dict[str, ServiceStatus]


class AnalyticsResponse(BaseModel):
    documents_total: int
    summaries_approved: int
    avg_ocr_confidence: float | None
    uploads_by_date: list[dict]        # [{"date": "YYYY-MM-DD", "count": N}]
    status_distribution: dict[str, int]
    scheme_distribution: dict[str, int]


class UserResponse(BaseModel):
    id: str
    username: str
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    last_login: datetime | None


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int
    page: int
    per_page: int


class CreateDoctorRequest(BaseModel):
    username: str
    full_name: str
    email: EmailStr
    password: str

    @field_validator("username")
    @classmethod
    def _username_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("username must not be empty")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("username must be 3–50 characters")
        import re
        if not re.match(r"^[A-Za-z0-9_]+$", v):
            raise ValueError("username may only contain letters, digits, and underscores")
        return v.lower()

    @field_validator("full_name")
    @classmethod
    def _fullname_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("full_name must not be empty")
        if len(v) > 255:
            raise ValueError("full_name must be at most 255 characters")
        return v

    @field_validator("password")
    @classmethod
    def _password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


# ── Private helpers ────────────────────────────────────────────────────────────


def _audit_to_response(log: AuditLog) -> AuditLogResponse:
    return AuditLogResponse(
        id=str(log.id),
        user_id=str(log.user_id) if log.user_id else None,
        username=log.username,
        role=log.role,
        action=log.action,
        document_id=str(log.document_id) if log.document_id else None,
        target_user_id=str(log.target_user_id) if log.target_user_id else None,
        ip_address=log.ip_address,
        details=log.details,
        created_at=log.created_at,
    )


def _user_to_response(u: User) -> UserResponse:
    return UserResponse(
        id=str(u.id),
        username=u.username,
        full_name=u.full_name,
        email=u.email,
        role=u.role,
        is_active=u.is_active,
        created_at=u.created_at,
        last_login=u.last_login,
    )


# ── Health check coroutines ────────────────────────────────────────────────────


async def _check_postgres(db: AsyncSession) -> ServiceStatus:
    t = time.monotonic()
    try:
        await db.execute(text("SELECT 1"))
        return ServiceStatus(status="ok", latency_ms=round((time.monotonic() - t) * 1000, 1))
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])


async def _check_redis() -> ServiceStatus:
    t = time.monotonic()
    r: aioredis.Redis | None = None
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=2)
        await asyncio.wait_for(r.ping(), timeout=2.0)
        return ServiceStatus(status="ok", latency_ms=round((time.monotonic() - t) * 1000, 1))
    except asyncio.TimeoutError:
        return ServiceStatus(status="error", detail="timeout")
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])
    finally:
        if r is not None:
            await r.aclose()


async def _check_minio() -> ServiceStatus:
    t = time.monotonic()
    try:
        exists = await asyncio.wait_for(
            asyncio.to_thread(lambda: get_minio().bucket_exists(settings.minio_bucket)),
            timeout=3.0,
        )
        st = "ok" if exists else "degraded"
        detail = None if exists else f"bucket '{settings.minio_bucket}' not found"
        return ServiceStatus(status=st, latency_ms=round((time.monotonic() - t) * 1000, 1), detail=detail)
    except asyncio.TimeoutError:
        return ServiceStatus(status="error", detail="timeout")
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])


async def _check_chromadb() -> ServiceStatus:
    t = time.monotonic()
    try:
        from rag.chromadb import get_client
        await asyncio.wait_for(asyncio.to_thread(get_client().heartbeat), timeout=3.0)
        return ServiceStatus(status="ok", latency_ms=round((time.monotonic() - t) * 1000, 1))
    except asyncio.TimeoutError:
        return ServiceStatus(status="error", detail="timeout")
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])


async def _check_celery() -> ServiceStatus:
    t = time.monotonic()
    try:
        from tasks.celery_app import celery_app

        def _ping() -> dict | None:
            return celery_app.control.inspect(timeout=1).ping()

        result = await asyncio.wait_for(asyncio.to_thread(_ping), timeout=3.0)
        worker_count = len(result) if result else 0
        disgen_celery_workers.set(worker_count)
        if worker_count == 0:
            return ServiceStatus(
                status="degraded",
                latency_ms=round((time.monotonic() - t) * 1000, 1),
                detail="no workers responding",
            )
        return ServiceStatus(
            status="ok",
            latency_ms=round((time.monotonic() - t) * 1000, 1),
            detail=f"{worker_count} worker(s) online",
        )
    except asyncio.TimeoutError:
        return ServiceStatus(status="error", detail="timeout")
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])


async def _check_tcp(url: str) -> ServiceStatus:
    """TCP reachability check for an HTTPS endpoint (no real API call)."""
    t = time.monotonic()
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not host or "placeholder" in host:
            return ServiceStatus(status="unconfigured", detail="endpoint is a placeholder")
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=3.0
        )
        writer.close()
        await writer.wait_closed()
        return ServiceStatus(status="ok", latency_ms=round((time.monotonic() - t) * 1000, 1))
    except asyncio.TimeoutError:
        return ServiceStatus(status="error", detail="timeout")
    except Exception as exc:
        return ServiceStatus(status="error", detail=str(exc)[:120])


async def _check_openai() -> ServiceStatus:
    """Verify OpenAI API key is configured and reachable."""
    if not settings.openai_api_key:
        return ServiceStatus(status="unconfigured", detail="OPENAI_API_KEY not set")
    return await _check_tcp("https://api.openai.com")


def _overall_status(services: dict[str, ServiceStatus]) -> str:
    critical = {"postgres", "redis", "celery"}
    for name, svc in services.items():
        if name in critical and svc.status == "error":
            return "error"
    for svc in services.values():
        if svc.status in ("error", "degraded"):
            return "degraded"
    return "ok"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/audit-logs", response_model=AuditLogListResponse)
async def get_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    action: str | None = Query(None, description="Filter by audit action type"),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin", "super_admin")),
) -> AuditLogListResponse:
    """
    Return paginated audit logs.

    Admin: sees their own actions plus document-lifecycle events from all users.
    Super Admin: sees all audit log entries without restriction.
    """
    base = select(AuditLog)

    if user.role == "admin":
        from sqlalchemy import or_, and_
        base = base.where(
            or_(
                AuditLog.user_id == user.id,
                AuditLog.action.in_(list(_ADMIN_VISIBLE_ACTIONS)),
            )
        )

    if action:
        base = base.where(AuditLog.action == action.upper())
    if from_date:
        base = base.where(AuditLog.created_at >= datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc))
    if to_date:
        end = datetime(to_date.year, to_date.month, to_date.day, 23, 59, 59, tzinfo=timezone.utc)
        base = base.where(AuditLog.created_at <= end)

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    offset = (page - 1) * per_page
    rows = await db.execute(
        base.order_by(AuditLog.created_at.desc()).offset(offset).limit(per_page)
    )
    logs = rows.scalars().all()

    return AuditLogListResponse(
        logs=[_audit_to_response(l) for l in logs],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/health", response_model=HealthResponse)
async def get_health(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("admin", "super_admin")),
) -> HealthResponse:
    """
    Live health check for all backing services.
    Checks run concurrently; each has a 3-second timeout.
    """
    (
        pg_status,
        redis_status,
        minio_status,
        chroma_status,
        celery_status,
        azure_status,
        openai_status,
    ) = await asyncio.gather(
        _check_postgres(db),
        _check_redis(),
        _check_minio(),
        _check_chromadb(),
        _check_celery(),
        _check_tcp("https://disgen-ocr.cognitiveservices.azure.com"),
        _check_openai(),
    )

    services = {
        "postgres": pg_status,
        "redis": redis_status,
        "minio": minio_status,
        "chromadb": chroma_status,
        "celery": celery_status,
        "azure_document_intelligence": azure_status,
        "openai": openai_status,
    }

    uptime = (datetime.now(timezone.utc) - _started_at).total_seconds()

    return HealthResponse(
        overall=_overall_status(services),
        uptime_seconds=round(uptime, 1),
        services=services,
    )


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("admin", "super_admin")),
) -> AnalyticsResponse:
    """Aggregated usage statistics for the last 30 days of uploads plus all-time totals."""
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    # Run independent aggregate queries concurrently
    (
        total_result,
        approved_result,
        confidence_result,
        status_result,
        scheme_result,
        uploads_result,
    ) = await asyncio.gather(
        db.execute(
            select(func.count(Document.id))
            .where(Document.deleted_at.is_(None))
        ),
        db.execute(
            select(func.count(GeneratedSummary.id))
            .where(GeneratedSummary.status == "approved")
        ),
        db.execute(
            select(func.avg(Document.ocr_confidence))
            .where(Document.deleted_at.is_(None))
            .where(Document.ocr_confidence.is_not(None))
        ),
        db.execute(
            select(Document.status, func.count(Document.id).label("cnt"))
            .where(Document.deleted_at.is_(None))
            .group_by(Document.status)
        ),
        db.execute(
            select(GeneratedSummary.scheme, func.count(GeneratedSummary.id).label("cnt"))
            .group_by(GeneratedSummary.scheme)
        ),
        db.execute(
            select(
                cast(Document.created_at, SADate).label("upload_date"),
                func.count(Document.id).label("cnt"),
            )
            .where(Document.deleted_at.is_(None))
            .where(Document.created_at >= thirty_days_ago)
            .group_by("upload_date")
            .order_by("upload_date")
        ),
    )

    avg_conf = confidence_result.scalar_one_or_none()

    return AnalyticsResponse(
        documents_total=total_result.scalar_one(),
        summaries_approved=approved_result.scalar_one(),
        avg_ocr_confidence=round(float(avg_conf), 4) if avg_conf is not None else None,
        uploads_by_date=[
            {"date": str(row.upload_date), "count": row.cnt}
            for row in uploads_result.all()
        ],
        status_distribution={row.status: row.cnt for row in status_result.all()},
        scheme_distribution={row.scheme: row.cnt for row in scheme_result.all()},
    )


@router.get("/users", response_model=UserListResponse)
async def list_doctors(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    active_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(require_role("admin")),
) -> UserListResponse:
    """List all doctor accounts. Admin only."""
    base = select(User).where(User.role == "doctor")
    if active_only:
        base = base.where(User.is_active.is_(True))

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    offset = (page - 1) * per_page
    rows = await db.execute(base.order_by(User.created_at.desc()).offset(offset).limit(per_page))

    return UserListResponse(
        users=[_user_to_response(u) for u in rows.scalars().all()],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_doctor(
    body: CreateDoctorRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin")),
) -> UserResponse:
    """Create a new doctor account. Admin only."""
    # Username uniqueness
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{body.username}' is already taken.",
        )

    # Email uniqueness
    existing_email = await db.execute(select(User).where(User.email == body.email))
    if existing_email.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists.",
        )

    new_user = User(
        username=body.username,
        full_name=body.full_name,
        email=body.email,
        hashed_password=hash_password(body.password),
        role="doctor",
        is_active=True,
        created_by=user.id,
    )
    db.add(new_user)
    await db.flush()  # materialise PK before audit log FK

    db.add(AuditLog(
        user_id=user.id,
        username=user.username,
        role=user.role,
        action="USER_CREATE",
        target_user_id=new_user.id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("User-Agent"),
        details={"created_username": body.username, "role": "doctor"},
    ))
    await db.commit()
    await db.refresh(new_user)

    logger.info("Doctor account '%s' created by admin '%s'", body.username, user.username)
    return _user_to_response(new_user)


@router.post("/users/{target_id}/deactivate", response_model=UserResponse)
async def deactivate_doctor(
    target_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin")),
) -> UserResponse:
    """
    Deactivate a doctor account. Admin only.

    Deactivating sets is_active=False. The user's existing JWT access tokens
    remain structurally valid but are rejected by get_current_user on every
    subsequent request because `user.is_active` is checked there.

    Admins may only deactivate doctor-role accounts — not other admins or
    super admins.
    """
    result = await db.execute(select(User).where(User.id == target_id))
    target = result.scalar_one_or_none()

    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if target.role != "doctor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admins may only deactivate doctor accounts.",
        )

    if target.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    if not target.is_active:
        # Idempotent — already inactive, return current state without re-auditing
        return _user_to_response(target)

    target.is_active = False

    db.add(AuditLog(
        user_id=user.id,
        username=user.username,
        role=user.role,
        action="USER_DEACTIVATE",
        target_user_id=target.id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("User-Agent"),
        details={"deactivated_username": target.username},
    ))
    await db.commit()
    await db.refresh(target)

    logger.info("Doctor '%s' deactivated by admin '%s'", target.username, user.username)
    return _user_to_response(target)
