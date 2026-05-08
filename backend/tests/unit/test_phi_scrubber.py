"""
Unit tests for the PHI log scrubber (logging_config.py).

Tests the PHIScrubFilter._scrub() method directly — no logging infrastructure
needed.  Covers both the positive cases (PHI must be removed) and the
intentional false-positive tradeoffs documented in the scrubber.
"""

import pytest

from logging_config import PHIScrubFilter


@pytest.fixture
def scrub():
    return PHIScrubFilter()._scrub


# ── ABHA ID ───────────────────────────────────────────────────────────────────


def test_redacts_abha_id(scrub):
    assert "[REDACTED-ABHA]" in scrub("ABHA: 91-1234-5678-9012")


def test_abha_only_exact_format(scrub):
    result = scrub("ref-1234-5678-901")  # only 3 groups of 4, not 4 groups
    assert "[REDACTED-ABHA]" not in result


# ── Aadhaar ───────────────────────────────────────────────────────────────────


def test_redacts_aadhaar_plain(scrub):
    assert "[REDACTED-AADHAAR]" in scrub("Aadhaar: 123456789012")


def test_redacts_aadhaar_spaced(scrub):
    assert "[REDACTED-AADHAAR]" in scrub("ID: 1234 5678 9012")


def test_redacts_aadhaar_dashed(scrub):
    assert "[REDACTED-AADHAAR]" in scrub("1234-5678-9012")


# ── Phone ─────────────────────────────────────────────────────────────────────


def test_redacts_indian_mobile(scrub):
    assert "[REDACTED-PHONE]" in scrub("Contact: 9876543210")


def test_does_not_redact_landline_starting_with_0(scrub):
    result = scrub("0422-2345678")
    assert "[REDACTED-PHONE]" not in result


def test_does_not_redact_short_number(scrub):
    result = scrub("Call: 12345")
    assert "[REDACTED-PHONE]" not in result


# ── UHID ──────────────────────────────────────────────────────────────────────


def test_redacts_uhid_with_prefix(scrub):
    assert "[REDACTED-UHID]" in scrub("UHID-123456")


def test_redacts_uhid_uppercase_u_prefix(scrub):
    assert "[REDACTED-UHID]" in scrub("U1234567")


# ── Age / demographics ────────────────────────────────────────────────────────


def test_redacts_age_with_yr_suffix(scrub):
    assert "[REDACTED-DEMOG]" in scrub("Patient: 45yr male")


def test_redacts_age_with_gender(scrub):
    assert "[REDACTED-DEMOG]" in scrub("30M admitted with fever")


# ── ICD-10 codes ──────────────────────────────────────────────────────────────


def test_redacts_icd10_plain(scrub):
    # E11 is the ICD-10 code for Type 2 Diabetes
    assert "[REDACTED-ICD10]" in scrub("Diagnosis: E11")


def test_redacts_icd10_with_decimal(scrub):
    assert "[REDACTED-ICD10]" in scrub("Code: J18.9")


def test_b12_is_scrubbed_as_icd10_tradeoff(scrub):
    # B12 matches the ICD-10 pattern (letter + 2 digits). In a log scrubber,
    # over-scrubbing is safer than under-scrubbing. "Vitamin B12" in a log
    # becomes "[REDACTED-ICD10]", which is the documented, intentional tradeoff.
    result = scrub("Patient on Vitamin B12 supplement")
    assert "[REDACTED-ICD10]" in result


def test_a1c_not_scrubbed(scrub):
    # A1C: letter + 1 digit + letter — does not match [A-Z]\d{2}, so not scrubbed.
    result = scrub("HbA1C value is 7.2")
    assert "[REDACTED-ICD10]" not in result


def test_d100_not_scrubbed(scrub):
    # D100: after D10, word boundary fails (followed by 0), so not scrubbed.
    result = scrub("D100 tablet prescribed")
    assert "[REDACTED-ICD10]" not in result


def test_icd10_not_matched_mid_alphanumeric(scrub):
    # "AB12CD" — no word boundary before A, should not match
    result = scrub("code AB12CD is internal")
    assert "[REDACTED-ICD10]" not in result


# ── Clean text should pass through ────────────────────────────────────────────


def test_clean_clinical_text_unchanged(scrub):
    text = "Patient admitted with viral fever. BP 120/80. No known drug allergy."
    result = scrub(text)
    assert "viral fever" in result
    assert "BP 120/80" in result
