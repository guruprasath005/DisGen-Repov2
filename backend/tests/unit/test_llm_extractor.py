"""
Unit tests for LLM extraction merge logic (llm/extractor.py).

_merge() is a pure function: LLM fields take priority; fallback fills nulls
for the scalar fields listed in _SCALAR_FILLABLE.  No LLM API call is made.
"""

from llm.extractor import _merge, _SCALAR_FILLABLE


def test_llm_field_takes_priority_over_fallback():
    llm = {"patient_name": "From LLM", "age": "45 years"}
    fallback = {"patient_name": "From Fallback", "age": "50 years"}
    result = _merge(llm, fallback)
    assert result["patient_name"] == "From LLM"
    assert result["age"] == "45 years"


def test_fallback_fills_null_scalar_field():
    llm = {"patient_name": None, "age": None, "uhid": None}
    fallback = {"patient_name": "Fallback Name", "uhid": "U99999"}
    result = _merge(llm, fallback)
    assert result["patient_name"] == "Fallback Name"
    assert result["uhid"] == "U99999"


def test_fallback_does_not_overwrite_non_null_llm():
    llm = {"patient_name": "LLM Name", "phone": "9876543210"}
    fallback = {"patient_name": "Other", "phone": "1111111111"}
    result = _merge(llm, fallback)
    assert result["patient_name"] == "LLM Name"
    assert result["phone"] == "9876543210"


def test_fallback_only_fills_scalar_fillable_keys():
    # Lists (e.g. secondary_diagnoses) must never be overwritten by fallback.
    llm = {"secondary_diagnoses": [], "patient_name": None}
    fallback = {"secondary_diagnoses": ["Hypertension"], "patient_name": "Test"}
    result = _merge(llm, fallback)
    # patient_name (scalar fillable) filled
    assert result["patient_name"] == "Test"
    # secondary_diagnoses (not in _SCALAR_FILLABLE) stays as empty list
    assert result["secondary_diagnoses"] == []


def test_scalar_fillable_set_is_non_empty():
    assert len(_SCALAR_FILLABLE) > 0
    assert "patient_name" in _SCALAR_FILLABLE
    assert "uhid" in _SCALAR_FILLABLE
    assert "phone" in _SCALAR_FILLABLE


def test_merge_with_empty_fallback():
    llm = {"patient_name": None, "age": "30 years"}
    result = _merge(llm, {})
    assert result["patient_name"] is None
    assert result["age"] == "30 years"


def test_merge_with_empty_llm():
    fallback = {"patient_name": "Fallback"}
    result = _merge({}, fallback)
    # dict.get() returns None for absent keys, so fallback fills scalar fields
    # even when they are absent from the LLM dict (not just explicitly None).
    assert result.get("patient_name") == "Fallback"


def test_merge_preserves_extra_llm_keys():
    llm = {"patient_name": "Name", "custom_field": "value"}
    fallback = {}
    result = _merge(llm, fallback)
    assert result["custom_field"] == "value"
