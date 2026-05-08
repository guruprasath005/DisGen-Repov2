"""
Discharge summary validation — two validators:

validate_fields()   — new field-based workflow (Group 2 / scheme-field generator).
                      Pure, deterministic. Three checks:
                        1. Required fields present and non-empty.
                        2. No prompt-injection artifacts in any field value.
                        3. All required_fields keys present in the result dict.

validate_summary()  — legacy free-text workflow. Kept for backward compatibility
                      until the old generate_tasks path is fully retired.

ValidationResult.notes is suitable for direct storage in
generated_summaries.validation_notes (JSONB).
Pure function — no DB, no LLM, no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from llm.generator import INJECTION_PATTERNS, SUMMARY_SECTION_KEYS

_MIN_TOTAL_CHARS = 800


@dataclass
class ValidationResult:
    passed: bool
    notes: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"passed": self.passed, "notes": self.notes}


def validate_fields(
    summary_fields: dict | None,
    required_fields: list[dict] | None = None,
) -> ValidationResult:
    """
    Validate a {field_name: value} dict produced by generate_scheme_fields().

    Three checks (all run; failures collected, not short-circuited):
      1. Required-field completeness — every required field has a non-null,
         non-empty string value.
      2. Key presence — every required field name exists in summary_fields
         (guards against LLM silently omitting a key).
      3. Injection scan — no prompt-injection artifacts in any field value.

    Returns ValidationResult(passed=True) only when all three are clean.
    notes always carries full per-check diagnostics for audit storage.
    """
    if not isinstance(summary_fields, dict):
        summary_fields = {}

    notes: dict[str, Any] = {}
    issues: list[str] = []

    # ── 1 & 2. Required-field completeness + key presence ─────────────────────
    required_names: list[str] = []
    if required_fields:
        for f in required_fields:
            name = f.get("field") or f.get("name") or ""
            if name:
                required_names.append(name)

    missing_keys: list[str] = []   # key absent from dict entirely
    empty_fields: list[str] = []   # key present but null / empty string

    for name in required_names:
        if name not in summary_fields:
            missing_keys.append(name)
        else:
            val = summary_fields[name]
            if val is None or (isinstance(val, str) and not val.strip()):
                empty_fields.append(name)

    notes["missing_keys"] = missing_keys
    notes["empty_required_fields"] = empty_fields

    if missing_keys:
        issues.append(f"required fields missing from LLM output: {missing_keys}")
    if empty_fields:
        issues.append(f"required fields have null or empty values: {empty_fields}")

    # ── 3. Prompt-injection artifact scan ─────────────────────────────────────
    leaked: list[str] = []
    for field_name, val in summary_fields.items():
        if not isinstance(val, str):
            continue
        for pattern in INJECTION_PATTERNS:
            match = pattern.search(val)
            if match:
                leaked.append(f"{field_name}: {match.group(0).strip()[:80]}")

    notes["injection_artifacts"] = leaked
    if leaked:
        issues.append(f"injection-like patterns detected in field values: {leaked}")

    notes["issues"] = issues
    return ValidationResult(passed=not issues, notes=notes)


def validate_summary(
    summary_json: dict | None,
    structured_data: dict | None,
    scheme_required_fields: list | None = None,
) -> ValidationResult:
    """
    Run all five checks against the structured summary dict.

    Returns ValidationResult with passed=True only when every check is clean.
    notes always carries the full per-check diagnostic, even on success.
    """
    # Defensive: treat None or wrong type as an empty dict so all checks run
    # and report failures rather than raising.
    if not isinstance(summary_json, dict):
        summary_json = {}
    if not isinstance(structured_data, dict):
        structured_data = {}

    notes: dict[str, Any] = {}
    issues: list[str] = []

    # ── 1. Schema completeness ────────────────────────────────────────────────
    missing_keys: list[str] = []
    empty_keys: list[str] = []
    for key in SUMMARY_SECTION_KEYS:
        val = summary_json.get(key)
        if val is None:
            missing_keys.append(key)
        elif not isinstance(val, str) or not val.strip():
            empty_keys.append(key)

    notes["missing_keys"] = missing_keys
    notes["empty_keys"] = empty_keys
    if missing_keys:
        issues.append(f"required keys missing from tool output: {missing_keys}")
    if empty_keys:
        issues.append(f"required keys have empty or non-string values: {empty_keys}")

    total_chars = sum(
        len(v) for v in summary_json.values() if isinstance(v, str)
    )
    notes["total_chars"] = total_chars
    if total_chars < _MIN_TOTAL_CHARS:
        issues.append(
            f"summary too short: {total_chars} chars total (minimum {_MIN_TOTAL_CHARS})"
        )

    # ── 2 & 3. ICD-10 cross-reference + structural issues ────────────────────
    expected_codes = _expected_icd10_codes(structured_data)
    icd_section_text = ""
    if isinstance(summary_json.get("icd_10_codes"), str):
        icd_section_text = summary_json["icd_10_codes"].upper()

    missing_codes = [
        c for c in expected_codes if c.upper() not in icd_section_text
    ]
    notes["expected_icd10_codes"] = expected_codes
    notes["missing_icd10_codes"] = missing_codes
    if missing_codes:
        issues.append(
            f"ICD-10 codes from confirmed data missing from icd_10_codes section: "
            f"{missing_codes}"
        )

    # structural_issues: richer audit trail — codes present in output vs.
    # expected from structured data (item 3.2)
    structural_issues: list[str] = []
    if missing_codes:
        for code in missing_codes:
            structural_issues.append(
                f"Confirmed ICD-10 code '{code}' not referenced in the "
                "icd_10_codes section."
            )
    notes["structural_issues"] = structural_issues

    # ── 4. Prompt-injection artifact scan ─────────────────────────────────────
    leaked: list[str] = []
    for key in SUMMARY_SECTION_KEYS:
        val = summary_json.get(key)
        if not isinstance(val, str):
            continue
        for pattern in INJECTION_PATTERNS:
            match = pattern.search(val)
            if match:
                leaked.append(f"{key}: {match.group(0).strip()[:80]}")
    notes["injection_artifacts"] = leaked
    if leaked:
        issues.append(f"injection-like patterns detected in output: {leaked}")

    # ── 5. Scheme-required fields referenced ──────────────────────────────────
    required_field_names = _normalize_required_fields(scheme_required_fields)
    # Concatenate all section text for substring matching
    full_text_lower = " ".join(
        v for v in summary_json.values() if isinstance(v, str)
    ).lower()

    missing_required: list[str] = []
    for canonical_name, alias_set in required_field_names.items():
        if not any(alias.lower() in full_text_lower for alias in alias_set if alias):
            missing_required.append(canonical_name)
    notes["missing_required_scheme_fields"] = missing_required
    if missing_required:
        issues.append(
            f"scheme-required fields not referenced in summary: {missing_required}"
        )

    notes["issues"] = issues
    return ValidationResult(passed=not issues, notes=notes)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _expected_icd10_codes(structured_data: dict) -> list[str]:
    """
    Pull ICD-10 codes from doctor-confirmed structured data.

    Defensive against None, missing keys, and malformed entries — any of these
    conditions silently skip the offending entry so validation continues.
    """
    if not isinstance(structured_data, dict):
        return []

    codes: list[str] = []

    primary = structured_data.get("icd10_primary")
    if isinstance(primary, dict):
        code = primary.get("code")
        if code and isinstance(code, str) and code.strip():
            codes.append(code.strip())

    secondary_list = structured_data.get("icd10_secondary")
    if isinstance(secondary_list, list):
        for sec in secondary_list:
            if not isinstance(sec, dict):
                continue
            code = sec.get("code")
            if code and isinstance(code, str) and code.strip():
                codes.append(code.strip())

    # De-dup while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _normalize_required_fields(raw: list | None) -> dict[str, set[str]]:
    """
    Accept a scheme's required_fields in either of two shapes:
      - list[str]   — e.g. ["pmjay_beneficiary_id", ...]
      - list[dict]  — e.g. [{"field": "pmjay_beneficiary_id",
                              "label": "PMJAY Beneficiary ID"}, ...]

    Returns a dict mapping the canonical field name to a set of aliases that
    are acceptable as substring matches in the rendered summary text.
    """
    if not raw:
        return {}

    result: dict[str, set[str]] = {}
    for entry in raw:
        if isinstance(entry, str):
            canonical = entry.strip()
            aliases: set[str] = {canonical, canonical.replace("_", " ")}
        elif isinstance(entry, dict):
            canonical = str(
                entry.get("field") or entry.get("name") or ""
            ).strip()
            if not canonical:
                continue
            aliases = {canonical, canonical.replace("_", " ")}
            label = entry.get("label")
            if label and isinstance(label, str):
                aliases.add(label.strip())
        else:
            continue

        if canonical:
            result[canonical] = {a for a in aliases if a}
    return result
