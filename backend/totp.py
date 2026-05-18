"""
RFC 6238 TOTP (6-digit, 30-second window, HMAC-SHA1, Base-32 secret).

Secrets are stored encrypted in the DB. Encrypt before write, decrypt before verify.
"""

import pyotp

ISSUER = "DisGen"


def generate_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=ISSUER)


def verify_code(secret: str, code: str) -> bool:
    """Verify a TOTP code with ±1 window tolerance for clock skew."""
    return pyotp.TOTP(secret).verify(code, valid_window=1)
