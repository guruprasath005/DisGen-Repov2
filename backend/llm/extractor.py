"""
LLM-based structured clinical data extraction + ICD-10 / drug mapping.

Extraction flow
───────────────
1. Build prompt from OCR result: full text + markdown tables + key-value pairs
2. Call the configured LLM provider (JSON mode, temperature=0)
3. Parse response into StructuredData
4. On LLM failure or JSON parse error: run spaCy + regex fallback
5. Merge: LLM fields are primary; fallback fills any null values
6. DB-backed mapping (called separately from extract_tasks.py):
   - ICD-10: pg_trgm similarity on icd10_codes table
     score > 0.4  → auto-assign
     0.2–0.4      → store as candidates (doctor selects)
     < 0.2        → raw text, manual assignment
   - Drugs: exact-match → pg_trgm (> 0.5) → store as-is with normalized=False
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from llm.client import LLMClient
from nlp import extractor as regex_extractor
from nlp import pipeline as spacy_extractor

logger = logging.getLogger(__name__)


# ── StructuredData ─────────────────────────────────────────────────────────────


@dataclass
class StructuredData:
    """All structured clinical fields extracted from one discharge document."""

    # Patient demographics
    patient_name: str | None = None
    age: str | None = None
    gender: str | None = None
    uhid: str | None = None
    abha_id: str | None = None
    phone: str | None = None

    # Episode
    admission_date: str | None = None
    discharge_date: str | None = None
    ward: str | None = None
    bed_number: str | None = None

    # Diagnoses (raw text — ICD-10 mapping done separately below)
    primary_diagnosis: str | None = None
    secondary_diagnoses: list[str] = field(default_factory=list)
    presenting_complaints: list[str] = field(default_factory=list)

    # ICD-10 results — populated by map_icd10_codes()
    # {code, description, similarity, source: "auto"|"candidate"|"manual"|null}
    icd10_primary: dict | None = None
    icd10_secondary: list[dict] = field(default_factory=list)
    # Candidates when similarity is 0.2–0.4; doctor selects or overrides
    icd10_primary_candidates: list[dict] = field(default_factory=list)
    icd10_secondary_candidates: list[dict] = field(default_factory=list)

    # Vitals at admission
    blood_pressure: str | None = None
    pulse_rate: str | None = None
    respiratory_rate: str | None = None
    temperature: str | None = None
    oxygen_saturation: str | None = None
    weight: str | None = None
    height: str | None = None

    # Clinical department
    department: str | None = None

    # Investigations: [{name, value, unit, date, reference_range, flag}]
    investigations: list[dict] = field(default_factory=list)

    # Procedures: [{name, date, notes}]
    procedures: list[dict] = field(default_factory=list)

    # Medications during stay: [{name, dose, frequency, route, duration,
    #                             normalized, generic_name}]
    medications_during_stay: list[dict] = field(default_factory=list)

    # Discharge medications: [{name, dose, frequency, duration, instructions,
    #                          normalized, generic_name}]
    discharge_medications: list[dict] = field(default_factory=list)

    # Discharge instructions
    follow_up_instructions: str | None = None
    follow_up_date: str | None = None
    diet_advice: str | None = None
    discharge_advice: list[str] = field(default_factory=list)
    allergies: str | None = None

    # Clinicians
    consultant: str | None = None
    surgeon: str | None = None
    anesthetist: str | None = None

    # ── Scheme / Coverage metadata (ISS-006) ─────────────────────────────────
    # Identifiers and package details for government schemes (PM-JAY, CGHS, ESI,
    # state schemes) and private insurance. Field names mirror the placeholders
    # already used by backend/pdf/templates/pmjay.html so extracted values can
    # surface in the PDF even before per-scheme generation runs. For non-PMJAY
    # schemes these capture the equivalent concept (CGHS card no., ESI
    # beneficiary id, etc.) and the LLM generator maps them to scheme-specific
    # output fields via the field hints in scheme.required_fields.
    scheme_name: str | None = None              # e.g., "PM-JAY", "CGHS", "ESI", "Private"
    pmjay_beneficiary_id: str | None = None     # PM-JAY family/household ID or CGHS/ESI card no.
    pmjay_preauth_number: str | None = None     # pre-authorisation reference
    hbp_package_code: str | None = None         # HBP / package code (e.g., MG-SE-31)
    hbp_procedure_code: str | None = None       # procedure code within the package
    pmjay_hid_card_number: str | None = None    # ABHA / HID; usually == abha_id
    medco_name: str | None = None               # PM-JAY MEDCO name (if present)
    implants_consumables: str | None = None     # implants / consumables used, or "None"
    package_cost_approved: str | None = None    # kept as string to preserve "₹ 1,75,000"
    length_of_stay: str | None = None           # e.g., "18 days"

    # ── Extended clinical details ───────────────────────────────────────────────

    # Donor information (transplant cases)
    # {name, age, gender, blood_group, relation, ip_number}
    donor_details: dict | None = None

    # Clinical background
    past_medical_history: list[str] = field(default_factory=list)
    past_surgical_history: list[str] = field(default_factory=list)
    comorbidities: list[str] = field(default_factory=list)

    # Narrative of hospital stay
    hospital_course: str | None = None

    # Operative details: {approach, anastomosis, stent_details, findings, notes}
    operative_details: dict | None = None

    # Post-operative trend: [{day, parameter, value, unit}]
    post_operative_course: list[dict] = field(default_factory=list)

    # Radiology / imaging: [{modality, finding, date}]
    imaging: list[dict] = field(default_factory=list)

    # Serology & special tests: [{name, result}]
    serology: list[dict] = field(default_factory=list)

    # Blood group and urine results
    blood_group: str | None = None
    urine_findings: list[dict] = field(default_factory=list)

    # Extraction metadata
    extraction_source: str = "llm"  # "llm" | "nlp_fallback" | "merged" | "failed"
    # Coverage/diagnostics for the doctor-review UI: which pages contributed,
    # which produced nothing, whether any chunk was truncated, OCR confidence.
    extraction_meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


# ── LLM prompt ─────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a clinical data extraction assistant for an Indian hospital discharge summary system.
Extract structured data from the provided OCR text and return it as JSON.

STRICT RULES:
1. Extract data EXACTLY as written — do NOT paraphrase, interpret, or infer
2. Use null for any field not present or unclear
3. Do NOT assign ICD-10 codes — record only raw diagnosis text
4. All dates must be ISO 8601 (YYYY-MM-DD); use null if the date cannot be parsed
5. For medications, record the name exactly as written (brand or generic)
6. Extract EVERY laboratory test, investigation, and diagnostic result without exception —
   CBC with full differential (each parameter separately), metabolic panels, coagulation,
   cultures, imaging, cardiac markers, hormone levels, serology, urine — all of them.
   Each test on each date is a separate entry. Never summarize or skip any test.
7. Return ONLY valid JSON matching the schema below — no explanation, no markdown

DIAGNOSIS SPLITTING RULES:
- primary_diagnosis: the single main acute condition being treated (e.g. "Atypical pneumonia (SARS-CoV-2), SEVERE DISEASE (HFNC-NIV)")
- secondary_diagnoses: all other conditions listed — comorbidities, complications, secondary findings (e.g. ["Steroid Dysglycemia"])
- If the document lists diagnoses as a single combined block, use clinical judgment to separate them

WARD / BED RULES:
- ward: the named ward or wing only (e.g. "DR Shailender Wing", "ICU", "Cardiology Ward")
- bed_number: the room/bed number only (e.g. "2306", "Bed 5")
- If they appear combined (e.g. "2306(DR SHAILENDER WING SINGLE ROOMS)") split them correctly

SCHEME / COVERAGE RULES:
- Indian hospital admissions are usually billed against a government scheme (PM-JAY /
  Ayushman Bharat, CGHS, ESI, CMCHIS, state schemes) or private insurance.
- scheme_name: name as written (e.g. "PM-JAY", "Ayushman Bharat PM-JAY", "CGHS", "ESI", "Private").
- pmjay_beneficiary_id: for PM-JAY this is the family/household/card number (e.g.
  "P21449008733112"); for CGHS use the CGHS card number; for ESI the ESI/IP number.
- pmjay_preauth_number: pre-authorisation / approval reference number, exactly as written.
- hbp_package_code: PM-JAY HBP package code (e.g. "MG-SE-31"); leave null for non-PMJAY.
- hbp_procedure_code: PM-JAY HBP procedure code within the package; leave null for non-PMJAY.
- pmjay_hid_card_number: 14-digit ABHA / Health ID — usually the same value as abha_id.
- medco_name: PM-JAY Medical Coordinator name, when explicitly mentioned.
- implants_consumables: list of implants/consumables (with code/cost where given), or "None"
  when explicitly documented as none used.
- package_cost_approved: approved amount as written (preserve currency symbol — e.g. "₹ 1,75,000").
- length_of_stay: total stay (e.g. "18 days"), or compute from admission_date → discharge_date.
- NEVER invent any scheme identifier. If absent or unclear, return null for that field.

DISCHARGE ADVICE RULES:
- follow_up_instructions: the review/follow-up appointment instruction (e.g. "Review after 14 days with FBS, PPBS")
- discharge_advice: list of specific behavioural/care instructions given at discharge
  (e.g. ["Home quarantine for 2 weeks", "Wear N95 mask", "Incentive spirometry"])
- These are two different fields — do not mix them

REQUIRED JSON SCHEMA:
{
  "patient_name": null,
  "age": null,
  "gender": null,
  "uhid": null,
  "abha_id": null,
  "phone": null,
  "admission_date": null,
  "discharge_date": null,
  "ward": null,
  "bed_number": null,
  "department": null,
  "primary_diagnosis": null,
  "secondary_diagnoses": [],
  "presenting_complaints": [],
  "blood_pressure": null,
  "pulse_rate": null,
  "respiratory_rate": null,
  "temperature": null,
  "oxygen_saturation": null,
  "weight": null,
  "height": null,
  "investigations": [
    {"name": null, "value": null, "unit": null, "date": null,
     "reference_range": null, "flag": null}
  ],
  "procedures": [
    {"name": null, "date": null, "notes": null}
  ],
  "medications_during_stay": [
    {"name": null, "dose": null, "frequency": null, "route": null, "duration": null}
  ],
  "discharge_medications": [
    {"name": null, "dose": null, "frequency": null, "duration": null, "instructions": null}
  ],
  "follow_up_instructions": null,
  "follow_up_date": null,
  "diet_advice": null,
  "discharge_advice": [],
  "allergies": null,
  "consultant": null,
  "surgeon": null,
  "anesthetist": null,

  "scheme_name": null,
  "pmjay_beneficiary_id": null,
  "pmjay_preauth_number": null,
  "hbp_package_code": null,
  "hbp_procedure_code": null,
  "pmjay_hid_card_number": null,
  "medco_name": null,
  "implants_consumables": null,
  "package_cost_approved": null,
  "length_of_stay": null,

  "donor_details": {
    "name": null, "age": null, "gender": null,
    "blood_group": null, "relation": null, "ip_number": null
  },
  "past_medical_history": [],
  "past_surgical_history": [],
  "comorbidities": [],
  "hospital_course": null,
  "operative_details": {
    "approach": null, "anastomosis": null,
    "stent_details": null, "findings": null, "notes": null
  },
  "post_operative_course": [
    {"day": null, "parameter": null, "value": null, "unit": null}
  ],
  "imaging": [
    {"modality": null, "finding": null, "date": null}
  ],
  "serology": [
    {"name": null, "result": null}
  ],
  "blood_group": null,
  "urine_findings": [
    {"name": null, "value": null, "unit": null}
  ]
}\
"""

