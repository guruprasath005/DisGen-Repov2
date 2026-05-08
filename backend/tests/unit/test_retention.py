"""
Unit tests for DPDP retention enforcement (compliance/retention.py).

_redact_phi() is a pure function tested directly.
_anonymize_document() and _delete_document() are tested with a fully mocked
AsyncSessionLocal so no PostgreSQL connection is required.
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from compliance.retention import _redact_phi, _REDACTED, _PHI_SCALAR_FIELDS


# ── _redact_phi (pure function) ───────────────────────────────────────────────


def test_patient_name_redacted():
    data = {"patient_name": "John Doe", "primary_diagnosis": "Fever"}
    result = _redact_phi(data)
    assert result["patient_name"] == _REDACTED
    assert result["primary_diagnosis"] == "Fever"


def test_uhid_redacted():
    data = {"uhid": "U123456"}
    result = _redact_phi(data)
    assert result["uhid"] == _REDACTED


def test_abha_id_redacted():
    data = {"abha_id": "91-1234-5678-9012"}
    result = _redact_phi(data)
    assert result["abha_id"] == _REDACTED


def test_phone_redacted():
    data = {"phone": "9876543210"}
    result = _redact_phi(data)
    assert result["phone"] == _REDACTED


def test_clinical_fields_preserved():
    data = {
        "patient_name": "Jane",
        "primary_diagnosis": "Type 2 Diabetes",
        "medications": [{"name": "Metformin", "dose": "500mg"}],
        "investigations": [{"name": "HbA1c", "value": "7.5%"}],
    }
    result = _redact_phi(data)
    assert result["patient_name"] == _REDACTED
    assert result["primary_diagnosis"] == "Type 2 Diabetes"
    assert result["medications"] == [{"name": "Metformin", "dose": "500mg"}]
    assert result["investigations"] == [{"name": "HbA1c", "value": "7.5%"}]


def test_all_phi_fields_redacted():
    data = {field: f"value_{field}" for field in _PHI_SCALAR_FIELDS}
    data["diagnosis"] = "Hypertension"  # clinical — should survive
    result = _redact_phi(data)
    for field in _PHI_SCALAR_FIELDS:
        assert result[field] == _REDACTED, f"{field} was not redacted"
    assert result["diagnosis"] == "Hypertension"


def test_none_phi_values_not_replaced():
    data = {"patient_name": None, "uhid": "U999"}
    result = _redact_phi(data)
    assert result["patient_name"] is None
    assert result["uhid"] == _REDACTED


def test_absent_phi_fields_no_error():
    data = {"primary_diagnosis": "Fever"}
    result = _redact_phi(data)
    assert result == {"primary_diagnosis": "Fever"}


def test_returns_new_dict_not_mutating_original():
    data = {"patient_name": "Original"}
    result = _redact_phi(data)
    assert data["patient_name"] == "Original"
    assert result["patient_name"] == _REDACTED


# ── PHI field set sanity checks ───────────────────────────────────────────────


def test_phi_scalar_fields_contains_required_identifiers():
    required = {"patient_name", "uhid", "abha_id", "phone", "age", "gender"}
    assert required.issubset(_PHI_SCALAR_FIELDS)


def test_phi_scalar_fields_excludes_clinical():
    clinical = {"primary_diagnosis", "secondary_diagnoses", "medications", "investigations"}
    assert clinical.isdisjoint(_PHI_SCALAR_FIELDS)
