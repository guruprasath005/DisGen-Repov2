"""
Integration tests for the auth flow: login → refresh → logout → blacklist.

All HTTP calls go through the real FastAPI app against disgen_test.
Redis is replaced with FakeRedis (from conftest).
"""

import pytest


async def test_login_returns_access_token(client, doctor_user):
    response = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_login_sets_refresh_cookie(client, doctor_user):
    response = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    assert response.status_code == 200
    assert "refresh_token" in response.cookies


async def test_login_wrong_password_401(client, doctor_user):
    response = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "WrongPassword!"},
    )
    assert response.status_code == 401


async def test_login_unknown_user_401(client):
    response = await client.post(
        "/auth/login",
        json={"username": "nobody", "password": "anything"},
    )
    assert response.status_code == 401


async def test_me_endpoint_returns_user(client, doctor_token):
    response = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "doctor_test"
    assert data["role"] == "doctor"


async def test_me_without_token_401(client):
    response = await client.get("/auth/me")
    assert response.status_code in (401, 403)


async def test_me_with_invalid_token_401(client):
    response = await client.get(
        "/auth/me",
        headers={"Authorization": "Bearer totallyinvalidtoken"},
    )
    assert response.status_code == 401


async def test_refresh_returns_new_access_token(client, doctor_user):
    # Login to get refresh cookie.
    login_resp = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    assert login_resp.status_code == 200

    # The refresh_token cookie has secure=True so httpx won't auto-send it on
    # http://testserver — pass it explicitly.
    refresh_cookie = login_resp.cookies.get("refresh_token")
    refresh_resp = await client.post(
        "/auth/refresh",
        cookies={"refresh_token": refresh_cookie},
    )
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()


async def test_logout_blacklists_access_token(client, doctor_user):
    login_resp = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    access_token = login_resp.json()["access_token"]

    # Logout.
    await client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    # Access token must now be rejected.
    me_resp = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert me_resp.status_code == 401


async def test_inactive_user_rejected(client, db_session, doctor_user):
    from sqlalchemy import select
    from models.user import User

    result = await db_session.execute(
        select(User).where(User.username == "doctor_test")
    )
    user = result.scalar_one()
    user.is_active = False
    await db_session.commit()

    response = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    assert response.status_code == 401
