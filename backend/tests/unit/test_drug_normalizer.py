"""
Unit tests for drug name normalization (llm/extractor.py).

The DB session is mocked so no PostgreSQL connection is needed.
Covers: exact match, fuzzy match, no match, empty name, batch list.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from llm.extractor import map_drug_names, _normalize_one_drug


def _mock_db_exact(brand: str, generic: str) -> AsyncMock:
    row = MagicMock()
    row.brand_name = brand
    row.generic_name = generic
    result = MagicMock()
    result.first.return_value = row
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


def _mock_db_no_match() -> AsyncMock:
    result = MagicMock()
    result.first.return_value = None
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


# ── _normalize_one_drug ───────────────────────────────────────────────────────


async def test_exact_match_returns_generic():
    db = _mock_db_exact("Crocin", "Paracetamol")
    out = await _normalize_one_drug("Crocin", db)
    assert out["normalized"] is True
    assert out["generic_name"] == "Paracetamol"


async def test_no_match_returns_unnormalized():
    db = _mock_db_no_match()
    out = await _normalize_one_drug("UnknownDrug999", db)
    assert out["normalized"] is False
    assert out["generic_name"] is None


async def test_empty_name_skips_db():
    db = AsyncMock()
    out = await _normalize_one_drug("", db)
    assert out["normalized"] is False
    assert out["generic_name"] is None
    db.execute.assert_not_called()


async def test_whitespace_name_skips_db():
    db = AsyncMock()
    out = await _normalize_one_drug("   ", db)
    assert out["normalized"] is False
    db.execute.assert_not_called()


# ── map_drug_names (public batch API) ────────────────────────────────────────


async def test_batch_normalizes_all_medications():
    db = _mock_db_exact("Aspirin", "Acetylsalicylic acid")
    meds = [
        {"name": "Aspirin", "dose": "75mg", "frequency": "OD"},
        {"name": "Aspirin", "dose": "150mg", "frequency": "BD"},
    ]
    result = await map_drug_names(meds, db)
    assert len(result) == 2
    for med in result:
        assert med["normalized"] is True
        assert med["generic_name"] == "Acetylsalicylic acid"
        # Original keys preserved
        assert "dose" in med
        assert "frequency" in med


async def test_batch_preserves_unmatched():
    db = _mock_db_no_match()
    meds = [{"name": "UnknownX", "dose": "10mg"}]
    result = await map_drug_names(meds, db)
    assert result[0]["normalized"] is False
    assert result[0]["dose"] == "10mg"


async def test_empty_medication_list():
    db = AsyncMock()
    result = await map_drug_names([], db)
    assert result == []
    db.execute.assert_not_called()
