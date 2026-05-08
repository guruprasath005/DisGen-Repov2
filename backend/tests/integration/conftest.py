"""
Integration test fixtures.

Database: connects to disgen_test (settings.async_test_database_url).
Redis: replaced with an in-process FakeRedis server shared across the session.
MinIO: patched at the singleton level — no real bucket operations.
AWS Textract / Bedrock: patched at the LLM client level.

FastAPI app is configured via dependency_overrides so the production
database.AsyncSessionLocal is never touched by any test.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from auth.password import hash_password
from config import settings
from crypto import encrypt
from database import Base, get_db
from main import app
from models.audit import AuditLog
from models.compliance import ConsentRecord, HospitalConfig, RetentionSettings
from models.document import Document
from models.scheme import GeneratedSummary, Scheme
from models.structured_report import StructuredReport
from models.user import User

# ── Test database engine ──────────────────────────────────────────────────────
# NullPool is required for async pytest: asyncpg connections bind to the event
# loop that created them. With a pool, a connection created in the session loop
# would be reused by a function-scoped test in a different loop, causing
# "Future attached to a different loop". NullPool creates a fresh connection
# per checkout and closes it immediately on return, eliminating the issue.

_test_engine = create_async_engine(
    settings.async_test_database_url,
    poolclass=NullPool,
    echo=False,
)

_TestSession = async_sessionmaker(
    _test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _TestSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ── Schema setup ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="session", autouse=True)
def _create_test_schema():
    """Drop and recreate all tables in disgen_test once per session.

    Runs synchronously via asyncio.run() so it is loop-independent and
    compatible with function-scoped test loops (NullPool, no shared
    connections).  Drop-first guarantees a clean slate even when a previous
    session crashed before its teardown.
    """
    async def _setup():
        async with _test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.run_sync(Base.metadata.create_all)

    async def _teardown():
        async with _test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    asyncio.run(_setup())
    yield
    asyncio.run(_teardown())


@pytest_asyncio.fixture(autouse=True)
async def _truncate_tables():
    """Truncate all data tables between tests for full isolation."""
    yield
    async with _test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())


# ── Per-test FakeRedis ────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _patch_redis():
    """Replace every Redis singleton with an isolated FakeAsyncRedis per test.

    Each test gets a fresh in-memory store so rate-limit counters and session
    keys from earlier tests never bleed into later ones.
    """
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    with (
        patch("auth.service._redis", r),
        patch("routers.documents._redis", r),
    ):
        yield r


# ── MinIO patch ───────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _patch_minio():
    mock_minio = MagicMock()
    mock_minio.put_object = MagicMock(return_value=None)
    mock_minio.get_object = MagicMock(return_value=MagicMock(read=lambda: b"fake-pdf"))
    mock_minio.remove_object = MagicMock(return_value=None)
    with patch("storage.minio_client._minio", mock_minio):
        yield mock_minio


# ── Celery task patch ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _patch_celery():
    """Prevent any Celery task from being dispatched during tests."""
    with (
        patch("tasks.ocr_tasks.process_document.delay") as mock_ocr,
        patch("tasks.generate_tasks.generate_summary.delay") as mock_gen,
    ):
        mock_ocr.return_value = MagicMock(id=str(uuid.uuid4()))
        mock_gen.return_value = MagicMock(id=str(uuid.uuid4()))
        yield mock_ocr


# ── FastAPI dependency override ───────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _override_db():
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


# ── HTTP client ───────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac


# ── Test user helpers ─────────────────────────────────────────────────────────


async def _create_user(
    db: AsyncSession,
    *,
    role: str,
    username: str,
    password: str = "TestPass!123",
) -> User:
    user = User(
        id=uuid.uuid4(),
        username=username,
        full_name=f"Test {role.title()}",
        email=f"{username}@test.local",
        hashed_password=hash_password(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with _TestSession() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def super_admin_user(db_session):
    user = await _create_user(db_session, role="super_admin", username="superadmin_test")
    await db_session.commit()
    return user


@pytest_asyncio.fixture
async def admin_user(db_session):
    user = await _create_user(db_session, role="admin", username="admin_test")
    await db_session.commit()
    return user


@pytest_asyncio.fixture
async def doctor_user(db_session):
    user = await _create_user(db_session, role="doctor", username="doctor_test")
    await db_session.commit()
    return user


# ── Auth helpers ──────────────────────────────────────────────────────────────


async def login(client: AsyncClient, username: str, password: str = "TestPass!123") -> str:
    """Log in and return the access token."""
    response = await client.post(
        "/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest_asyncio.fixture
async def doctor_token(client, doctor_user):
    return await login(client, "doctor_test")


@pytest_asyncio.fixture
async def admin_token(client, admin_user):
    return await login(client, "admin_test")


@pytest_asyncio.fixture
async def super_admin_token(client, super_admin_user):
    return await login(client, "superadmin_test")


# ── Seed helpers ──────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def hospital_config(db_session):
    cfg = HospitalConfig(id=1, name="Test Hospital")
    db_session.add(cfg)
    await db_session.commit()
    return cfg


@pytest_asyncio.fixture
async def retention_settings(db_session):
    rs = RetentionSettings(id=1, retention_days=2555, anonymize_on_expiry=True)
    db_session.add(rs)
    await db_session.commit()
    return rs


@pytest_asyncio.fixture
async def pmjay_scheme(db_session):
    scheme = Scheme(
        id="pmjay",
        name="pmjay",
        label="PM-JAY",
        color="#1D4ED8",
        required_fields=[{"field": "pmjay_beneficiary_id", "label": "PMJAY Beneficiary ID"}],
        optional_fields=[],
        rules=["Use plain language."],
        pdf_sections=[],
        pdf_template="pmjay.html",
        is_builtin=True,
    )
    db_session.add(scheme)
    await db_session.commit()
    return scheme