# Scalar fields that can be filled from fallback if LLM left them null
_SCALAR_FILLABLE = {
    "patient_name", "age", "gender", "uhid", "abha_id", "phone",
    "blood_pressure", "pulse_rate", "respiratory_rate", "temperature",
    "oxygen_saturation", "department",
}

# Extracted field names that must be present in the LLM JSON
_REQUIRED_KEYS = {
    "patient_name", "age", "gender", "uhid", "abha_id", "phone",
    "admission_date", "discharge_date", "ward", "bed_number", "department",
    "primary_diagnosis", "secondary_diagnoses", "presenting_complaints",
    "blood_pressure", "pulse_rate", "respiratory_rate", "temperature",
    "oxygen_saturation", "weight", "height", "investigations", "procedures",
    "medications_during_stay", "discharge_medications",
    "follow_up_instructions", "follow_up_date", "diet_advice",
    "discharge_advice", "allergies", "consultant", "surgeon", "anesthetist",
    "donor_details", "past_medical_history", "past_surgical_history",
    "comorbidities", "hospital_course", "operative_details",
    "post_operative_course", "imaging", "serology",
    "blood_group", "urine_findings",
    # Scheme / coverage metadata (ISS-006)
    "scheme_name", "pmjay_beneficiary_id", "pmjay_preauth_number",
    "hbp_package_code", "hbp_procedure_code", "pmjay_hid_card_number",
    "medco_name", "implants_consumables", "package_cost_approved",
    "length_of_stay",
}


