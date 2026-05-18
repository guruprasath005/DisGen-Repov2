"""
RS256 JWT creation/validation and Redis blacklist operations.

Token layout:
  access  — RS256, 15 min, {sub, username, role, hospital_id, jti, type, iat, exp}
  refresh — RS256,  7 days, {sub, jti, type, iat, exp}

Blacklist key: blacklist:{jti}  TTL = remaining token lifetime (seconds)
Rate-limit key: ratelimit:login:{ip}  TTL = 60 s, counter <= 5
"""

import uuid
from datetime import datetime, timezone, timedelta

import redis.asyncio as aioredis
from fastapi import Request
from jose import jwt
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from metrics import disgen_active_sessions


def client_ip(request: Request) -> str:
    """
    Return the real client IP, preferring the X-Real-IP header set by nginx.

    Behind the nginx reverse proxy `request.client.host` is always the nginx
    container's address; the actual client IP is forwarded in `X-Real-IP`.
    The result is truncated to 45 chars to fit the `audit_logs.ip_address`
    column (full IPv6 length).
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    return ip[:45]


ALGORITHM = "RS256"

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _private_key() -> str:
    with open(settings.jwt_private_key_path) as f:
        return f.read()


def _public_key() -> str:
    with open(settings.jwt_public_key_path) as f:
        return f.read()


def create_access_token(user) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "hospital_id": settings.hospital_id,
        "jti": str(uuid.uuid4()),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
    }
    return jwt.encode(payload, _private_key(), algorithm=ALGORITHM)


def create_refresh_token(user, family_id: uuid.UUID | None = None) -> str:
    now = datetime.now(timezone.utc)
    fid = family_id or uuid.uuid4()
    payload = {
        "sub": str(user.id),
        "jti": str(uuid.uuid4()),
        "family_id": str(fid),
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_refresh_token_expire_days),
    }
    return jwt.encode(payload, _private_key(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and verify an RS256 token. Raises jose.JWTError on failure."""
    return jwt.decode(token, _public_key(), algorithms=[ALGORITHM])


async def blacklist_token(jti: str, exp_timestamp: int) -> None:
    ttl = int(exp_timestamp - datetime.now(timezone.utc).timestamp())
    if ttl > 0:
        await _get_redis().setex(f"blacklist:{jti}", ttl, "1")


async def is_blacklisted(jti: str) -> bool:
    return await _get_redis().exists(f"blacklist:{jti}") == 1


# Lua script: atomically check-and-set the blacklist key in one round-trip.
# Returns 1 if the key already existed (reuse detected), 0 if newly set.
_BLACKLIST_LUA = """\
if redis.call('exists', KEYS[1]) == 1 then
    return 1
end
redis.call('setex', KEYS[1], ARGV[1], '1')
return 0
"""


async def try_blacklist_token(jti: str, exp_timestamp: int) -> bool:
    """
    Atomically check and blacklist a refresh token JTI.

    Returns True  — token was already blacklisted (reuse attack detected).
    Returns False — token was fresh; successfully blacklisted for the first time.

    Uses a Lua script so the check-then-set is a single atomic Redis operation,
    closing the race window that exists when is_blacklisted() + blacklist_token()
    are called as two separate commands.
    """
    ttl = int(exp_timestamp - datetime.now(timezone.utc).timestamp())
    if ttl <= 0:
        return False
    result = await _get_redis().eval(
        _BLACKLIST_LUA, 1, f"blacklist:{jti}", str(ttl)
    )
    return int(result) == 1


async def check_login_rate_limit(ip: str) -> bool:
    """Return True if this IP has exceeded 5 login attempts in the last 60 seconds."""
    key = f"ratelimit:login:{ip}"
    r = _get_redis()
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, 60)
    return count > 5


# ── Session tracking ──────────────────────────────────────────────────────────
#
# Key pattern: user_sessions:{user_id}:{refresh_jti} → exp_unix_timestamp
# TTL on each key matches the refresh token's remaining lifetime so keys
# self-expire without any cleanup job.  Used by Super Admin to enumerate and
# revoke active sessions without touching the JWTs themselves.


