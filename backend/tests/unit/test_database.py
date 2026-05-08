"""
Tests for database engine configuration.
"""

import importlib
from unittest.mock import patch, MagicMock


def test_api_engine_has_pool_recycle():
    """API engine must have pool_recycle set to prevent stale-connection errors after 30 min idle."""
    captured = {}

    original_create = None

    def mock_create_async_engine(url, **kwargs):
        captured.update(kwargs)
        m = MagicMock()
        m.dispose = MagicMock()
        return m

    with patch("sqlalchemy.ext.asyncio.create_async_engine", side_effect=mock_create_async_engine):
        import database as db_module
        importlib.reload(db_module)

    assert "pool_recycle" in captured, "pool_recycle must be set on the API engine"
    assert captured["pool_recycle"] == 1800, "pool_recycle should be 1800 seconds (30 min)"


def test_api_engine_pool_size():
    """API engine pool must be sized for concurrent FastAPI workers."""
    captured = {}

    def mock_create_async_engine(url, **kwargs):
        captured.update(kwargs)
        m = MagicMock()
        return m

    with patch("sqlalchemy.ext.asyncio.create_async_engine", side_effect=mock_create_async_engine):
        import database as db_module
        importlib.reload(db_module)

    assert captured.get("pool_size", 0) >= 10
    assert captured.get("max_overflow", 0) >= 10
