"""
Unit tests for AES-256-GCM field encryption (crypto.py).

No DB, no network — pure cryptographic round-trip verification.
"""

import base64
import os

import pytest

from crypto import TamperDetectedError, decrypt, encrypt


def test_roundtrip_plain_string():
    plaintext = "Patient: John Doe, UHID: U123456"
    assert decrypt(encrypt(plaintext)) == plaintext


def test_roundtrip_unicode():
    plaintext = "நோயாளி பெயர்: ராஜன்"
    assert decrypt(encrypt(plaintext)) == plaintext


def test_roundtrip_empty_string():
    assert decrypt(encrypt("")) == ""


def test_roundtrip_json():
    plaintext = '{"patient_name": "Jane", "uhid": "U999", "diagnosis": "Fever"}'
    assert decrypt(encrypt(plaintext)) == plaintext


def test_unique_ciphertexts_per_call():
    # Random 96-bit nonce means two encryptions of the same plaintext differ.
    ct1 = encrypt("same text")
    ct2 = encrypt("same text")
    assert ct1 != ct2


def test_tamper_detection_flipped_byte():
    ct = encrypt("sensitive PHI data")
    raw = bytearray(base64.b64decode(ct))
    raw[20] ^= 0xFF  # corrupt a byte inside the ciphertext
    tampered = base64.b64encode(bytes(raw)).decode()
    with pytest.raises(TamperDetectedError):
        decrypt(tampered)


def test_tamper_detection_truncated():
    ct = encrypt("data")
    raw = base64.b64decode(ct)
    truncated = base64.b64encode(raw[:20]).decode()
    with pytest.raises((TamperDetectedError, ValueError)):
        decrypt(truncated)


def test_too_short_ciphertext():
    # Fewer than 28 bytes (12-byte nonce + 16-byte tag minimum).
    short = base64.b64encode(b"tooshort").decode()
    with pytest.raises(ValueError, match="too short"):
        decrypt(short)


def test_invalid_base64():
    with pytest.raises(ValueError):
        decrypt("not!!valid%%base64###")


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="FIELD_ENCRYPTION_KEY"):
        encrypt("anything")


def test_bad_key_length_raises(monkeypatch):
    # 16 bytes encodes to a 24-char base64 string — not 32 bytes.
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.b64encode(b"\x00" * 16).decode())
    with pytest.raises(RuntimeError, match="32 bytes"):
        encrypt("anything")
