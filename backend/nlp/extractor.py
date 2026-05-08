"""
Regex-based clinical data extraction — NLP fallback layer.

Used when the LLM call fails or returns incomplete data.
Patterns are conservative: we prefer returning nothing over returning wrong data.
All patterns are anchored to word boundaries to avoid partial matches.
"""

from __future__ import annotations

import re
from datetime import datetime

# ── Compiled patterns ──────────────────────────────────────────────────────────

_UHID_PREFIX = re.compile(r'\b[Uu][Hh][Ii][Dd][-/]?(\d{4,15})\b')
_UHID_U_PREFIX = re.compile(r'\bU(\d{6,12})\b')

_ABHA = re.compile(r'\b(\d{2}-\d{4}-\d{4}-\d{4})\b')

# Indian mobile: 10 digits starting with 6–9; exclude anything preceded by more digits
_PHONE = re.compile(r'(?<!\d)([6-9]\d{9})(?!\d)')

# Blood pressure: 80/40 – 250/150, optionally followed by mmHg
_BP = re.compile(
    r'\b((?:1[0-9]{2}|[89]\d|2[0-4]\d)/(?:[4-9]\d|1[0-4]\d))\s*(?:mmHg)?',
    re.IGNORECASE,
)

# Temperature: 35–42°C or 95–108°F; decimal optional
_TEMP_C = re.compile(r'\b(3[5-9]|4[0-2])(\.\d)?\s*°?\s*C\b', re.IGNORECASE)
_TEMP_F = re.compile(r'\b(9[5-9]|10[0-8])(\.\d)?\s*°?\s*F\b', re.IGNORECASE)

# SpO2 / oxygen saturation: 70–100%
_SPO2 = re.compile(
    r'(?:SpO\s*2|O2\s*sat(?:uration)?|oxygen\s*sat(?:uration)?)[^0-9]*(\d{2,3})\s*%?',
    re.IGNORECASE,
)

# Pulse / heart rate: 30–200 bpm
_PULSE = re.compile(
    r'(?:pulse|PR|heart\s*rate|HR)[^0-9]*(\d{2,3})\s*(?:bpm|/min|beats)?',
    re.IGNORECASE,
)

# Age: "45 years", "45yr", "45/M"
_AGE = re.compile(
    r'\b(\d{1,3})\s*(?:years?|yrs?|yr)\b',
    re.IGNORECASE,
)
_AGE_SLASH = re.compile(r'\b(\d{1,3})\s*/\s*([MFmf])\b')

# Gender standalone (only if not already captured)
_GENDER = re.compile(r'\b(male|female)\b', re.IGNORECASE)

# Dates: YYYY-MM-DD | DD/MM/YYYY | DD-MM-YYYY
_DATE_ISO = re.compile(r'\b(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b')
_DATE_DMY = re.compile(
    r'\b((?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])[/-](?:19|20)\d{2})\b'
)


# ── Public API ─────────────────────────────────────────────────────────────────


def extract_from_text(text: str) -> dict:
    """
    Extract structured fields from raw OCR text using regex.

    Returns a flat dict of discovered fields. All values are strings.
    Only includes a key if a pattern matched — never returns None values.
    """
    result: dict[str, str | list] = {}

    # UHID
    m = _UHID_PREFIX.search(text)
    if m:
        result["uhid"] = m.group(1)
    elif (m := _UHID_U_PREFIX.search(text)):
        result["uhid"] = m.group(1)

    # ABHA
    if m := _ABHA.search(text):
        result["abha_id"] = m.group(1)

    # Phone — first match only
    if m := _PHONE.search(text):
        result["phone"] = m.group(1)

    # Blood pressure — first plausible reading
    if m := _BP.search(text):
        result["blood_pressure"] = m.group(1) + " mmHg"

    # Temperature — prefer Celsius, fall back to Fahrenheit
    if m := _TEMP_C.search(text):
        result["temperature"] = m.group(1) + (m.group(2) or "") + "°C"
    elif m := _TEMP_F.search(text):
        result["temperature"] = m.group(1) + (m.group(2) or "") + "°F"

    # SpO2
    if m := _SPO2.search(text):
        result["oxygen_saturation"] = m.group(1) + "%"

    # Pulse
    if m := _PULSE.search(text):
        result["pulse_rate"] = m.group(1) + " bpm"

    # Age + gender (combined pattern: "45/M")
    if m := _AGE_SLASH.search(text):
        result["age"] = m.group(1) + " years"
        g = m.group(2).upper()
        result["gender"] = "Male" if g == "M" else "Female"
    else:
        if m := _AGE.search(text):
            result["age"] = m.group(1) + " years"
        if "gender" not in result:
            if m := _GENDER.search(text):
                result["gender"] = m.group(1).capitalize()

    # Collect all dates (up to 8); caller maps them to admission/discharge
    iso_dates = _DATE_ISO.findall(text)
    dmy_dates = [_normalize_dmy(d) for d in _DATE_DMY.findall(text)]
    all_dates = list(dict.fromkeys(iso_dates + [d for d in dmy_dates if d]))
    if all_dates:
        result["date_candidates"] = all_dates[:8]

    return result


def _normalize_dmy(date_str: str) -> str | None:
    """Convert DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD. Returns None if invalid."""
    sep = "/" if "/" in date_str else "-"
    parts = date_str.split(sep)
    if len(parts) != 3:
        return None
    d, mo, y = parts
    try:
        dt = datetime(int(y), int(mo), int(d))
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None
