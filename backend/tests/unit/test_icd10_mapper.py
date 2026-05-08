"""
Unit tests for ICD-10 mapping threshold logic (llm/extractor.py).

The DB is replaced with an AsyncMock that returns fake row objects so no
PostgreSQL connection is needed.  Tests exercise the auto/candidate/no-match
branching at similarity thresholds > 0.4, 0.2–0.4, and < 0.2.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.extractor import map_icd10_codes, _map_single


def _make_row(code: str, description: str, sim: float):
    row = MagicMock()
    row.code = code
    row.description = description
    row.sim = sim
    return row


def _mock_db(rows: list) -> AsyncMock:
    """Return an AsyncMock DB session whose execute() yields given rows."""
    result = MagicMock()
    result.fetchall.return_value = rows
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


# ── _map_single ───────────────────────────────────────────────────────────────


async def test_high_similarity_returns_auto_match():
    db = _mock_db([_make_row("J18.0", "Pneumonia unspecified", 0.82)])
    best, candidates = await _map_single("pneumonia", db)
    assert best is not None
    assert best["code"] == "J18.0"
    assert best["source"] == "auto"
    assert candidates == []


async def test_mid_similarity_returns_candidates():
    rows = [
        _make_row("J18.0", "Pneumonia", 0.30),
        _make_row("J18.1", "Lobar pneumonia", 0.25),
    ]
    db = _mock_db(rows)
    best, candidates = await _map_single("pneumonia", db)
    assert best is None
    assert len(candidates) == 2
    assert candidates[0]["source"] == "candidate"


async def test_below_threshold_returns_no_match():
    db = _mock_db([_make_row("J18.0", "Pneumonia", 0.10)])
    best, candidates = await _map_single("cough", db)
    # sim < 0.2: best is None and candidates contain the row
    assert best is None


async def test_empty_diagnosis_returns_no_match():
    db = _mock_db([])
    best, candidates = await _map_single("", db)
    assert best is None
    assert candidates == []


async def test_none_diagnosis_returns_no_match():
    db = _mock_db([])
    best, candidates = await _map_single(None, db)
    assert best is None
    assert candidates == []


# ── map_icd10_codes (public API) ──────────────────────────────────────────────


async def test_map_icd10_codes_primary_auto():
    db = _mock_db([_make_row("E11.9", "Type 2 diabetes mellitus", 0.75)])
    primary, p_cands, secondary, s_cands = await map_icd10_codes(
        "type 2 diabetes", [], db
    )
    assert primary is not None
    assert primary["code"] == "E11.9"
    assert secondary == []


async def test_map_icd10_codes_with_secondary():
    rows_primary = [_make_row("I10", "Essential hypertension", 0.90)]
    rows_secondary = [_make_row("E11.9", "Type 2 diabetes", 0.85)]

    call_count = 0

    async def side_effect(query, params):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        if call_count == 1:
            result.fetchall.return_value = rows_primary
        else:
            result.fetchall.return_value = rows_secondary
        return result

    db = AsyncMock()
    db.execute = side_effect

    primary, _, secondary, _ = await map_icd10_codes(
        "hypertension", ["diabetes"], db
    )
    assert primary["code"] == "I10"
    assert len(secondary) == 1
    assert secondary[0]["code"] == "E11.9"
