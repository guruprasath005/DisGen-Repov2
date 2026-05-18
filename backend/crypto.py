"""
AES-256-GCM field encryption with key versioning for PHI storage.

New wire format:  v{keyId}:{base64(nonce[12] | ciphertext+tag)}
Legacy format:    {base64(nonce[12] | ciphertext+tag)}   (no version prefix)

Key rotation workflow:
  1. Generate new key: openssl rand -base64 32
  2. Set FIELD_ENCRYPTION_KEY_ID=2, FIELD_ENCRYPTION_KEY=<new_key>
  3. Move old key to FIELD_ENCRYPTION_KEYS_OLD={"1":"<old_key>"}
  4. Run scripts/rotate_encryption_key.py --apply to rewrite old rows
  5. Once walker reports zero rows with key ID 1, remove it from KEYS_OLD
"""

import base64
import json
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class TamperDetectedError(Exception):
    """Raised when GCM tag verification fails — ciphertext was modified."""


def _decode_key(b64: str) -> bytes:
    key = base64.b64decode(b64 + "==")
    if len(key) != 32:
        raise RuntimeError(f"Encryption key must be 32 bytes (got {len(key)})")
    return key


def _active_key_id() -> str:
    return os.environ.get("FIELD_ENCRYPTION_KEY_ID", "1")


def _active_key() -> bytes:
    raw = os.environ.get("FIELD_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("FIELD_ENCRYPTION_KEY environment variable is not set")
    return _decode_key(raw)


def _keyring() -> dict[str, bytes]:
    """Active key plus all retired keys, indexed by their ID."""
    ring: dict[str, bytes] = {_active_key_id(): _active_key()}
    old = os.environ.get("FIELD_ENCRYPTION_KEYS_OLD", "")
    if old:
        for kid, b64 in json.loads(old).items():
            ring[kid] = _decode_key(b64)
    return ring


def encrypt(plaintext: str) -> str:
    """Encrypt plaintext -> versioned ciphertext string."""
    key_id = _active_key_id()
    aesgcm = AESGCM(_active_key())
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    blob = base64.b64encode(nonce + ct).decode("ascii")
    return f"v{key_id}:{blob}"


def decrypt(token: str) -> str:
    """Decrypt a versioned or legacy ciphertext string."""
    ring = _keyring()
    if token.startswith("v") and ":" in token:
        key_id, blob = token[1:].split(":", 1)
        key_bytes = ring.get(key_id)
        if not key_bytes:
            raise RuntimeError(f"Encryption key id '{key_id}' not found in keyring")
        return _decrypt_blob(blob, key_bytes)
    else:
        # Legacy format — no version prefix; try every key in the ring
        for key_bytes in ring.values():
            try:
                return _decrypt_blob(token, key_bytes)
            except (TamperDetectedError, ValueError):
                continue
        raise TamperDetectedError("Legacy ciphertext did not decrypt under any known key")


def _decrypt_blob(blob: str, key_bytes: bytes) -> str:
    aesgcm = AESGCM(key_bytes)
    try:
        data = base64.b64decode(blob)
    except Exception as exc:
        raise ValueError("Ciphertext is not valid base64") from exc
    if len(data) < 28:
        raise ValueError("Ciphertext too short")
    try:
        return aesgcm.decrypt(data[:12], data[12:], None).decode("utf-8")
    except InvalidTag as exc:
        raise TamperDetectedError("GCM tag verification failed") from exc


def safe_decrypt(token: str | None) -> str | None:
    """Decrypt; return None if token is None. Return token as-is if plaintext legacy row."""
    if not token:
        return None
    try:
        return decrypt(token)
    except Exception:
        return token  # plaintext legacy row — return as-is
