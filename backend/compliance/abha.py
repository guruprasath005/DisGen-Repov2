"""
ABHA (Ayushman Bharat Health Account) ID validation.

ABHA is a voluntary 14-digit digital health identity issued by the National
Health Authority of India. Its canonical format is XX-XXXX-XXXX-XXXX where
each segment is numeric (e.g. 91-1234-5678-9012).

Validation rules:
  - The field is OPTIONAL. A None or empty value is always valid — not all
    patients have an ABHA ID, particularly older patients, rural patients,
    and emergency admissions.
  - When a value IS provided it must match the canonical format exactly.
    A malformed value blocks confirmation until the doctor either corrects
    the ID or clears the field entirely.

Usage (confirm endpoint):
    from compliance.abha import validate_abha_id, abha_error_message
    if not validate_abha_id(data.get("abha_id")):
        raise HTTPException(status_code=422, detail=abha_error_message())
"""

from __future__ import annotations

import re

_ABHA_PATTERN: re.Pattern[str] = re.compile(r"^\d{2}-\d{4}-\d{4}-\d{4}$")


def validate_abha_id(abha_id: str | None) -> bool:
    """
    Return True if the ABHA ID is absent (None / empty) or correctly formatted.
    Return False if a value is present but does not match XX-XXXX-XXXX-XXXX.
    """
    if not abha_id or not abha_id.strip():
        return True
    return bool(_ABHA_PATTERN.match(abha_id.strip()))


def abha_error_message() -> str:
    return (
        "The ABHA ID format is invalid. "
        "Expected format: XX-XXXX-XXXX-XXXX (e.g. 91-1234-5678-9012). "
        "If the patient does not have an ABHA ID, clear the field and confirm again."
    )
