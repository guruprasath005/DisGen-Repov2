"""
Rate limiting — two layers:

  1. GlobalRateLimitMiddleware  — per-IP, 300 req/min, applied in main.py
  2. RateLimiter                — per-authenticated-user dependency factory,
                                  used on individual routers/endpoints

Redis key schema:
  ratelimit:global:{ip}          → request count (TTL = window_seconds)
  ratelimit:{scope}:{user_id}    → request count (TTL = window_seconds)
"""

from fastapi import Depends, HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

import redis.asyncio as aioredis

from auth.dependencies import get_current_user
from config import settings
from models.user import User


def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.redis_url, decode_responses=True)


# ── Global per-IP middleware ───────────────────────────────────────────────────

_GLOBAL_LIMIT = 300
_GLOBAL_WINDOW = 60


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    """
    Blocks a single IP after 300 requests/minute.
    Excludes /health and /metrics so monitoring probes are never throttled.
    """

    _EXEMPT = {"/health", "/metrics"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in self._EXEMPT:
            return await call_next(request)

        ip = request.client.host if request.client else "unknown"
        key = f"ratelimit:global:{ip}"

        redis: aioredis.Redis = _get_redis()
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, _GLOBAL_WINDOW)

            if count > _GLOBAL_LIMIT:
                return Response(
                    content='{"detail":"Too many requests"}',
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(_GLOBAL_WINDOW)},
                )
        except Exception:
            # Redis unavailable — fail open rather than blocking all traffic
            pass

        return await call_next(request)


# ── Per-user dependency factory ────────────────────────────────────────────────


def RateLimiter(scope: str, limit: int, window: int = 60):
    """
    Returns a FastAPI dependency that enforces `limit` requests per `window`
    seconds, keyed by authenticated user.

    FastAPI caches get_current_user per-request, so declaring it here does
    NOT cause an extra DB round-trip when the endpoint also uses it.

    Usage:
        @router.get("/expensive")
        async def endpoint(
            _rl: None = RateLimiter("pdf_download", limit=10),
            user: User = Depends(require_role("doctor")),
        ): ...
    """

    async def _check(user: User = Depends(get_current_user)) -> None:
        key = f"ratelimit:{scope}:{user.id}"
        redis: aioredis.Redis = _get_redis()
        try:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, window)

            if count > limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded — max {limit} per {window}s",
                    headers={"Retry-After": str(window)},
                )
        except HTTPException:
            raise
        except Exception:
            # Redis unavailable — fail open
            pass

    return Depends(_check)
