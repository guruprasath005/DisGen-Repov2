"""
Integration tests for role-based access control.

Each protected endpoint is called with every role (and unauthenticated) to
verify correct 403 / 401 responses.  Tests never reach business logic — the
role guard fires first.
"""

import pytest


# ── /documents/upload — doctor only ──────────────────────────────────────────


async def test_upload_admin_gets_403(client, admin_token):
    response = await client.post(
        "/documents/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("x.pdf", b"data", "application/pdf")},
        data={"consent_given": "true", "consent_method": "written", "patient_name": "X"},
    )
    assert response.status_code == 403


async def test_upload_super_admin_gets_403(client, super_admin_token):
    response = await client.post(
        "/documents/upload",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        files={"file": ("x.pdf", b"data", "application/pdf")},
        data={"consent_given": "true", "consent_method": "written", "patient_name": "X"},
    )
    assert response.status_code == 403


async def test_upload_unauthenticated_401(client):
    response = await client.post(
        "/documents/upload",
        files={"file": ("x.pdf", b"data", "application/pdf")},
        data={"consent_given": "true", "consent_method": "written", "patient_name": "X"},
    )
    assert response.status_code in (401, 403)


# ── /admin/* — admin + super_admin only ──────────────────────────────────────


async def test_admin_health_doctor_gets_403(client, doctor_token):
    response = await client.get(
        "/admin/health",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 403


async def test_admin_health_admin_allowed(client, admin_token):
    response = await client.get(
        "/admin/health",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # May succeed (200) or fail if services are unhealthy in test env —
    # what matters is that it is NOT a 403.
    assert response.status_code != 403


async def test_admin_health_unauthenticated_401(client):
    response = await client.get("/admin/health")
    assert response.status_code in (401, 403)


# ── /superadmin/* — super_admin only ─────────────────────────────────────────


async def test_superadmin_users_doctor_gets_403(client, doctor_token):
    response = await client.get(
        "/superadmin/users",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 403


async def test_superadmin_users_admin_gets_403(client, admin_token):
    response = await client.get(
        "/superadmin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 403


async def test_superadmin_users_super_admin_allowed(client, super_admin_token):
    response = await client.get(
        "/superadmin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
    )
    assert response.status_code == 200


async def test_superadmin_unauthenticated_401(client):
    response = await client.get("/superadmin/users")
    assert response.status_code in (401, 403)


# ── /schemes — GET is open to all authenticated; POST requires super_admin ───


async def test_schemes_list_doctor_allowed(client, doctor_token):
    response = await client.get(
        "/schemes",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 200


async def test_schemes_create_doctor_gets_403(client, doctor_token):
    response = await client.post(
        "/schemes/custom",
        headers={"Authorization": f"Bearer {doctor_token}"},
        json={
            "name": "test_scheme",
            "label": "Test",
            "color": "#000000",
            "required_fields": [],
            "optional_fields": [],
            "rules": [],
            "pdf_sections": [],
        },
    )
    assert response.status_code == 403


async def test_schemes_create_admin_gets_403(client, admin_token):
    response = await client.post(
        "/schemes/custom",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": "test_scheme",
            "label": "Test",
            "color": "#000000",
            "required_fields": [],
            "optional_fields": [],
            "rules": [],
            "pdf_sections": [],
        },
    )
    assert response.status_code == 403
