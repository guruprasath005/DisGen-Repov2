"""
PHI de-identification pipeline.

Layer 1 — Anchored: uses confirmed patient fields from the structured report
           to build an exact replacement map (name variants, UHID, DOB, phone).
Layer 2 — Regex sweep: catches Aadhaar, ABHA, PAN, email, pincode, dates, addresses.
Layer 3 — spaCy NER: catches remaining PERSON entities not caught by Layer 1.

Returns (clean_text, replacements_map) where replacements_map maps each
placeholder back to the original value for re-identification.
"""

import re
from typing import Any

from nlp.phi_filter import regex_sweep, spacy_person_sweep

PLACEHOLDERS = {
    "full_name":    "{{PATIENT_FULL_NAME}}",
    "uhid":         "{{PATIENT_UHID}}",
    "dob":          "{{PATIENT_DOB}}",
    "phone":        "{{PATIENT_PHONE}}",
    "address":      "{{PATIENT_ADDRESS}}",
    "aadhaar":      "{{PATIENT_AADHAAR}}",
    "abha_id":      "{{PATIENT_ABHA}}",
}

# Indian name salutation prefixes to match before the name
_SALUTATIONS = re.compile(
    r"\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Shri|Smt\.?|Ku\.?|Baby|Master)\s+",
    re.IGNORECASE,
)


def _name_variants(name: str) -> list[str]:
    """Generate common variants of a patient's name for anchored replacement."""
    parts = name.strip().split()
    variants: list[str] = [name]
    if len(parts) >= 2:
        # First + Last, Last + First, initials variants
        variants.append(f"{parts[0]} {parts[-1]}")
        variants.append(f"{parts[-1]}, {parts[0]}")
    for prefix in ["Mr. ", "Mrs. ", "Ms. ", "Dr. ", "Shri ", "Smt. "]:
        variants.append(prefix + name)
    return variants


def deidentify(text: str, patient_fields: dict[str, Any] | None = None) -> tuple[str, dict[str, str]]:
    """
    De-identify PHI in text.

    Args:
        text: OCR / raw text to de-identify.
        patient_fields: optional dict with keys matching PLACEHOLDERS
                        (e.g. {"full_name": "Ravi Kumar", "uhid": "UHID12345"}).

    Returns:
        (clean_text, replacements_map)
        replacements_map: {placeholder -> original_value}
    """
    replacements: dict[str, str] = {}

    # ── Layer 1: Anchored replacement from known patient fields ──────────────
    if patient_fields:
        for field, placeholder in PLACEHOLDERS.items():
            value = patient_fields.get(field)
            if not value:
                continue
            value_str = str(value)
            if field == "full_name":
                # Replace all name variants (with salutations)
                for variant in _name_variants(value_str):
                    if variant in text:
                        text = text.replace(variant, placeholder)
                        replacements[placeholder] = value_str
                # Also strip salutations that precede the placeholder
                text = _SALUTATIONS.sub("", text)
            else:
                if value_str in text:
                    text = text.replace(value_str, placeholder)
                    replacements[placeholder] = value_str

    # ── Layer 2: Regex sweep ──────────────────────────────────────────────────
    text, replacements = regex_sweep(text, replacements)

    # ── Layer 3: spaCy NER ────────────────────────────────────────────────────
    text, replacements = spacy_person_sweep(text, replacements)

    return text, replacements
