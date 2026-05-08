"""
Unit tests for DPDP consent validation (compliance/consent.py).

Pure function — no DB, no I/O.
"""

import pytest

from compliance.consent import validate_consent_payload


# ── Valid consent payloads ────────────────────────────────────────────────────


def test_written_consent_valid():
    validate_consent_payload(True, "written", "John Doe")


def test_verbal_consent_valid():
    validate_consent_payload(True, "verbal", "Jane Smith")


def test_digital_consent_valid():
    validate_consent_payload(True, "digital", "Patient Name")


def test_name_with_unicode_valid():
    validate_consent_payload(True, "written", "ராஜன் குமார்")


def test_name_with_leading_trailing_spaces_valid():
    # The function strips the name; as long as non-empty after strip it's OK.
    validate_consent_payload(True, "written", "  John Doe  ")


# ── consent_given failures ────────────────────────────────────────────────────


def test_consent_given_false_raises():
    with pytest.raises(ValueError) as exc_info:
        validate_consent_payload(False, "written", "John Doe")
    assert "consent" in str(exc_info.value).lower()


def test_consent_given_none_raises():
    with pytest.raises((ValueError, TypeError)):
        validate_consent_payload(None, "written", "John Doe")


# ── consent_method failures ───────────────────────────────────────────────────


def test_invalid_method_oral_raises():
    with pytest.raises(ValueError) as exc_info:
        validate_consent_payload(True, "oral", "John Doe")
    assert "consent_method" in str(exc_info.value) or "oral" in str(exc_info.value)


def test_invalid_method_implicit_raises():
    with pytest.raises(ValueError):
        validate_consent_payload(True, "implicit", "John Doe")


def test_invalid_method_empty_raises():
    with pytest.raises(ValueError):
        validate_consent_payload(True, "", "John Doe")


def test_invalid_method_uppercase_raises():
    # Methods are case-sensitive: 'Written' != 'written'.
    with pytest.raises(ValueError):
        validate_consent_payload(True, "Written", "John Doe")


# ── patient_name failures ─────────────────────────────────────────────────────


def test_empty_name_raises():
    with pytest.raises(ValueError) as exc_info:
        validate_consent_payload(True, "written", "")
    assert "patient_name" in str(exc_info.value).lower() or "name" in str(exc_info.value).lower()


def test_whitespace_only_name_raises():
    with pytest.raises(ValueError):
        validate_consent_payload(True, "written", "   ")


def test_none_name_raises():
    with pytest.raises(ValueError):
        validate_consent_payload(True, "written", None)
