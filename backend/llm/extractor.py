"""
LLM-based structured clinical data extraction + ICD-10 / drug mapping.

Extraction flow
───────────────
1. Build prompt from OCR result: full text + markdown tables + key-value pairs
2. Call OpenAI GPT-4o mini (JSON mode, temperature=0)
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
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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

    GPT-4o mini has a 128K token context window — the entire document is
    sent without truncation so no data is lost for the doctor review screen.
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


def _call_llm(ocr_data: dict) -> dict | None:
    """
    Call OpenAI GPT-4o mini and parse the JSON response.
    Returns the parsed dict on success, None on any failure.
    """
    user_message = _build_user_message(ocr_data)
    try:
        response_text = LLMClient.get_instance().chat(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.0,
            top_p=1.0,
            max_tokens=16383,
            json_mode=True,
        )
    except Exception as exc:
        logger.error("LLM API call failed: %s", exc)
        return None

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned invalid JSON (likely truncated): %s — attempting repair", exc)
        try:
            from json_repair import repair_json  # noqa: PLC0415
            parsed = json.loads(repair_json(response_text))
            logger.info("JSON repair succeeded — proceeding with repaired response")
        except Exception as repair_exc:
            logger.error("JSON repair also failed: %s — raw: %.200s", repair_exc, response_text)
            return None

    if not isinstance(parsed, dict):
        logger.error("LLM response is not a JSON object: %.100s", response_text)
        return None

    # Verify all required keys are present
    missing = _REQUIRED_KEYS - parsed.keys()
    if missing:
        logger.warning("LLM response missing keys: %s — filling with nulls", missing)
        _list_keys = {
            "secondary_diagnoses", "presenting_complaints", "investigations",
            "procedures", "medications_during_stay", "discharge_medications",
            "discharge_advice", "past_medical_history", "past_surgical_history",
            "comorbidities", "post_operative_course", "imaging", "serology",
            "urine_findings",
        }
        for k in missing:
            parsed[k] = [] if k in _list_keys else None

    return parsed


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
    Run LLM extraction on the OCR payload dict.

    On LLM success: merge with NLP fallback (fills any nulls).
    On LLM failure: NLP/regex only, extraction_source = "nlp_fallback".
    On total failure: empty StructuredData, extraction_source = "failed".

    This function is synchronous — it calls the Bedrock SDK directly.
    Run it in asyncio.to_thread() if you need to avoid blocking an event loop.
    """
    llm_data = _call_llm(ocr_data)
    fallback_data = _run_fallback(ocr_data)

    if llm_data is not None:
        merged = _merge(llm_data, fallback_data)
        source = "merged" if fallback_data else "llm"
    else:
        logger.warning("LLM extraction failed — using NLP/regex fallback only")
        merged = fallback_data
        source = "nlp_fallback" if fallback_data else "failed"

    # Hydrate into StructuredData — unknown/extra keys are silently dropped
    valid_fields = {f.name for f in dataclasses.fields(StructuredData)}
    filtered = {k: v for k, v in merged.items() if k in valid_fields}
    filtered["extraction_source"] = source

    try:
        return StructuredData(**filtered)
    except TypeError as exc:
        logger.error("StructuredData construction failed: %s — returning empty", exc)
        return StructuredData(extraction_source="failed")


# ── ICD-10 mapping (requires DB) ──────────────────────────────────────────────


_ICD10_QUERY = text("""
    SELECT code, description, similarity(description, :q) AS sim
    FROM icd10_codes
    WHERE similarity(description, :q) > 0.2
    ORDER BY sim DESC
    LIMIT 5
""")

_ICD10_SOURCE_AUTO = "auto"        # sim > 0.4 — assigned automatically
_ICD10_SOURCE_CANDIDATE = "candidate"  # 0.2–0.4 — doctor chooses from list
_ICD10_SOURCE_MANUAL = "manual"    # no match — doctor must enter code manually


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
    icd10_primary_candidates — candidate list if score is 0.2–0.4
    icd10_secondary — best match per secondary diagnosis
    icd10_secondary_candidates — per secondary: candidates when score 0.2–0.4
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

    best_match  — {code, description, similarity, source} when sim > 0.4
    candidates  — [{code, description, similarity}] when sim is 0.2–0.4
    """
    if not diagnosis or not diagnosis.strip():
        return None, []

    rows = (await db.execute(_ICD10_QUERY, {"q": diagnosis.strip()})).fetchall()
    if not rows:
        return None, []

    best = rows[0]
    best_sim: float = float(best.sim)

    if best_sim > 0.4:
        return {
            "code": best.code,
            "description": best.description,
            "similarity": round(best_sim, 4),
            "source": _ICD10_SOURCE_AUTO,
            "raw_text": diagnosis,
        }, []

    # 0.2 – 0.4 range: return as candidates for doctor review
    candidates = [
        {
            "code": r.code,
            "description": r.description,
            "similarity": round(float(r.sim), 4),
            "source": _ICD10_SOURCE_CANDIDATE,
            "raw_text": diagnosis,
        }
        for r in rows
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
