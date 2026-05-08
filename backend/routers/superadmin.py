"""
Super Admin endpoints.

User management (all roles):
  GET    /superadmin/users                     List all users (paginated, filterable)
  POST   /superadmin/users                     Create admin or doctor account
  PUT    /superadmin/users/{id}                Update user fields (name, email, role, active)
  POST   /superadmin/users/{id}/deactivate     Deactivate + revoke all sessions
  POST   /superadmin/users/{id}/activate       Re-activate a user
  POST   /superadmin/users/{id}/reset-password Reset password + revoke all sessions
  GET    /superadmin/users/{id}/sessions       List active refresh-token sessions
  DELETE /superadmin/users/{id}/sessions       Revoke all active sessions

Hospital configuration (singleton, id=1):
  GET /superadmin/hospital
  PUT /superadmin/hospital

DPDP retention policy (singleton, id=1):
  GET /superadmin/retention
  PUT /superadmin/retention

Access rules:
  - All endpoints restricted to super_admin role.
  - Super Admin cannot change their own role or deactivate their own account.
  - Role may only be set to "admin" or "doctor" — "super_admin" is never settable via API.
  - Initial Super Admin is created via docker exec CLI; there is no API route for it.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import require_role
from auth.password import hash_password
from auth.service import (
    client_ip as _client_ip,
    get_active_sessions,
    revoke_all_sessions,
)
from database import get_db
from models.audit import AuditLog
from models.compliance import HospitalConfig, RetentionSettings
from models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/superadmin", tags=["Super Admin"])

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_SETTABLE_ROLES: frozenset[str] = frozenset({"admin", "doctor"})


# ── Pydantic schemas ───────────────────────────────────────────────────────────


class UserResponse(BaseModel):
    id: str
    username: str
    full_name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    last_login: datetime | None
    failed_attempts: int
    locked_until: datetime | None


class UserListResponse(BaseModel):
    users: list[UserResponse]
    total: int
    page: int
    per_page: int


class CreateUserRequest(BaseModel):
    username: str
    full_name: str
    email: EmailStr
    password: str
    role: str  # "admin" or "doctor" only

    @field_validator("username")
    @classmethod
    def _username_valid(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) < 3 or len(v) > 50:
            raise ValueError("username must be 3–50 characters")
        if not re.match(r"^[A-Za-z0-9_]+$", v):
            raise ValueError("username may only contain letters, digits, and underscores")
        return v.lower()

    @field_validator("full_name")
    @classmethod
    def _fullname_valid(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 255:
            raise ValueError("full_name must be 1–255 characters")
        return v

    @field_validator("password")
    @classmethod
    def _password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str) -> str:
        if v not in _SETTABLE_ROLES:
            raise ValueError("role must be 'admin' or 'doctor'")
        return v


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    role: str | None = None
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def _fullname_valid(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v or len(v) > 255:
                raise ValueError("full_name must be 1–255 characters")
        return v

    @field_validator("role")
    @classmethod
    def _role_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in _SETTABLE_ROLES:
            raise ValueError("role must be 'admin' or 'doctor'")
        return v


class ResetPasswordRequest(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _pw_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("new_password must be at least 8 characters")
        return v


class SessionInfo(BaseModel):
    jti: str
    expires_at: datetime


class SessionListResponse(BaseModel):
    user_id: str
    sessions: list[SessionInfo]
    count: int


class HospitalConfigResponse(BaseModel):
    name: str
    logo: str | None
    address: str | None
    phone: str | None
    email: str | None
    registration_number: str | None
    gstin: str | None
    default_scheme: str
    pdf_header_color: str
    pdf_accent_color: str
    updated_at: datetime


class HospitalConfigRequest(BaseModel):
    name: str
    logo: str | None = None
    address: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    registration_number: str | None = None
    gstin: str | None = None
    default_scheme: str = "pmjay"
    pdf_header_color: str = "#F97316"
    pdf_accent_color: str = "#EA580C"

    @field_validator("name")
    @classmethod
    def _name_valid(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 500:
            raise ValueError("name must be 1–500 characters")
        return v

    @field_validator("pdf_header_color", "pdf_accent_color")
    @classmethod
    def _color_valid(cls, v: str) -> str:
        if not _HEX_COLOR_RE.match(v):
            raise ValueError("color must be a 6-digit hex value, e.g. #F97316")
        return v.upper()


class RetentionSettingsResponse(BaseModel):
    retention_days: int
    auto_delete: bool
    anonymize_on_expiry: bool
    updated_at: datetime


class RetentionSettingsRequest(BaseModel):
    retention_days: int
    auto_delete: bool
    anonymize_on_expiry: bool

    @field_validator("retention_days")
    @classmethod
    def _days_valid(cls, v: int) -> int:
        if v < 365:
            raise ValueError("retention_days must be at least 365 (one year)")
        return v


# ── Private helpers ────────────────────────────────────────────────────────────


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
        failed_attempts=u.failed_attempts,
        locked_until=u.locked_until,
    )


async def _fetch_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


def _add_audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    request: Request,
    target_user_id: uuid.UUID | None = None,
    details: dict,
) -> None:
    db.add(AuditLog(
        user_id=actor.id,
        username=actor.username,
        role=actor.role,
        action=action,
        target_user_id=target_user_id,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("User-Agent"),
        details=details,
    ))


def _hospital_to_response(cfg: HospitalConfig) -> HospitalConfigResponse:
    return HospitalConfigResponse(
        name=cfg.name,
        logo=cfg.logo,
        address=cfg.address,
        phone=cfg.phone,
        email=cfg.email,
        registration_number=cfg.registration_number,
        gstin=cfg.gstin,
        default_scheme=cfg.default_scheme,
        pdf_header_color=cfg.pdf_header_color,
        pdf_accent_color=cfg.pdf_accent_color,
        updated_at=cfg.updated_at,
    )


def _retention_to_response(r: RetentionSettings) -> RetentionSettingsResponse:
    return RetentionSettingsResponse(
        retention_days=r.retention_days,
        auto_delete=r.auto_delete,
        anonymize_on_expiry=r.anonymize_on_expiry,
        updated_at=r.updated_at,
    )


# ── User management endpoints ──────────────────────────────────────────────────


@router.get("/users", response_model=UserListResponse)
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    role: str | None = Query(None, description="Filter by role: admin, doctor, super_admin"),
    is_active: bool | None = Query(
        None,
        description="When true: active users only; when false: inactive only; omit for all.",
    ),
    name: str | None = Query(
        None,
        description="Case-insensitive partial match on display name (full name).",
    ),
    db: AsyncSession = Depends(get_db),
    _actor: User = Depends(require_role("super_admin")),
) -> UserListResponse:
    """List all user accounts across all roles."""
    base = select(User)
    if role:
        base = base.where(User.role == role)
    if is_active is True:
        base = base.where(User.is_active.is_(True))
    elif is_active is False:
        base = base.where(User.is_active.is_(False))
    if name is not None and (term := name.strip()):
        pattern = f"%{term}%"
        base = base.where(
            or_(
                User.full_name.ilike(pattern),
                User.username.ilike(pattern),
            )
        )

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
async def create_user(
    body: CreateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> UserResponse:
    """Create an admin or doctor account. Super Admin only."""
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{body.username}' is already taken.",
        )

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
        role=body.role,
        is_active=True,
        created_by=actor.id,
    )
    db.add(new_user)
    await db.flush()  # materialise PK before audit FK

    _add_audit(
        db,
        actor=actor,
        action="USER_CREATE",
        request=request,
        target_user_id=new_user.id,
        details={"created_username": body.username, "role": body.role},
    )
    await db.commit()
    await db.refresh(new_user)

    logger.info("User '%s' (%s) created by super_admin '%s'", body.username, body.role, actor.username)
    return _user_to_response(new_user)


@router.put("/users/{target_id}", response_model=UserResponse)
async def update_user(
    target_id: uuid.UUID,
    body: UpdateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> UserResponse:
    """
    Update a user's full_name, email, role, or active status.

    Cannot set role to 'super_admin'. Cannot modify own account's role or
    active status (prevents self-lockout).
    """
    target = await _fetch_user(db, target_id)
    is_self = target.id == actor.id
    changes: dict = {}

    if body.full_name is not None:
        changes["full_name"] = {"old": target.full_name, "new": body.full_name}
        target.full_name = body.full_name

    if body.email is not None and body.email != target.email:
        existing_email = await db.execute(
            select(User).where(User.email == body.email).where(User.id != target_id)
        )
        if existing_email.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with that email already exists.",
            )
        changes["email"] = {"old": target.email, "new": body.email}
        target.email = body.email

    if body.role is not None and body.role != target.role:
        if is_self:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own role.",
            )
        changes["role"] = {"old": target.role, "new": body.role}
        target.role = body.role

    if body.is_active is not None and body.is_active != target.is_active:
        if is_self and not body.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate your own account.",
            )
        changes["is_active"] = {"old": target.is_active, "new": body.is_active}
        target.is_active = body.is_active

    if not changes:
        return _user_to_response(target)

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        target_user_id=target.id,
        details={"action": "user_update", "username": target.username, "changes": changes},
    )
    await db.commit()
    await db.refresh(target)

    logger.info("User '%s' updated by super_admin '%s': %s", target.username, actor.username, list(changes))
    return _user_to_response(target)


@router.post("/users/{target_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    target_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> UserResponse:
    """
    Deactivate any non-super_admin user and revoke all their active sessions.
    Idempotent — returns current state without re-auditing if already inactive.
    """
    target = await _fetch_user(db, target_id)

    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account.",
        )

    if target.role == "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot deactivate another Super Admin account.",
        )

    if not target.is_active:
        return _user_to_response(target)

    target.is_active = False
    _add_audit(
        db,
        actor=actor,
        action="USER_DEACTIVATE",
        request=request,
        target_user_id=target.id,
        details={"deactivated_username": target.username, "role": target.role},
    )
    await db.commit()
    await db.refresh(target)

    revoked = await revoke_all_sessions(str(target.id))
    logger.info(
        "User '%s' deactivated by super_admin '%s'; %d session(s) revoked",
        target.username, actor.username, revoked,
    )
    return _user_to_response(target)


@router.post("/users/{target_id}/activate", response_model=UserResponse)
async def activate_user(
    target_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> UserResponse:
    """
    Re-activate a deactivated user and clear any lockout state.
    Idempotent — returns current state without re-auditing if already active.
    """
    target = await _fetch_user(db, target_id)

    if target.is_active and target.locked_until is None:
        return _user_to_response(target)

    target.is_active = True
    target.failed_attempts = 0
    target.locked_until = None

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        target_user_id=target.id,
        details={"action": "user_activate", "username": target.username},
    )
    await db.commit()
    await db.refresh(target)

    logger.info("User '%s' activated by super_admin '%s'", target.username, actor.username)
    return _user_to_response(target)


@router.post("/users/{target_id}/reset-password", response_model=UserResponse)
async def reset_password(
    target_id: uuid.UUID,
    body: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> UserResponse:
    """
    Set a new password for any user and revoke all their active sessions,
    forcing a fresh login with the new credentials.
    """
    target = await _fetch_user(db, target_id)

    target.hashed_password = hash_password(body.new_password)
    # Clear lockout — a password reset is an admin unlock action
    target.failed_attempts = 0
    target.locked_until = None

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        target_user_id=target.id,
        details={"action": "password_reset", "username": target.username},
    )
    await db.commit()
    await db.refresh(target)

    revoked = await revoke_all_sessions(str(target.id))
    logger.info(
        "Password reset for '%s' by super_admin '%s'; %d session(s) revoked",
        target.username, actor.username, revoked,
    )
    return _user_to_response(target)


@router.get("/users/{target_id}/sessions", response_model=SessionListResponse)
async def get_user_sessions(
    target_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _actor: User = Depends(require_role("super_admin")),
) -> SessionListResponse:
    """List active (non-blacklisted) refresh-token sessions for a user."""
    await _fetch_user(db, target_id)  # 404 guard

    raw_sessions = await get_active_sessions(str(target_id))
    sessions = [
        SessionInfo(
            jti=s["jti"],
            expires_at=datetime.fromtimestamp(s["expires_at"], tz=timezone.utc),
        )
        for s in raw_sessions
    ]
    return SessionListResponse(
        user_id=str(target_id),
        sessions=sessions,
        count=len(sessions),
    )


@router.delete("/users/{target_id}/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_sessions(
    target_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
):
    """Revoke all active refresh-token sessions for a user, forcing re-login."""
    target = await _fetch_user(db, target_id)

    revoked = await revoke_all_sessions(str(target_id))

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        target_user_id=target.id,
        details={"action": "sessions_revoked", "username": target.username, "count": revoked},
    )
    await db.commit()

    logger.info(
        "%d session(s) revoked for '%s' by super_admin '%s'",
        revoked, target.username, actor.username,
    )


# ── Hospital configuration ─────────────────────────────────────────────────────


@router.get("/hospital", response_model=HospitalConfigResponse)
async def get_hospital_config(
    db: AsyncSession = Depends(get_db),
    _actor: User = Depends(require_role("super_admin")),
) -> HospitalConfigResponse:
    """Return the hospital configuration singleton."""
    result = await db.execute(select(HospitalConfig).where(HospitalConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Hospital configuration not found — run seed-db.sh to initialise.",
        )
    return _hospital_to_response(cfg)


@router.put("/hospital", response_model=HospitalConfigResponse)
async def update_hospital_config(
    body: HospitalConfigRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> HospitalConfigResponse:
    """Update the hospital configuration singleton."""
    result = await db.execute(select(HospitalConfig).where(HospitalConfig.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Hospital configuration not found — run seed-db.sh to initialise.",
        )

    cfg.name = body.name
    cfg.logo = body.logo
    cfg.address = body.address
    cfg.phone = body.phone
    cfg.email = str(body.email) if body.email else None
    cfg.registration_number = body.registration_number
    cfg.gstin = body.gstin
    cfg.default_scheme = body.default_scheme
    cfg.pdf_header_color = body.pdf_header_color
    cfg.pdf_accent_color = body.pdf_accent_color
    cfg.updated_at = datetime.now(timezone.utc)

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        details={"action": "hospital_config_update", "name": body.name},
    )
    await db.commit()
    await db.refresh(cfg)

    logger.info("Hospital config updated by super_admin '%s'", actor.username)
    return _hospital_to_response(cfg)


# ── DPDP retention settings ────────────────────────────────────────────────────


@router.get("/retention", response_model=RetentionSettingsResponse)
async def get_retention_settings(
    db: AsyncSession = Depends(get_db),
    _actor: User = Depends(require_role("super_admin")),
) -> RetentionSettingsResponse:
    """Return the DPDP retention policy singleton."""
    result = await db.execute(select(RetentionSettings).where(RetentionSettings.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Retention settings not found — run seed-db.sh to initialise.",
        )
    return _retention_to_response(cfg)


@router.put("/retention", response_model=RetentionSettingsResponse)
async def update_retention_settings(
    body: RetentionSettingsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_role("super_admin")),
) -> RetentionSettingsResponse:
    """
    Update the DPDP retention policy.

    retention_days minimum is 365. The DPDP-recommended default is 2555 (7 years).
    Lowering this value will cause the next daily retention run to anonymize or
    delete records that have now exceeded the shorter window.
    """
    result = await db.execute(select(RetentionSettings).where(RetentionSettings.id == 1))
    cfg = result.scalar_one_or_none()
    if cfg is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Retention settings not found — run seed-db.sh to initialise.",
        )

    cfg.retention_days = body.retention_days
    cfg.auto_delete = body.auto_delete
    cfg.anonymize_on_expiry = body.anonymize_on_expiry
    cfg.updated_at = datetime.now(timezone.utc)

    _add_audit(
        db,
        actor=actor,
        action="SETTINGS_CHANGE",
        request=request,
        details={
            "action": "retention_settings_update",
            "retention_days": body.retention_days,
            "auto_delete": body.auto_delete,
            "anonymize_on_expiry": body.anonymize_on_expiry,
        },
    )
    await db.commit()
    await db.refresh(cfg)

    logger.info(
        "Retention settings updated by super_admin '%s': %d days, auto_delete=%s, anonymize=%s",
        actor.username, body.retention_days, body.auto_delete, body.anonymize_on_expiry,
    )
    return _retention_to_response(cfg)
