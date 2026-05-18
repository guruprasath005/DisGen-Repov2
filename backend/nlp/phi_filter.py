"""
Regex + spaCy NER sweep for PHI de-identification (Layer 2).

Covers: Aadhaar, ABHA, PAN, Indian phone numbers, email, pincode, dates, addresses.
spaCy PERSON entities not already replaced by Layer 1 are also masked.

Medical terms are excluded from the PERSON filter to prevent false positives
(drug names, diagnoses like "Pancreatitis" will not be flagged as persons).
"""

import re
from typing import Optional

# Known medical terms that look like proper names — excluded from spaCy PERSON filter
_MEDICAL_EXCLUSIONS: frozenset[str] = frozenset({
    "Metformin", "Insulin", "Aspirin", "Atorvastatin", "Amlodipine",
    "Ramipril", "Paracetamol", "Amoxicillin", "Azithromycin", "Omeprazole",
    "Metoprolol", "Losartan", "Clopidogrel", "Enalapril", "Furosemide",
    "Dolo", "Pantoprazole", "Ondansetron", "Tramadol", "Ibuprofen",
    "Pancreatitis", "Diabetes", "Hypertension", "Pneumonia", "Sepsis",
    "Cholecystitis", "Appendicitis", "Thalassemia", "Anemia", "Jaundice",
    "Dengue", "Malaria", "Typhoid", "Tuberculosis", "COVID", "SARS",
    "ICU", "NICU", "OPD", "IPD", "ECG", "EEG", "MRI", "CT", "USG",
})

_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("AADHAAR", re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")),
    ("ABHA", re.compile(r"\b\d{2}-\d{4}-\d{4}-\d{4}\b")),
    ("PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),
    ("PHONE", re.compile(
        r"\b(?:\+91[\s\-]?)?(?:0)?[6-9]\d{9}\b"
    )),
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("PINCODE", re.compile(r"\b[1-9][0-9]{5}\b")),
    ("DATE", re.compile(
        r"\b(?:\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}|\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}"
        r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}"
        r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b",
        re.IGNORECASE,
    )),
    ("ADDRESS", re.compile(
        r"\b\d+[,\s]+[A-Za-z\s]+(?:Nagar|Colony|Street|Road|Lane|Marg|Avenue|Cross"
        r"|Layout|Sector|Block|Phase|Town|Village|Pura|Ganj|Bagh|Vihar|Enclave)\b",
        re.IGNORECASE,
    )),
]


def regex_sweep(text: str, replacements: dict[str, str]) -> tuple[str, dict[str, str]]:
    """
    Apply all regex patterns to text, replacing matches with placeholders.

    Returns updated text and an updated replacements map.
    Counters per type ensure each unique value gets a unique placeholder.
    """
    counters: dict[str, int] = {}
    existing_values = {v: k for k, v in replacements.items()}

    for label, pattern in _PATTERNS:
        def replace_match(m: re.Match, _label=label) -> str:
            value = m.group(0)
            if value in existing_values:
                return existing_values[value]
            counters[_label] = counters.get(_label, 0) + 1
            n = counters[_label]
            placeholder = f"{{{{{_label}_{n}}}}}" if n > 1 else f"{{{{{_label}}}}}"
            replacements[placeholder] = value
            existing_values[value] = placeholder
            return placeholder

        text = pattern.sub(replace_match, text)

    return text, replacements


def spacy_person_sweep(text: str, replacements: dict[str, str]) -> tuple[str, dict[str, str]]:
    """
    Run spaCy NER and replace remaining PERSON entities not already masked.
    """
    try:
        import spacy
        nlp = spacy.load("en_core_web_sm")
    except Exception:
        return text, replacements  # spaCy unavailable — skip, regex already ran

    existing_values = {v: k for k, v in replacements.items()}
    counters: dict[str, int] = {}
    doc = nlp(text)

    offset = 0
    new_text = text
    for ent in doc.ents:
        if ent.label_ != "PERSON":
            continue
        name = ent.text.strip()
        if name in _MEDICAL_EXCLUSIONS or name in existing_values:
            continue
        # Skip already-replaced placeholders
        if name.startswith("{{") and name.endswith("}}"):
            continue
        counters["PERSON"] = counters.get("PERSON", 0) + 1
        n = counters["PERSON"]
        placeholder = "{{PATIENT_FULL_NAME}}" if n == 1 else f"{{{{PERSON_{n}}}}}"
        replacements[placeholder] = name
        existing_values[name] = placeholder
        # Apply the replacement in new_text
        new_text = new_text.replace(name, placeholder, 1)

    return new_text, replacements
