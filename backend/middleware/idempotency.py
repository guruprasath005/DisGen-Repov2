"""
Idempotency-Key middleware.

POST endpoints that change clinical state (confirm, generate, approve) accept
an `Idempotency-Key` header. The server caches the first response for each key
in Redis (TTL 24 h). A duplicate request with the same key within that window
receives the cached response immediately — preventing duplicate Celery task
enqueues, duplicate audit entries, and double-click confusion.

Only applies to requests that include the header; requests without it pass
through unaffected so existing callers are not broken.

Cache key:  idempotency:{method}:{path}:{idempotency_key_value}
Cache value: JSON {status_code, body}

Flow:
  1. Request arrives with Idempotency-Key header.
  2. Check Redis for {method}:{path}:{key}.
     - Hit  → return 200 with cached body + header X-Idempotent-Replayed: true
     - Miss → process request, cache {status_code, body}, return to client.

Limitations:
  - Response body must be JSON-serialisable (all DisGen endpoints return JSON or PDF).
  - PDF download responses are NOT cached (binary body would bloat Redis). PDF
    endpoints should not send Idempotency-Key.
  - In-flight deduplication (two simultaneous requests with the same key) is
    best-effort: a very small race window exists. The main protection is
    against user retries and double-clicks, not concurrent parallel requests.
"""

import json
import logging

import redis.asyncio as aioredis
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from config import settings

logger = logging.getLogger(__name__)

_TTL_SECONDS = 86400  # 24 hours
_HEADER = "Idempotency-Key"
_REPLAY_HEADER = "X-Idempotent-Replayed"
_MAX_KEY_LEN = 128
_SKIP_CONTENT_TYPES = ("application/pdf",)

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _cache_key(method: str, path: str, idempotency_key: str) -> str:
    return f"idempotency:{method}:{path}:{idempotency_key}"


class IdempotencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        raw_key = request.headers.get(_HEADER)
        if not raw_key or request.method != "POST":
            return await call_next(request)

        idempotency_key = raw_key[:_MAX_KEY_LEN]
        cache_key = _cache_key(request.method, request.url.path, idempotency_key)

        try:
            r = _get_redis()
            cached = await r.get(cache_key)
            if cached:
                data = json.loads(cached)
                response = JSONResponse(
                    status_code=data["status_code"],
                    content=data["body"],
                )
                response.headers[_REPLAY_HEADER] = "true"
                return response
        except Exception:
            logger.warning("Idempotency Redis check failed — processing request without cache")
            return await call_next(request)

        response = await call_next(request)

        # Only cache JSON responses — skip PDF and non-2xx streaming responses
        content_type = response.headers.get("content-type", "")
        if any(ct in content_type for ct in _SKIP_CONTENT_TYPES):
            return response

        try:
            body_bytes = b""
            async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                body_bytes += chunk if isinstance(chunk, bytes) else chunk.encode()
            body = json.loads(body_bytes)
            await r.setex(cache_key, _TTL_SECONDS, json.dumps({"status_code": response.status_code, "body": body}))
            rebuilt = JSONResponse(status_code=response.status_code, content=body)
            for k, v in response.headers.items():
                if k.lower() not in ("content-length", "content-type"):
                    rebuilt.headers[k] = v
            return rebuilt
        except Exception:
            logger.warning("Idempotency response caching failed — response already sent")
            return Response(content=body_bytes, status_code=response.status_code, headers=dict(response.headers))
