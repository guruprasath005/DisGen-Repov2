"""
Patient consent validation for DPDP compliance.

Consent is recorded at every document upload. A document whose consent record
has `consent_given=False` must never be uploaded — the upload endpoint enforces
this at the boundary before any data reaches storage or the OCR pipeline.

Usage (upload endpoint):
    from compliance.consent import validate_consent_payload
    try:
        validate_consent_payload(consent_given, consent_method, patient_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
"""

from __future__ import annotations

_VALID_CONSENT_METHODS: frozenset[str] = frozenset({"verbal", "written", "digital"})


def validate_consent_payload(
    consent_given: bool,
    consent_method: str,
    patient_name: str,
) -> None:
    """
    Validate a consent payload at upload time.

    Raises ValueError with a human-readable message on any violation.
    All three conditions must pass before a ConsentRecord is persisted
    or the document is admitted into the OCR pipeline.
    """
    if not consent_given:
        raise ValueError(
            "Patient consent (consent_given=true) is required before upload. "
            "Obtain and record explicit consent before proceeding."
        )

    if consent_method not in _VALID_CONSENT_METHODS:
        raise ValueError(
            f"consent_method '{consent_method}' is not recognised. "
            "Allowed values: verbal, written, digital."
        )

    patient_name = (patient_name or "").strip()
    if not patient_name:
        raise ValueError(
            "patient_name must not be empty. "
            "The patient's name is required to create a consent record."
        )
