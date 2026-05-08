"""
Unit tests for ABHA ID validation (compliance/abha.py).

ABHA is voluntary — absent values must always pass.
Only a present-but-malformed value must fail.

Pure function — no I/O.
"""

from compliance.abha import abha_error_message, validate_abha_id


# ── Absent values (always valid) ─────────────────────────────────────────────


def test_none_is_valid():
    assert validate_abha_id(None) is True


def test_empty_string_is_valid():
    assert validate_abha_id("") is True


def test_whitespace_only_is_valid():
    assert validate_abha_id("   ") is True


# ── Valid ABHA IDs ────────────────────────────────────────────────────────────


def test_canonical_format_valid():
    assert validate_abha_id("91-1234-5678-9012") is True


def test_leading_zero_prefix_valid():
    assert validate_abha_id("01-0000-0000-0001") is True


def test_max_digit_values_valid():
    assert validate_abha_id("99-9999-9999-9999") is True


def test_valid_with_surrounding_whitespace():
    # The validator strips the value before matching.
    assert validate_abha_id("  91-1234-5678-9012  ") is True


# ── Invalid ABHA IDs (present but malformed) ─────────────────────────────────


def test_no_dashes_invalid():
    assert validate_abha_id("91123456789012") is False


def test_wrong_segment_count_invalid():
    assert validate_abha_id("1234-5678-9012") is False


def test_extra_digit_in_first_segment_invalid():
    assert validate_abha_id("911-1234-5678-9012") is False


def test_short_second_segment_invalid():
    assert validate_abha_id("91-123-5678-9012") is False


def test_alpha_chars_invalid():
    assert validate_abha_id("AB-1234-5678-9012") is False


def test_mixed_alpha_digits_invalid():
    assert validate_abha_id("91-12AB-5678-9012") is False


def test_extra_segment_invalid():
    assert validate_abha_id("91-1234-5678-9012-3456") is False


def test_partial_format_invalid():
    assert validate_abha_id("91-1234") is False


# ── Error message ─────────────────────────────────────────────────────────────


def test_error_message_contains_format():
    msg = abha_error_message()
    assert "XX-XXXX-XXXX-XXXX" in msg


def test_error_message_mentions_optional():
    msg = abha_error_message()
    assert "ABHA ID" in msg or "abha" in msg.lower()