# ── Table → Markdown ───────────────────────────────────────────────────────────


def _tables_to_markdown(tables: list[dict]) -> str:
    """Convert OCR table dicts to GitHub-flavoured markdown for the prompt."""
    if not tables:
        return ""
    lines: list[str] = []
    for i, table in enumerate(tables):
        headers: list[str] = table.get("headers") or []
        rows: list[dict] = table.get("rows") or []
        if not headers:
            continue
        page = table.get("page")
        lines.append(f"\n**Table {i + 1}**" + (f" (page {page})" if page else "") + ":")
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in rows:
            values = [str(row.get(h) or "") for h in headers]
            lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def _build_user_message(ocr_data: dict) -> str:
    """
    Compose the user message: full text + tables (markdown) + key-value pairs.

    gpt-4o has a 128K-token context window — the entire document is sent as
    input without truncation. (Output truncation is handled in Phase 4.)
    """
    full_text: str = ocr_data.get("full_text") or ""
    tables: list = ocr_data.get("tables") or []
    key_values: dict = ocr_data.get("key_values") or {}

    parts = [
        "=== DISCHARGE DOCUMENT OCR TEXT ===",
        full_text,
    ]

    table_md = _tables_to_markdown(tables)
    if table_md:
        parts += ["\n=== EXTRACTED TABLES ===", table_md]

    if key_values:
        kv_lines = [f"{k}: {v}" for k, v in key_values.items()]
        parts += ["\n=== FORM FIELD KEY-VALUES ===", "\n".join(kv_lines)]

    return "\n".join(parts)


# ── LLM extraction ─────────────────────────────────────────────────────────────


_LIST_KEYS: frozenset[str] = frozenset({
    "secondary_diagnoses", "presenting_complaints", "investigations",
    "procedures", "medications_during_stay", "discharge_medications",
    "discharge_advice", "past_medical_history", "past_surgical_history",
    "comorbidities", "post_operative_course", "imaging", "serology",
    "urine_findings",
})


