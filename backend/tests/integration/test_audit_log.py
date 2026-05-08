"""
Integration tests for audit log correctness.

Verifies that key actions produce correctly structured AuditLog rows:
LOGIN, LOGOUT, UPLOAD, USER_CREATE.
"""

import io
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select

from models.audit import AuditLog


async def test_login_creates_audit_log(client, doctor_user, db_session):
    await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.username == "doctor_test",
            AuditLog.action == "LOGIN",
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.role == "doctor"
    assert log.ip_address is not None


async def test_failed_login_creates_audit_log(client, doctor_user, db_session):
    await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "WrongPass!"},
    )

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.username == "doctor_test",
            AuditLog.action == "LOGIN_FAILED",
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None


async def test_logout_creates_audit_log(client, doctor_user, db_session):
    login_resp = await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )
    token = login_resp.json()["access_token"]

    await client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.username == "doctor_test",
            AuditLog.action == "LOGOUT",
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None


async def test_upload_creates_upload_audit_log(
    client, doctor_token, doctor_user, db_session
):
    _FAKE_PDF = b"%PDF-1.4 audit log test content"

    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("audit.pdf", io.BytesIO(_FAKE_PDF), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Audit Patient",
            },
        )

    assert response.status_code in (200, 201)
    doc_id = uuid.UUID(response.json()["document_id"])

    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.document_id == doc_id,
            AuditLog.action == "UPLOAD",
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.user_id == doctor_user.id


async def test_user_create_audit_log(
    client, super_admin_token, super_admin_user, db_session
):
    response = await client.post(
        "/superadmin/users",
        headers={"Authorization": f"Bearer {super_admin_token}"},
        json={
            "username": "new_doctor_audit",
            "full_name": "New Doctor Audit",
            "email": "new_doctor_audit@example.com",
            "password": "NewPass!123",
            "role": "doctor",
        },
    )
    assert response.status_code == 201

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "USER_CREATE")
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.username == "superadmin_test"


async def test_audit_log_ip_address_recorded(client, doctor_user, db_session):
    await client.post(
        "/auth/login",
        json={"username": "doctor_test", "password": "TestPass!123"},
    )

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.action == "LOGIN")
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.ip_address != ""
    assert len(log.ip_address) <= 45
