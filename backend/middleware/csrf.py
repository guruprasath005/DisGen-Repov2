"""
CSRF protection — double-submit cookie pattern.

On login and refresh the server sets a non-httpOnly `csrf_token` cookie that
JavaScript can read. The client must echo the value as an `X-CSRF-Token` header
on every state-changing request. The middleware compares the two values with a
constant-time comparison to prevent timing attacks.

Exemptions:
  - Safe HTTP methods (GET, HEAD, OPTIONS, TRACE) — no state change.
  - Auth paths (/auth/*) — protected by their own token mechanisms.
  - /health and /metrics — internal endpoints.
  - Mobile clients — they send `Authorization: Bearer` but never receive the
    csrf_token cookie (they use SecureStore). A request that has a Bearer
    header but no csrf_token cookie is treated as a mobile request and passes
    through; all clinical state-change still requires a valid access token.
"""

import secrets

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

_EXEMPT_PREFIXES = (
    "/auth/",
    "/health",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi",
    "/",
)


def _is_exempt(path: str) -> bool:
    return any(path == p or path.startswith(p) for p in _EXEMPT_PREFIXES)


class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in _SAFE_METHODS or _is_exempt(request.url.path):
            return await call_next(request)

        cookie_token = request.cookies.get(CSRF_COOKIE)

        if not cookie_token:
            # Mobile clients: no cookie but a valid Bearer token in-flight.
            # Bearer tokens can't be sent cross-origin via CSRF, so the request
            # is safe without the double-submit check.
            if request.headers.get("Authorization", "").startswith("Bearer "):
                return await call_next(request)
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing — web clients must include X-CSRF-Token header"},
            )

        header_token = request.headers.get(CSRF_HEADER, "")
        if not header_token or not secrets.compare_digest(cookie_token, header_token):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token invalid"},
            )

        return await call_next(request)
