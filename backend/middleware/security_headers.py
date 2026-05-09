from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Injects standard defensive HTTP headers on every response."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Prevent MIME-type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Deny framing — blocks clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Force HTTPS for 1 year, include subdomains
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains; preload"
        )

        # No referrer info sent cross-origin
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Restrict browser features not needed by a medical API
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )

        # Conservative CSP — API only, no HTML rendering
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )

        # Remove server fingerprint
        for h in ("server", "x-powered-by"):
            if h in response.headers:
                del response.headers[h]

        return response
