"""
Unit tests for the regex-based OCR fallback extractor (nlp/extractor.py).

Pure regex patterns — no DB, no LLM, no spaCy model required.
"""

from nlp.extractor import extract_from_text


def test_empty_text_returns_empty_dict():
    assert extract_from_text("") == {}


def test_uhid_with_dash():
    result = extract_from_text("UHID-789123 Patient admitted.")
    assert result.get("uhid") == "789123"


def test_uhid_without_separator():
    result = extract_from_text("UHID123456 is the patient identifier.")
    assert result.get("uhid") == "123456"


def test_abha_id_extracted():
    result = extract_from_text("ABHA Number: 91-1234-5678-9012")
    assert result.get("abha_id") == "91-1234-5678-9012"


def test_indian_mobile_number():
    result = extract_from_text("Contact patient at 9876543210 for follow-up.")
    assert result.get("phone") == "9876543210"


def test_phone_starting_with_6():
    result = extract_from_text("Mobile: 6543210987")
    assert result.get("phone") == "6543210987"


def test_blood_pressure_mmhg():
    result = extract_from_text("BP: 130/85 mmHg on admission.")
    assert "blood_pressure" in result
    assert "130/85" in result["blood_pressure"]


def test_temperature_celsius():
    result = extract_from_text("Temp 38.5°C, Pulse 92 bpm")
    assert "temperature" in result
    assert "38.5" in result["temperature"]


def test_spo2_extraction():
    result = extract_from_text("SpO2: 96% on room air")
    assert result.get("oxygen_saturation") == "96%"


def test_pulse_extraction():
    result = extract_from_text("HR: 88 bpm, regular rhythm")
    assert "pulse_rate" in result
    assert "88" in result["pulse_rate"]


def test_age_gender_slash_pattern():
    result = extract_from_text("Patient 45/M presented with chest pain.")
    assert result.get("age") == "45 years"
    assert result.get("gender") == "Male"


def test_age_gender_slash_female():
    result = extract_from_text("32/F admitted with abdominal pain.")
    assert result.get("age") == "32 years"
    assert result.get("gender") == "Female"


def test_age_years_standalone():
    result = extract_from_text("Age: 60 years, male patient")
    assert result.get("age") == "60 years"


def test_iso_date_collected():
    result = extract_from_text("Admission: 2024-03-15, Discharge: 2024-03-20")
    candidates = result.get("date_candidates", [])
    assert "2024-03-15" in candidates
    assert "2024-03-20" in candidates


def test_dmy_date_normalized_to_iso():
    result = extract_from_text("Admitted on 15/03/2024.")
    candidates = result.get("date_candidates", [])
    assert "2024-03-15" in candidates


def test_no_false_positive_phone_in_longer_number():
    # A number with >10 digits should not match the 10-digit Indian mobile pattern.
    result = extract_from_text("Account number 123456789012345")
    assert "phone" not in result


def test_date_candidates_capped_at_eight():
    text = " ".join(
        f"2024-01-{str(d).zfill(2)}" for d in range(1, 15)
    )
    result = extract_from_text(text)
    assert len(result.get("date_candidates", [])) <= 8