def _estimate_tokens(text: str) -> int:
    """Cheap, dependency-free token estimate (~4 chars/token)."""
    return max(1, len(text) // 4)


def _ocr_pages(ocr_data: dict) -> list[tuple[int, str]]:
    """
    Return [(page_number, page_text)] sorted by page.

    Uses Azure's per-page `sections` ("Page N" -> text). Falls back to a
    single synthetic page from full_text when sections are unavailable.
    """
    sections: dict = ocr_data.get("sections") or {}
    pages: list[tuple[int, str]] = []
    for key, val in sections.items():
        try:
            num = int(str(key).strip().split()[-1])
        except (ValueError, IndexError):
            num = len(pages) + 1
        pages.append((num, val or ""))
    pages.sort(key=lambda p: p[0])
    if not pages:
        full = ocr_data.get("full_text") or ""
        return [(1, full)] if full.strip() else []
    return pages


def _chunk_pages(
    pages: list[tuple[int, str]], budget_tokens: int
) -> list[list[tuple[int, str]]]:
    """
    Group consecutive pages into chunks under `budget_tokens` of source.

    Bounding source size bounds expected JSON output size — that is what
    keeps a lab-heavy K-shape from overflowing the model's 16K output cap.
    A single page over budget becomes its own chunk (split further only if
    the model actually truncates).
    """
    chunks: list[list[tuple[int, str]]] = []
    cur: list[tuple[int, str]] = []
    cur_tok = 0
    for num, txt in pages:
        t = _estimate_tokens(txt)
        if cur and cur_tok + t > budget_tokens:
            chunks.append(cur)
            cur, cur_tok = [], 0
        cur.append((num, txt))
        cur_tok += t
    if cur:
        chunks.append(cur)
    return chunks


def _chunk_ocr_payload(
    page_subset: list[tuple[int, str]],
    all_tables: list[dict],
    key_values: dict,
    include_key_values: bool,
) -> dict:
    """Build an ocr_data-shaped dict scoped to one chunk's pages."""
    page_nums = {n for n, _ in page_subset}
    text = "\n".join(t for _, t in page_subset)
    tables = [tb for tb in (all_tables or []) if tb.get("page") in page_nums]
    return {
        "full_text": text,
        "tables": tables,
        # Form key-values are document-level; attach once (first chunk) so
        # they aren't duplicated into every chunk's prompt and budget.
        "key_values": key_values if include_key_values else {},
    }


def _fill_missing_keys(parsed: dict) -> dict:
    """Ensure every required key exists (null / [] as appropriate)."""
    for k in _REQUIRED_KEYS - parsed.keys():
        parsed[k] = [] if k in _LIST_KEYS else None
    return parsed


def _call_llm_once(chunk_ocr: dict) -> tuple[dict | None, str]:
    """
    One LLM extraction call for one chunk.

    Returns (parsed_or_None, finish_reason). finish_reason == "length" means
    the output was truncated — the caller splits and retries instead of
    silently repairing truncated JSON and dropping clinical rows.
    """
    user_message = _build_user_message(chunk_ocr)
    try:
        text, finish = LLMClient.get_instance().chat_with_finish(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.0,
            top_p=1.0,
            max_tokens=16384,
            json_mode=True,
        )
    except Exception as exc:
        logger.error("LLM API call failed: %s", exc)
        return None, "error"

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        try:
            from json_repair import repair_json  # noqa: PLC0415

            parsed = json.loads(repair_json(text))
            logger.warning("JSON repair used for chunk (finish=%s)", finish)
        except Exception as repair_exc:
            logger.error(
                "JSON repair failed: %s — raw: %.200s", repair_exc, text
            )
            return None, finish

    if not isinstance(parsed, dict):
        logger.error("LLM response is not a JSON object: %.100s", text)
        return None, finish

    return _fill_missing_keys(parsed), finish


def _extract_chunk(
    page_subset: list[tuple[int, str]],
    all_tables: list[dict],
    key_values: dict,
    include_key_values: bool,
    meta: dict,
    depth: int = 0,
) -> dict | None:
    """
    Extract one chunk, splitting on truncation.

    If the model truncates (finish_reason == "length") and the chunk spans
    more than one page, split the pages in half, extract each sub-range, and
    merge — so no lab row is lost to the output cap. A single page that still
    truncates falls back to repaired JSON, recorded in `meta`.
    """
    parsed, finish = _call_llm_once(
        _chunk_ocr_payload(
            page_subset, all_tables, key_values, include_key_values
        )
    )
    page_label = ",".join(str(n) for n, _ in page_subset)

    if finish == "length" and len(page_subset) > 1 and depth < 6:
        mid = len(page_subset) // 2
        logger.warning(
            "Chunk pages [%s] truncated — splitting (depth=%d)",
            page_label,
            depth,
        )
        meta["truncated_chunks"].append(page_label)
        left = _extract_chunk(
            page_subset[:mid], all_tables, key_values,
            include_key_values, meta, depth + 1,
        )
        right = _extract_chunk(
            page_subset[mid:], all_tables, {}, False, meta, depth + 1,
        )
        return _merge_chunk_dicts([d for d in (left, right) if d]) or None

    if finish == "length" and len(page_subset) == 1:
        logger.error(
            "Single page [%s] truncated at full output budget — data on "
            "this page may be incomplete",
            page_label,
        )
        meta["truncated_chunks"].append(page_label)

    if parsed is None:
        meta["failed_pages"].extend(n for n, _ in page_subset)
        return None

    meta["pages_with_content"].extend(n for n, _ in page_subset)
    return parsed


# ── Deterministic chunk merge ──────────────────────────────────────────────────

# "First non-null wins" across chunks (page order is deterministic).
_SCALAR_FIRST: frozenset[str] = frozenset({
    "patient_name", "age", "gender", "uhid", "abha_id", "phone",
    "admission_date", "discharge_date", "ward", "bed_number", "department",
    "primary_diagnosis", "blood_pressure", "pulse_rate", "respiratory_rate",
    "temperature", "oxygen_saturation", "weight", "height",
    "follow_up_instructions", "follow_up_date", "diet_advice", "allergies",
    "consultant", "surgeon", "anesthetist", "blood_group",
    # Scheme / coverage metadata (ISS-006) — first-non-null across chunks
    "scheme_name", "pmjay_beneficiary_id", "pmjay_preauth_number",
    "hbp_package_code", "hbp_procedure_code", "pmjay_hid_card_number",
    "medco_name", "implants_consumables", "package_cost_approved",
    "length_of_stay",
})
# Narrative accumulated across chunks (dedup, joined).
_ACCUMULATE_TEXT: frozenset[str] = frozenset({"hospital_course"})
# Nested dicts merged sub-key-wise (first non-null per sub-key).
_DICT_FIELDS: frozenset[str] = frozenset({"donor_details", "operative_details"})
# Object-list fields → dedupe on these key tuples.
_LIST_DEDUPE_KEYS: dict[str, tuple[str, ...]] = {
    "investigations": ("name", "value", "date"),
    "medications_during_stay": ("name", "dose", "frequency"),
    "discharge_medications": ("name", "dose", "frequency"),
    "procedures": ("name", "date"),
    "imaging": ("modality", "finding", "date"),
    "serology": ("name", "result"),
    "post_operative_course": ("day", "parameter", "value"),
    "urine_findings": ("name", "value"),
}
# String-list fields → dedupe on the normalized string itself.
_STR_LIST_FIELDS: frozenset[str] = frozenset({
    "secondary_diagnoses", "presenting_complaints", "discharge_advice",
    "past_medical_history", "past_surgical_history", "comorbidities",
})


def _norm(v) -> str:
    return str(v).strip().lower() if v is not None else ""


def _dedupe(items: list, keys: tuple[str, ...]) -> list:
    """Order-preserving dedupe. Objects keyed by `keys`; scalars by value."""
    seen: set[str] = set()
    out: list = []
    for it in items:
        if isinstance(it, dict):
            k = (
                "|".join(_norm(it.get(x)) for x in keys)
                if keys
                else "|".join(f"{a}={_norm(b)}" for a, b in sorted(it.items()))
            )
        else:
            k = _norm(it)
        if k and k not in seen:
            seen.add(k)
            out.append(it)
    return out


# ── UTF-8 mojibake normalizer (ISS-005) ───────────────────────────────────────
#
# Common Latin-1-as-UTF-8 (and OCR-character-confusion) glitches we observed
# in Phase E. These come from the PDF -> Azure OCR step, NOT from extraction
# logic, but they make extracted values look wrong (e.g. `Â°F`, `Ã 4`, units
# like `/1L`, `/HL`, `/pL` that should be `/µL`). The fix is a post-extraction
# canonical-character pass over every extracted string.
#
# Rule of thumb: only patterns that are *unambiguous* in this domain. We do
# NOT touch single Latin letters or numerics; we only restore symbols.

# Direct mojibake -> canonical character mappings.
_MOJIBAKE_LITERALS: tuple[tuple[str, str], ...] = (
    ("Â°", "°"),          # degree sign
    ("Â±", "±"),          # plus-minus
    ("Â¼", "¼"),
    ("Â½", "½"),
    ("Â¾", "¾"),
    ("Â ", " "),          # NBSP rendered as Â + space
    ("â€“", "–"),         # en dash
    ("â€”", "—"),         # em dash
    ("â€˜", "'"),
    ("â€™", "'"),
    ("â€œ", "\""),
    ("â€", "\""),
)

# Context-aware unit-fixes: only inside lab-unit / dose contexts. We rewrite
# digit-stripped variants (/1L /HL /pL /uL -> /µL ; mg/dL stays mg/dL).
# Pattern: a leading "/" or "·" then a misencoded micro character then "L"
# or "g/kg" etc.
_UNIT_MICROLITER = re.compile(r"(?<=/)(?:1|H|p|u|I|Î¼|Î¼|µ)L\b")
_DOSE_MICROGRAM = re.compile(r"(?<=[\s/])(?:1|H|p|u|Î¼)g(?=/kg|/h|\b)")

# "Ã" followed by a digit (with or without whitespace) is almost always "×"
# in clinical text — covers "5Ã6", "OD Ã 3", "haemodialysis Ã4", etc.
_MULTIPLY = re.compile(r"Ã\s*(?=\d)")


def _normalize_string(s: str) -> str:
    """Apply all mojibake fixes to one string. Returns the cleaned text."""
    if not s or not isinstance(s, str):
        return s
    out = s
    for bad, good in _MOJIBAKE_LITERALS:
        if bad in out:
            out = out.replace(bad, good)
    out = _UNIT_MICROLITER.sub("µL", out)
    out = _DOSE_MICROGRAM.sub("µg", out)
    out = _MULTIPLY.sub("× ", out)
    # Collapse any double spaces our × insert may have produced
    out = re.sub(r" {2,}", " ", out)
    return out


def _normalize_mojibake(data):
    """Recursively normalize every string in a nested dict/list. Pure function."""
    if isinstance(data, str):
        return _normalize_string(data)
    if isinstance(data, dict):
        return {k: _normalize_mojibake(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_normalize_mojibake(v) for v in data]
    return data


def _merge_chunk_dicts(dicts: list[dict]) -> dict:
    """Deterministically merge per-chunk extraction dicts — no data dropped."""
    if not dicts:
        return {}
    out: dict = {}
    for key in _REQUIRED_KEYS:
        if key in _SCALAR_FIRST:
            val = None
            for d in dicts:
                cand = d.get(key)
                if cand is not None and str(cand).strip():
                    val = cand
                    break
            out[key] = val
        elif key in _ACCUMULATE_TEXT:
            seen: set[str] = set()
            parts: list[str] = []
            for d in dicts:
                v = d.get(key)
                if isinstance(v, str) and v.strip() and _norm(v) not in seen:
                    seen.add(_norm(v))
                    parts.append(v.strip())
            out[key] = "\n\n".join(parts) if parts else None
        elif key in _DICT_FIELDS:
            sub_out: dict = {}
            for d in dicts:
                sub = d.get(key)
                if isinstance(sub, dict):
                    for sk, sv in sub.items():
                        if sub_out.get(sk) in (None, "") and sv not in (None, ""):
                            sub_out[sk] = sv
            out[key] = sub_out or None
        else:
            collected: list = []
            for d in dicts:
                v = d.get(key)
                if isinstance(v, list):
                    collected.extend(v)
            out[key] = _dedupe(
                collected,
                () if key in _STR_LIST_FIELDS else _LIST_DEDUPE_KEYS.get(key, ()),
            )
    return out


# ── NLP + regex fallback ───────────────────────────────────────────────────────


def _run_fallback(ocr_data: dict) -> dict:
    """Run spaCy + regex on the full OCR text. Returns a flat field dict."""
    full_text: str = ocr_data.get("full_text") or ""
    regex_result = regex_extractor.extract_from_text(full_text)
    nlp_result = spacy_extractor.extract_from_text(full_text)

    merged = {**regex_result}

    # spaCy name: use if regex didn't find one
    if "patient_name" not in merged and "patient_name" in nlp_result:
        merged["patient_name"] = nlp_result["patient_name"]

    # Date candidates: assign first two to admission/discharge if present
    candidates: list[str] = (
        merged.pop("date_candidates", None) or
        [_try_parse_nlp_date(d) for d in (nlp_result.get("date_candidates_nlp") or [])]
    )
    candidates = [c for c in candidates if c]
    if len(candidates) >= 1:
        merged.setdefault("admission_date", candidates[0])
    if len(candidates) >= 2:
        merged.setdefault("discharge_date", candidates[-1])

    return merged


def _try_parse_nlp_date(text: str) -> str | None:
    """Attempt to normalize a natural-language date string to ISO 8601."""
    from dateutil import parser as dateutil_parser  # noqa: PLC0415

    try:
        dt = dateutil_parser.parse(text, dayfirst=True)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


# ── Merge ──────────────────────────────────────────────────────────────────────


def _merge(llm_data: dict, fallback_data: dict) -> dict:
    """
    LLM values are primary. Fallback fills scalar fields that LLM left null.
    Lists and complex fields are never overwritten by fallback (too unreliable).
    """
    merged = dict(llm_data)
    for key in _SCALAR_FILLABLE:
        if (merged.get(key) is None) and (key in fallback_data):
            merged[key] = fallback_data[key]
    return merged


# ── Public extraction entry point ──────────────────────────────────────────────


def extract_structured(ocr_data: dict) -> StructuredData:
    """
    Page-aware chunked LLM extraction with deterministic merge.

    Long Indian K-shape / Ayushman discharge summaries (10–20 scanned pages,
    every lab parameter itemised) overflow a single call's 16K output cap and
    used to lose rows silently via JSON repair. The document is now split into
    page-grouped chunks under a token budget, each extracted independently,
    truncation-split on demand, then merged with no row dropped. The spaCy/
    regex fallback still fills scalar nulls. Coverage diagnostics are recorded
    in extraction_meta for the doctor-review UI.

    Synchronous — run in asyncio.to_thread() from async contexts.
    """
    pages = _ocr_pages(ocr_data)
    all_tables = ocr_data.get("tables") or []
    key_values = ocr_data.get("key_values") or {}

    meta: dict = {
        "pages_total": len(pages),
        "pages_with_content": [],
        "failed_pages": [],
        "truncated_chunks": [],
        "chunk_count": 0,
        "ocr_confidence": ocr_data.get("confidence"),
    }

    chunk_dicts: list[dict] = []
    if pages:
        chunks = _chunk_pages(pages, settings.extraction_chunk_token_budget)
        meta["chunk_count"] = len(chunks)
        for i, chunk in enumerate(chunks):
            parsed = _extract_chunk(
                chunk, all_tables, key_values,
                include_key_values=(i == 0), meta=meta,
            )
            if parsed:
                chunk_dicts.append(parsed)

    fallback_data = _run_fallback(ocr_data)

    if chunk_dicts:
        merged = _merge(_merge_chunk_dicts(chunk_dicts), fallback_data)
        source = "merged" if fallback_data else "llm"
    else:
        logger.warning("All LLM chunks failed — using NLP/regex fallback only")
        merged = fallback_data
        source = "nlp_fallback" if fallback_data else "failed"

    # ── ISS-005: normalize UTF-8 mojibake from the OCR pipeline ────────────────
    merged = _normalize_mojibake(merged)

    # ── Coverage summary for the doctor-review UI ─────────────────────────────
    all_nums = {n for n, _ in pages}
    covered = sorted(set(meta["pages_with_content"]))
    meta["pages_with_content"] = covered
    meta["pages_empty"] = sorted(all_nums - set(covered))
    meta["failed_pages"] = sorted(set(meta["failed_pages"]))
    low_conf = (
        isinstance(meta["ocr_confidence"], (int, float))
        and meta["ocr_confidence"] < 0.6
    )
    meta["low_ocr_confidence"] = bool(low_conf)
    meta["needs_doctor_review"] = bool(
        meta["pages_empty"]
        or meta["truncated_chunks"]
        or low_conf
        or source in ("nlp_fallback", "failed")
    )

    valid_fields = {f.name for f in dataclasses.fields(StructuredData)}
    filtered = {k: v for k, v in merged.items() if k in valid_fields}
    filtered["extraction_source"] = source
    filtered["extraction_meta"] = meta

    try:
        return StructuredData(**filtered)
    except TypeError as exc:
        logger.error(
            "StructuredData construction failed: %s — returning empty", exc
        )
        return StructuredData(extraction_source="failed", extraction_meta=meta)


# ── ICD-10 mapping (requires DB) ──────────────────────────────────────────────


_ICD10_QUERY = text("""
    SELECT code, description, similarity(description, :q) AS sim
    FROM icd10_codes
    WHERE similarity(description, :q) > 0.2
    ORDER BY sim DESC
    LIMIT 5
""")

# Threshold tuning (ISS-002): 0.4 was too permissive — long verbose source
# diagnoses matched short ICD descriptions on shared word fragments (e.g.
# "Systemic Hypertension" -> "Portal hypertension"). 0.5 is conservative
# enough to exclude those while still catching obvious matches.
_ICD10_AUTO_THRESHOLD = 0.5
_ICD10_CANDIDATE_THRESHOLD = 0.2

_ICD10_SOURCE_AUTO = "auto"            # sim > 0.5 — assigned automatically
_ICD10_SOURCE_CANDIDATE = "candidate"  # 0.2–0.5 — doctor chooses from list
_ICD10_SOURCE_MANUAL = "manual"        # no match — doctor must enter code manually

# Clinical abbreviation aliases (ISS-003) — when the source uses an Indian
# clinical abbreviation, also query against the expanded form so the
# pg_trgm lookup can find the matching ICD description (which is always
# spelled out). The first entry that produces a higher similarity wins.
# Keep concise: only common, unambiguous abbreviations.
_ICD10_ALIASES: dict[str, str] = {
    "ards": "acute respiratory distress syndrome",
    "aki": "acute kidney failure",
    "akf": "acute kidney failure",
    "ckd": "chronic kidney disease",
    "t2dm": "type 2 diabetes mellitus",
    "t1dm": "type 1 diabetes mellitus",
    "dm": "diabetes mellitus",
    "htn": "essential hypertension",
    "hypertension": "essential hypertension",
    "systemic hypertension": "essential hypertension",
    "mi": "myocardial infarction",
    "stemi": "st elevation myocardial infarction",
    "nstemi": "non st elevation myocardial infarction",
    "cad": "coronary artery disease",
    "cva": "cerebrovascular accident",
    "tia": "transient ischemic attack",
    "uti": "urinary tract infection",
    "copd": "chronic obstructive pulmonary disease",
    "hap": "hospital acquired pneumonia",
    "vap": "ventilator associated pneumonia",
    "cap": "community acquired pneumonia",
    "dvt": "deep vein thrombosis",
    "pe": "pulmonary embolism",
    "uri": "upper respiratory infection",
    "lrti": "lower respiratory tract infection",
    "afib": "atrial fibrillation",
    "af": "atrial fibrillation",
    "chf": "congestive heart failure",
    "hf": "heart failure",
    "sepsis with septic shock": "severe sepsis with septic shock",
    "cholelithiasis": "calculus of gallbladder",
}

# Strip clinical qualifiers that dilute trigram similarity without changing
# the underlying condition (resolved/recovered status, severity grades,
# parenthetical aetiology, treatment plan).
_ICD10_NOISE = re.compile(
    r"\b(uncontrolled|resolved|recovered|treated|stable|known|chronic|acute on chronic|"
    r"newly diagnosed|hba1c\s*\d+(\.\d+)?%?|stage\s*\d+|kdigo\s*stage\s*\d+|grade\s*\d+|"
    r"class\s*[ivx]+|moderate|severe|mild|on insulin|on metformin|for interval\s+\w+ectomy)\b",
    re.IGNORECASE,
)


def _clean_diagnosis(text: str) -> str:
    """
    Reduce a verbose diagnosis string to the underlying condition for ICD lookup.

    Strips parentheticals, anything after " - " (qualifiers like " - resolved"),
    common severity/management noise, then collapses whitespace. Original text
    is preserved on the candidate dict via the caller's raw_text field.
    """
    s = (text or "").strip()
    if not s:
        return ""
    # Drop trailing qualifiers introduced by " - " (e.g. " - resolved", " - for interval ...")
    if " - " in s:
        s = s.split(" - ", 1)[0]
    # Drop parentheticals — they're usually aetiology/details not in ICD descriptions
    s = re.sub(r"\([^)]*\)", " ", s)
    # Strip explicit noise terms
    s = _ICD10_NOISE.sub(" ", s)
    # Collapse whitespace and trim
    s = re.sub(r"\s+", " ", s).strip(" ,;-")
    return s


def _candidate_queries(diagnosis: str) -> list[str]:
    """
    Build the ordered list of query strings to try against icd10_codes.

    Order: cleaned text → alias expansion of cleaned → original.
    Earlier query that yields the best similarity wins.
    """
    cleaned = _clean_diagnosis(diagnosis)
    queries: list[str] = []
    if cleaned:
        queries.append(cleaned)
        alias = _ICD10_ALIASES.get(cleaned.lower())
        if alias and alias != cleaned.lower():
            queries.append(alias)
        # Also try alias by first 1-3 words (catches abbrev. as a prefix)
        first = cleaned.split(" ", 1)[0].lower()
        if first in _ICD10_ALIASES and _ICD10_ALIASES[first] not in queries:
            queries.append(_ICD10_ALIASES[first])
    if diagnosis and diagnosis.strip() != cleaned:
        queries.append(diagnosis.strip())
    # Deduplicate, preserving order
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        ql = q.lower()
        if ql and ql not in seen:
            seen.add(ql)
            out.append(q)
    return out


async def map_icd10_codes(
    primary_diagnosis: str | None,
    secondary_diagnoses: list[str],
    db: AsyncSession,
) -> tuple[dict | None, list[dict], list[dict], list[dict]]:
    """
    Map raw diagnosis text to ICD-10 codes via pg_trgm similarity.

    Returns:
      (icd10_primary, icd10_primary_candidates, icd10_secondary, icd10_secondary_candidates)

    icd10_primary — best match for primary diagnosis (or None)
    icd10_primary_candidates — candidate list if score is 0.2–_ICD10_AUTO_THRESHOLD
    icd10_secondary — best match per secondary diagnosis
    icd10_secondary_candidates — per secondary: candidates when score 0.2–_ICD10_AUTO_THRESHOLD
    """
    primary_result, primary_candidates = await _map_single(primary_diagnosis, db)
    secondary_results: list[dict] = []
    secondary_candidates: list[dict] = []

    for diag in secondary_diagnoses or []:
        result, candidates = await _map_single(diag, db)
        if result:
            secondary_results.append(result)
        if candidates:
            secondary_candidates.extend(candidates)

    return primary_result, primary_candidates, secondary_results, secondary_candidates


async def _map_single(
    diagnosis: str | None,
    db: AsyncSession,
) -> tuple[dict | None, list[dict]]:
    """
    Map one diagnosis string. Returns (best_match | None, candidates).

    Tries: (1) cleaned diagnosis, (2) abbreviation-expanded form, (3) original.
    Keeps the highest-similarity row across attempts. Auto-assigns only when
    that best similarity clears _ICD10_AUTO_THRESHOLD (0.5) — preventing the
    long-text-vs-short-ICD false positives seen in Phase E.
    """
    if not diagnosis or not diagnosis.strip():
        return None, []

    raw_text = diagnosis.strip()
    queries = _candidate_queries(raw_text)
    if not queries:
        return None, []

    # Run each query, keep the highest-similarity rowset.
    best_rows = []
    best_top_sim = 0.0
    for q in queries:
        rows = (await db.execute(_ICD10_QUERY, {"q": q})).fetchall()
        if not rows:
            continue
        top = float(rows[0].sim)
        if top > best_top_sim:
            best_top_sim = top
            best_rows = rows

    if not best_rows:
        return None, []

    best = best_rows[0]
    best_sim: float = float(best.sim)

    if best_sim > _ICD10_AUTO_THRESHOLD:
        return {
            "code": best.code,
            "description": best.description,
            "similarity": round(best_sim, 4),
            "source": _ICD10_SOURCE_AUTO,
            "raw_text": raw_text,
        }, []

    # candidate range: return all for doctor review
    candidates = [
        {
            "code": r.code,
            "description": r.description,
            "similarity": round(float(r.sim), 4),
            "source": _ICD10_SOURCE_CANDIDATE,
            "raw_text": raw_text,
        }
        for r in best_rows
    ]
    return None, candidates


# ── Drug normalization (requires DB) ──────────────────────────────────────────


_DRUG_EXACT_QUERY = text("""
    SELECT brand_name, generic_name
    FROM drug_mappings
    WHERE LOWER(brand_name) = LOWER(:name) OR LOWER(generic_name) = LOWER(:name)
    LIMIT 1
""")

_DRUG_FUZZY_QUERY = text("""
    SELECT brand_name, generic_name, similarity(brand_name, :q) AS sim
    FROM drug_mappings
    WHERE similarity(brand_name, :q) > 0.5
    ORDER BY sim DESC
    LIMIT 1
""")


async def map_drug_names(
    medications: list[dict],
    db: AsyncSession,
) -> list[dict]:
    """
    Normalize drug names in a medication list against the drug_mappings table.

    Each input dict must have at least a "name" key.
    Each output dict is the input dict with two fields added:
      normalized   bool — True if matched
      generic_name str | None — generic name if matched
    """
    result = []
    for med in medications:
        normalized = await _normalize_one_drug(med.get("name") or "", db)
        result.append({**med, **normalized})
    return result


async def _normalize_one_drug(name: str, db: AsyncSession) -> dict:
    """Return {normalized, generic_name} for a single drug name string."""
    if not name.strip():
        return {"normalized": False, "generic_name": None}

    # 1. Exact match (case-insensitive)
    row = (await db.execute(_DRUG_EXACT_QUERY, {"name": name.strip()})).first()
    if row:
        return {"normalized": True, "generic_name": row.generic_name}

    # 2. Trigram fuzzy match (threshold 0.5)
    row = (await db.execute(_DRUG_FUZZY_QUERY, {"q": name.strip()})).first()
    if row:
        return {"normalized": True, "generic_name": row.generic_name}

    return {"normalized": False, "generic_name": None}