async def register_session(user_id: str, refresh_jti: str, exp: int) -> None:
    """Record an active refresh token for a user."""
    ttl = int(exp - datetime.now(timezone.utc).timestamp())
    if ttl > 0:
        await _get_redis().setex(f"user_sessions:{user_id}:{refresh_jti}", ttl, str(exp))
        disgen_active_sessions.inc()


async def unregister_session(user_id: str, refresh_jti: str) -> None:
    """Remove a single refresh token from the user's active session record."""
    deleted = await _get_redis().delete(f"user_sessions:{user_id}:{refresh_jti}")
    if deleted:
        disgen_active_sessions.dec()


async def get_active_sessions(user_id: str) -> list[dict]:
    """
    Return all tracked, non-blacklisted refresh tokens for a user.
    Each entry: {"jti": str, "expires_at": int (unix timestamp)}.
    """
    r = _get_redis()
    sessions: list[dict] = []
    async for key in r.scan_iter(f"user_sessions:{user_id}:*"):
        exp_str = await r.get(key)
        jti = key.rsplit(":", 1)[-1]
        if exp_str and not await is_blacklisted(jti):
            sessions.append({"jti": jti, "expires_at": int(exp_str)})
    return sessions


async def revoke_all_sessions(user_id: str) -> int:
    """
    Blacklist every active refresh token for a user and clear the session keys.
    Returns the number of sessions revoked.
    """
    r = _get_redis()
    to_delete: list[str] = []
    count = 0
    async for key in r.scan_iter(f"user_sessions:{user_id}:*"):
        exp_str = await r.get(key)
        jti = key.rsplit(":", 1)[-1]
        if exp_str:
            await blacklist_token(jti, int(exp_str))
            count += 1
        to_delete.append(key)
    if to_delete:
        await r.delete(*to_delete)
    if count > 0:
        disgen_active_sessions.dec(count)
    return count


# ── TOTP setup token (Fix 5) ─────────────────────────────────────────────────


def create_setup_token(user) -> str:
    """Short-lived scoped JWT accepted only by the TOTP setup endpoints."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "jti": str(uuid.uuid4()),
        "type": "access",
        "scope": "totp-setup",
        "iat": now,
        "exp": now + timedelta(minutes=10),
    }
    return jwt.encode(payload, _private_key(), algorithm=ALGORITHM)


# ── DB-backed refresh token operations (Fix 4) ────────────────────────────────


async def persist_refresh_token(
    db: AsyncSession,
    *,
    jti: str,
    user_id: uuid.UUID,
    family_id: uuid.UUID,
    expires_at: datetime,
    created_ip: str | None = None,
    created_ua: str | None = None,
) -> None:
    """Write a new refresh token record to the DB (authoritative store)."""
    from models.refresh_token import RefreshToken

    token = RefreshToken(
        jti=uuid.UUID(jti),
        user_id=user_id,
        family_id=family_id,
        expires_at=expires_at,
        created_ip=created_ip,
        created_ua=created_ua,
    )
    db.add(token)
    await db.flush()


async def revoke_family(
    db: AsyncSession,
    family_id: uuid.UUID,
    reason: str = "reuse",
) -> int:
    """
    Revoke every non-revoked token in a refresh token family.

    On reuse detection only the compromised login session is killed, not all
    user sessions. Returns the number of tokens revoked.
    """
    from models.refresh_token import RefreshToken

    result = await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(
            revoked_at=datetime.now(timezone.utc),
            revoke_reason=reason,
        )
        .returning(RefreshToken.jti, RefreshToken.expires_at)
    )
    rows = result.fetchall()
    for jti, exp in rows:
        await blacklist_token(str(jti), int(exp.timestamp()))
    return len(rows)


async def is_token_revoked_in_db(db: AsyncSession, jti: str) -> bool:
    """Authoritative DB check — used when Redis cache misses."""
    from sqlalchemy import select
    from models.refresh_token import RefreshToken

    result = await db.execute(
        select(RefreshToken.revoked_at).where(RefreshToken.jti == uuid.UUID(jti))
    )
    row = result.fetchone()
    if row is None:
        return True  # not found in DB — treat as revoked (fail closed)
    return row[0] is not None
