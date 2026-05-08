"""
AES-256-GCM field encryption for PHI storage.

Wire-format: base64( nonce[12] | ciphertext | tag[16] )
The `cryptography` library's AESGCM appends the 16-byte GCM tag to ciphertext
automatically, so decryption only needs to split off the nonce.

All structured clinical data goes through encrypt() before any DB write,
and decrypt() before any application use. If the ciphertext has been tampered
with, AESGCM raises InvalidTag which we re-raise as TamperDetectedError.
"""

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class TamperDetectedError(Exception):
    """Raised when GCM tag verification fails — ciphertext was modified."""


def _load_key() -> bytes:
    raw = os.getenv("FIELD_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("FIELD_ENCRYPTION_KEY environment variable is not set")
    try:
        key = base64.b64decode(raw + "==")  # tolerant padding
    except Exception as exc:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not valid base64") from exc
    if len(key) != 32:
        raise RuntimeError(
            f"FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (got {len(key)})"
        )
    return key


# Cache the derived key so the env var is only read and decoded once per process.
_cached_key: bytes | None = None


def _get_key() -> bytes:
    global _cached_key
    if _cached_key is None:
        _cached_key = _load_key()
    return _cached_key


def encrypt(plaintext: str) -> str:
    """Encrypt plaintext string → base64(nonce | ciphertext+tag)."""
    aesgcm = AESGCM(_get_key())
    nonce = os.urandom(12)  # 96-bit random nonce — never reuse
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext_with_tag).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt base64(nonce | ciphertext+tag) → plaintext string."""
    aesgcm = AESGCM(_get_key())
    try:
        data = base64.b64decode(token)
    except Exception as exc:
        raise ValueError("Ciphertext is not valid base64") from exc
    if len(data) < 28:  # 12-byte nonce + at least 16-byte tag
        raise ValueError("Ciphertext is too short to be valid")
    nonce = data[:12]
    ciphertext_with_tag = data[12:]
    try:
        plaintext_bytes = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    except InvalidTag as exc:
        raise TamperDetectedError(
            "GCM tag verification failed — ciphertext integrity compromised"
        ) from exc
    return plaintext_bytes.decode("utf-8")
