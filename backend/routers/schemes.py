"""
Scheme management endpoints.

GET    /schemes                List all schemes (built-in + custom)          All authenticated
GET    /schemes/{id}           Single scheme detail                           All authenticated
POST   /schemes/custom         Create a custom scheme                         Super Admin only
PUT    /schemes/custom/{id}    Full-replace a custom scheme                   Super Admin only
DELETE /schemes/custom/{id}    Delete a custom scheme                         Super Admin only

Business rules:
  - Built-in schemes (is_builtin=True) are read-only — PUT/DELETE are rejected with 403.
  - Custom scheme IDs are lower-case UUID strings.
  - scheme.name must be unique across all schemes (case-insensitive).
  - color must be a valid 6-digit hex string (#RRGGBB).
  - On create/update: rag_chunks (or rules as fallback) are indexed into ChromaDB.
  - On update: the existing ChromaDB collection is replaced before re-seeding.
  - On delete: the ChromaDB collection is removed.
  - All mutations write an audit log entry (SCHEME_CREATE / SCHEME_UPDATE / SCHEME_DELETE).
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_role
from auth.service import client_ip as _client_ip
from database import get_db
from models.audit import AuditLog
from models.scheme import Scheme
from models.user import User
from rag.chromadb import delete_scheme_collection, seed_scheme

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schemes", tags=["Schemes"])

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


# ── Pydantic schemas ───────────────────────────────────────────────────────────


class SchemeFieldItem(BaseModel):
    """A single field descriptor in required_fields or optional_fields."""

    field: str
    label: str
    type: str = "string"
    validation: str | None = None
    hint: str | None = None
    options: list[str] | None = None


class SchemeResponse(BaseModel):
    id: str
    name: str
    label: str
    color: str
    required_fields: list
    optional_fields: list
    rules: list[str]
    pdf_sections: list[str]
    pdf_template: str
    is_builtin: bool
    created_at: datetime
    created_by: str | None


class _SchemeWriteBase(BaseModel):
    """Shared fields and validators for create and update requests."""

    name: str
    label: str
    color: str
    required_fields: list[SchemeFieldItem] = []
    optional_fields: list[SchemeFieldItem] = []
    rules: list[str] = []
    pdf_sections: list[str] = []
    # Indexed into ChromaDB on write; not persisted to the DB.
    # Falls back to `rules` if empty.
    rag_chunks: list[str] = []

    @field_validator("name")
    @classmethod
    def _name_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        if len(v) > 100:
            raise ValueError("name must be at most 100 characters")
        return v

    @field_validator("label")
    @classmethod
    def _label_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("label must not be empty")
        if len(v) > 100:
            raise ValueError("label must be at most 100 characters")
        return v

    @field_validator("color")
    @classmethod
    def _color_valid(cls, v: str) -> str:
        if not _HEX_COLOR_RE.match(v):
            raise ValueError("color must be a 6-digit hex color, e.g. #1A56DB")
        return v.upper()


class CustomSchemeCreate(_SchemeWriteBase):
    pass


class CustomSchemeUpdate(_SchemeWriteBase):
    pass


# ── Private helpers ────────────────────────────────────────────────────────────


def _scheme_to_response(s: Scheme) -> SchemeResponse:
    return SchemeResponse(
        id=s.id,
        name=s.name,
        label=s.label,
        color=s.color,
        required_fields=s.required_fields,
        optional_fields=s.optional_fields,
        rules=s.rules,
        pdf_sections=s.pdf_sections,
        pdf_template=s.pdf_template,
        is_builtin=s.is_builtin,
        created_at=s.created_at,
        created_by=str(s.created_by) if s.created_by else None,
    )


async def _check_name_unique(
    db: AsyncSession,
    name: str,
    exclude_id: str | None = None,
) -> None:
    """Raise 409 if another scheme already uses this name (case-insensitive)."""
    query = select(Scheme).where(func.lower(Scheme.name) == name.lower())
    if exclude_id:
        query = query.where(Scheme.id != exclude_id)
    result = await db.execute(query)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A scheme named '{name}' already exists.",
        )


async def _fetch_custom_scheme(db: AsyncSession, scheme_id: str) -> Scheme:
    """Return the scheme or raise 404. Raises 403 if the scheme is built-in."""
    result = await db.execute(select(Scheme).where(Scheme.id == scheme_id))
    scheme = result.scalar_one_or_none()
    if scheme is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheme not found.")
    if scheme.is_builtin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Built-in schemes are read-only.",
        )
    return scheme


def _index_rag(scheme_id: str, rag_chunks: list[str], rules: list[str]) -> None:
    """
    Seed ChromaDB with rag_chunks (preferred) or rules (fallback).
    Silently no-ops when both are empty.
    """
    chunks = rag_chunks if rag_chunks else rules
    if not chunks:
        return
    try:
        seed_scheme(scheme_id, chunks)
    except Exception:
        logger.exception(
            "ChromaDB indexing failed for scheme '%s' — RAG context will be unavailable",
            scheme_id,
        )


def _add_audit(
    db: AsyncSession,
    *,
    user: User,
    action: str,
    request: Request,
    details: dict,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action=action,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details=details,
        )
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("", response_model=list[SchemeResponse])
async def list_schemes(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[SchemeResponse]:
    """Return all schemes — built-in first, then custom by creation date."""
    result = await db.execute(
        select(Scheme).order_by(Scheme.is_builtin.desc(), Scheme.created_at)
    )
    return [_scheme_to_response(s) for s in result.scalars().all()]


@router.post(
    "/custom",
    response_model=SchemeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_custom_scheme(
    body: CustomSchemeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("super_admin")),
) -> SchemeResponse:
    """Create a new custom scheme and immediately index its rules into ChromaDB."""
    await _check_name_unique(db, body.name)

    scheme_id = str(uuid.uuid4())
    scheme = Scheme(
        id=scheme_id,
        name=body.name,
        label=body.label,
        color=body.color,
        required_fields=[f.model_dump(exclude_none=True) for f in body.required_fields],
        optional_fields=[f.model_dump(exclude_none=True) for f in body.optional_fields],
        rules=body.rules,
        pdf_sections=body.pdf_sections,
        pdf_template="custom.html",
        is_builtin=False,
        created_by=user.id,
    )
    db.add(scheme)
    _add_audit(
        db,
        user=user,
        action="SCHEME_CREATE",
        request=request,
        details={"scheme_id": scheme_id, "name": body.name},
    )
    await db.commit()
    await db.refresh(scheme)

    _index_rag(scheme_id, body.rag_chunks, body.rules)

    logger.info("Custom scheme '%s' (%s) created by %s", body.name, scheme_id, user.username)
    return _scheme_to_response(scheme)


@router.get("/{scheme_id}", response_model=SchemeResponse)
async def get_scheme(
    scheme_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> SchemeResponse:
    """Return a single scheme by ID."""
    result = await db.execute(select(Scheme).where(Scheme.id == scheme_id))
    scheme = result.scalar_one_or_none()
    if scheme is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scheme not found.")
    return _scheme_to_response(scheme)


@router.put("/custom/{scheme_id}", response_model=SchemeResponse)
async def update_custom_scheme(
    scheme_id: str,
    body: CustomSchemeUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("super_admin")),
) -> SchemeResponse:
    """
    Full-replace a custom scheme's definition.

    Also replaces the ChromaDB collection — the old RAG index is deleted and
    rebuilt from the new rag_chunks (or rules if rag_chunks is empty).
    """
    scheme = await _fetch_custom_scheme(db, scheme_id)
    await _check_name_unique(db, body.name, exclude_id=scheme_id)

    old_name = scheme.name
    scheme.name = body.name
    scheme.label = body.label
    scheme.color = body.color
    scheme.required_fields = [f.model_dump(exclude_none=True) for f in body.required_fields]
    scheme.optional_fields = [f.model_dump(exclude_none=True) for f in body.optional_fields]
    scheme.rules = body.rules
    scheme.pdf_sections = body.pdf_sections
    # pdf_template stays "custom.html" — not user-settable

    _add_audit(
        db,
        user=user,
        action="SCHEME_UPDATE",
        request=request,
        details={"scheme_id": scheme_id, "old_name": old_name, "new_name": body.name},
    )
    await db.commit()
    await db.refresh(scheme)

    # Replace ChromaDB collection — delete first so seed_scheme's idempotency
    # guard doesn't skip the re-index.
    delete_scheme_collection(scheme_id)
    _index_rag(scheme_id, body.rag_chunks, body.rules)

    logger.info(
        "Custom scheme '%s' (%s) updated by %s", body.name, scheme_id, user.username
    )
    return _scheme_to_response(scheme)


@router.delete("/custom/{scheme_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_scheme(
    scheme_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("super_admin")),
):
    """
    Permanently delete a custom scheme and its ChromaDB collection.

    Any existing generated summaries that reference this scheme_id are NOT
    deleted — they remain as historical records. Only future generation
    requests using this scheme_id will fail.
    """
    scheme = await _fetch_custom_scheme(db, scheme_id)
    scheme_name = scheme.name

    _add_audit(
        db,
        user=user,
        action="SCHEME_DELETE",
        request=request,
        details={"scheme_id": scheme_id, "name": scheme_name},
    )
    await db.delete(scheme)
    await db.commit()

    delete_scheme_collection(scheme_id)

    logger.info(
        "Custom scheme '%s' (%s) deleted by %s", scheme_name, scheme_id, user.username
    )
