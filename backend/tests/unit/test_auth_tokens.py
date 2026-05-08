"""
Unit tests for RS256 JWT creation/validation and Redis blacklist (auth/service.py).

Redis is replaced with an in-process FakeRedis instance so no external service
is needed.  The real JWT keys on disk (mounted at /app/auth/keys/) are used —
this validates the full RS256 sign/verify path.
"""

import time
import uuid
from unittest.mock import patch

import fakeredis
import pytest

from auth.service import (
    blacklist_token,
    create_access_token,
    create_refresh_token,
    decode_token,
    is_blacklisted,
    register_session,
    get_active_sessions,
    revoke_all_sessions,
    try_blacklist_token,
    unregister_session,
)


class _MockUser:
    id = uuid.UUID("00000000-0000-0000-0000-000000000001")
    username = "testdoctor"
    role = "doctor"


@pytest.fixture
def fake_redis():
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    with patch("auth.service._redis", r):
        yield r


# ── JWT creation and decode ───────────────────────────────────────────────────


def test_access_token_payload():
    token = create_access_token(_MockUser())
    payload = decode_token(token)
    assert payload["sub"] == str(_MockUser.id)
    assert payload["username"] == "testdoctor"
    assert payload["role"] == "doctor"
    assert payload["type"] == "access"
    assert "jti" in payload
    assert "exp" in payload


def test_refresh_token_payload():
    token = create_refresh_token(_MockUser())
    payload = decode_token(token)
    assert payload["sub"] == str(_MockUser.id)
    assert payload["type"] == "refresh"
    assert "jti" in payload


def test_access_and_refresh_have_different_jtis():
    at = decode_token(create_access_token(_MockUser()))
    rt = decode_token(create_refresh_token(_MockUser()))
    assert at["jti"] != rt["jti"]


def test_access_token_expires_later_than_now():
    payload = decode_token(create_access_token(_MockUser()))
    assert payload["exp"] > int(time.time())


def test_refresh_token_longer_expiry_than_access():
    at_payload = decode_token(create_access_token(_MockUser()))
    rt_payload = decode_token(create_refresh_token(_MockUser()))
    assert rt_payload["exp"] > at_payload["exp"]


# ── Blacklist ─────────────────────────────────────────────────────────────────


async def test_blacklist_and_check(fake_redis):
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await blacklist_token(jti, exp)
    assert await is_blacklisted(jti)


async def test_unknown_jti_not_blacklisted(fake_redis):
    assert not await is_blacklisted(str(uuid.uuid4()))


async def test_expired_blacklist_not_added(fake_redis):
    jti = str(uuid.uuid4())
    past_exp = int(time.time()) - 1  # already expired
    await blacklist_token(jti, past_exp)
    assert not await is_blacklisted(jti)


# ── Session registry ──────────────────────────────────────────────────────────


async def test_register_and_list_session(fake_redis):
    user_id = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await register_session(user_id, jti, exp)
    sessions = await get_active_sessions(user_id)
    assert any(s["jti"] == jti for s in sessions)


async def test_unregister_removes_session(fake_redis):
    user_id = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await register_session(user_id, jti, exp)
    await unregister_session(user_id, jti)
    sessions = await get_active_sessions(user_id)
    assert not any(s["jti"] == jti for s in sessions)


async def test_revoke_all_sessions_blacklists_tokens(fake_redis):
    user_id = str(uuid.uuid4())
    jti1 = str(uuid.uuid4())
    jti2 = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await register_session(user_id, jti1, exp)
    await register_session(user_id, jti2, exp)
    count = await revoke_all_sessions(user_id)
    assert count == 2
    assert await is_blacklisted(jti1)
    assert await is_blacklisted(jti2)
    sessions = await get_active_sessions(user_id)
    assert sessions == []


async def test_blacklisted_session_excluded_from_active(fake_redis):
    user_id = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await register_session(user_id, jti, exp)
    await blacklist_token(jti, exp)
    sessions = await get_active_sessions(user_id)
    assert not any(s["jti"] == jti for s in sessions)


# ── Atomic try_blacklist_token ────────────────────────────────────────────────


async def test_try_blacklist_first_use_returns_false(fake_redis):
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    reuse = await try_blacklist_token(jti, exp)
    assert reuse is False
    assert await is_blacklisted(jti)


async def test_try_blacklist_second_use_returns_true(fake_redis):
    jti = str(uuid.uuid4())
    exp = int(time.time()) + 3600
    await try_blacklist_token(jti, exp)
    reuse = await try_blacklist_token(jti, exp)
    assert reuse is True


async def test_try_blacklist_expired_token_returns_false(fake_redis):
    jti = str(uuid.uuid4())
    past_exp = int(time.time()) - 1
    reuse = await try_blacklist_token(jti, past_exp)
    assert reuse is False
    assert not await is_blacklisted(jti)
