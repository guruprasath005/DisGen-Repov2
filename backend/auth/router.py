"""
Auth endpoints.

POST /auth/login    — bcrypt verify + lockout + rate-limit → RS256 tokens
POST /auth/refresh  — single-use rotation → new pair, old refresh blacklisted
POST /auth/logout   — blacklist both tokens, clear cookie
GET  /auth/me       — return current user info
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from metrics import disgen_auth_failures_total
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.password import verify_password
from auth.service import (
    blacklist_token,
    check_login_rate_limit,
    client_ip,
    create_access_token,
    create_refresh_token,
    decode_token,
    is_blacklisted,
    register_session,
    revoke_all_sessions,
    try_blacklist_token,
    unregister_session,
)
from config import settings
from database import get_db
from models.audit import AuditLog
from models.user import User

router = APIRouter(prefix="/auth", tags=["Auth"])

_REFRESH_COOKIE = "refresh_token"
_CSRF_COOKIE = "csrf_token"
_COOKIE_MAX_AGE = settings.jwt_refresh_token_expire_days * 86400
_LOCKOUT_ATTEMPTS = 5
_LOCKOUT_BASE_MINUTES = 15   # lockout = base * 2^(attempts-threshold), capped at 24 h
_LOCKOUT_MAX_MINUTES = 1440  # 24 hours


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None  # populated for mobile clients; None for web (cookie used instead)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None  # mobile sends token here; web relies on cookie


class UserResponse(BaseModel):
    id: str
    username: str
    full_name: str
    email: str
    role: str
    hospital_id: str


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )


def _set_csrf_cookie(response: Response) -> None:
    """Set a non-httpOnly CSRF token that JS reads and sends back as X-CSRF-Token."""
    token = secrets.token_hex(32)
    response.set_cookie(
        key=_CSRF_COOKIE,
        value=token,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    ip = client_ip(request)

    if await check_login_rate_limit(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — try again in 60 seconds",
        )

    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    # ── Determine failure before touching DB state ────────────────────────────
    failed = False
    fail_reason = ""

    if not user or not user.is_active:
        failed = True
        fail_reason = "user not found or inactive"
    elif user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Account locked until {user.locked_until.isoformat()}",
        )
    elif not verify_password(body.password, user.hashed_password):
        failed = True
        fail_reason = "wrong password"

    if failed:
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= _LOCKOUT_ATTEMPTS:
                exp = user.failed_attempts - _LOCKOUT_ATTEMPTS
                minutes = min(_LOCKOUT_BASE_MINUTES * (2 ** exp), _LOCKOUT_MAX_MINUTES)
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=minutes)
                db.add(
                    AuditLog(
                        user_id=user.id,
                        username=user.username,
                        role=user.role,
                        action="ACCOUNT_LOCKED",
                        ip_address=ip,
                        user_agent=request.headers.get("User-Agent"),
                        details={"failed_attempts": user.failed_attempts, "lockout_minutes": minutes},
                    )
                )
        db.add(
            AuditLog(
                user_id=user.id if user else None,
                username=body.username,
                role=user.role if user else "unknown",
                action="LOGIN_FAILED",
                ip_address=ip,
                user_agent=request.headers.get("User-Agent"),
                details={"reason": fail_reason},
            )
        )
        # Commit audit entry before raising — get_db will rollback an empty tx
        await db.flush()
        await db.commit()
        disgen_auth_failures_total.inc()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # ── Success ───────────────────────────────────────────────────────────────
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login = datetime.now(timezone.utc)
    db.add(
        AuditLog(
            user_id=user.id,
            username=user.username,
            role=user.role,
            action="LOGIN",
            ip_address=ip,
            user_agent=request.headers.get("User-Agent"),
        )
    )

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    _set_refresh_cookie(response, refresh_token)
    _set_csrf_cookie(response)

    # Track the new refresh token so Super Admin can enumerate/revoke sessions
    rp = decode_token(refresh_token)
    await register_session(str(user.id), rp["jti"], rp["exp"])

    # Return refresh token in body so mobile clients can store it in secure storage.
    # Web clients use the httpOnly cookie and ignore this field.
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest = RefreshRequest(),
    db: AsyncSession = Depends(get_db),
):
    # Mobile sends token in request body; web sends it via httpOnly cookie.
    raw = body.refresh_token or request.cookies.get(_REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    try:
        payload = decode_token(raw)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")

    jti = payload.get("jti")
    exp = payload.get("exp")

    # Atomically check-and-blacklist. On reuse, revoke every session for this
    # user — a reused token means either the client retried or the token was
    # stolen; either way, force re-login for all sessions.
    reuse_detected = await try_blacklist_token(jti, exp)
    if reuse_detected:
        user_id_str = payload.get("sub", "")
        if user_id_str:
            await revoke_all_sessions(user_id_str)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token already used")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    new_access = create_access_token(user)
    new_refresh = create_refresh_token(user)
    _set_refresh_cookie(response, new_refresh)
    _set_csrf_cookie(response)

    # Rotate session tracking — remove old JTI, register the replacement
    user_id_str = payload["sub"]
    await unregister_session(user_id_str, jti)
    nrp = decode_token(new_refresh)
    await register_session(user_id_str, nrp["jti"], nrp["exp"])

    return TokenResponse(access_token=new_access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    body: RefreshRequest = RefreshRequest(),
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
):
    audit_user_id: uuid.UUID | None = None
    audit_username: str | None = None
    audit_role: str | None = None

    # Blacklist access token if present and valid; capture identity for audit
    if credentials:
        try:
            payload = decode_token(credentials.credentials)
            await blacklist_token(payload["jti"], payload["exp"])
            audit_user_id = uuid.UUID(payload["sub"])
            audit_username = payload.get("username")
            audit_role = payload.get("role")
        except (JWTError, KeyError):
            pass

    # Blacklist refresh token if present and valid, and remove session record.
    # Mobile sends token in body; web sends via cookie.
    raw = body.refresh_token or request.cookies.get(_REFRESH_COOKIE)
    if raw:
        try:
            payload = decode_token(raw)
            await blacklist_token(payload["jti"], payload["exp"])
            await unregister_session(payload["sub"], payload["jti"])
        except (JWTError, KeyError):
            pass

    response.delete_cookie(_REFRESH_COOKIE, path="/")
    response.delete_cookie(_CSRF_COOKIE, path="/")

    if audit_username:
        db.add(AuditLog(
            user_id=audit_user_id,
            username=audit_username,
            role=audit_role or "unknown",
            action="LOGOUT",
            ip_address=client_ip(request),
            user_agent=request.headers.get("User-Agent"),
            details={},
        ))
        await db.commit()


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=str(user.id),
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role=user.role,
        hospital_id=settings.hospital_id,
    )
