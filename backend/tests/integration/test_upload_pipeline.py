"""
Integration tests for the document upload pipeline.

Verifies the full upload path:
  - MIME validation
  - Consent validation enforced at the boundary
  - Document row created in disgen_test
  - ConsentRecord row created
  - Audit log entry written
  - Celery OCR task dispatched (patched in conftest)
"""

import io
from unittest.mock import patch

import pytest


_FAKE_PDF = b"%PDF-1.4 integration test document content unique_abc123"
_FAKE_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # JPEG magic bytes


async def test_upload_pdf_creates_document(client, doctor_token, doctor_user):
    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("test.pdf", io.BytesIO(_FAKE_PDF), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "John Doe",
            },
        )

    assert response.status_code in (200, 201)
    data = response.json()
    assert "document_id" in data
    assert data["status"] == "processing"


async def test_upload_creates_consent_record(client, doctor_token, doctor_user, db_session):
    from sqlalchemy import select
    from models.compliance import ConsentRecord

    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("test.pdf", io.BytesIO(_FAKE_PDF + b"_consent"), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "verbal",
                "patient_name": "Jane Doe",
            },
        )

    assert response.status_code in (200, 201)
    doc_id = response.json()["document_id"]

    import uuid
    result = await db_session.execute(
        select(ConsentRecord).where(ConsentRecord.document_id == uuid.UUID(doc_id))
    )
    consent = result.scalar_one_or_none()
    assert consent is not None
    assert consent.consent_given is True
    assert consent.consent_method == "verbal"
    from crypto import safe_decrypt
    assert safe_decrypt(consent.patient_name) == "Jane Doe"


async def test_upload_writes_audit_log(client, doctor_token, doctor_user, db_session):
    from sqlalchemy import select
    from models.audit import AuditLog

    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("audit_test.pdf", io.BytesIO(_FAKE_PDF + b"_audit"), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "digital",
                "patient_name": "Audit Patient",
            },
        )

    assert response.status_code in (200, 201)
    doc_id = response.json()["document_id"]

    import uuid
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.document_id == uuid.UUID(doc_id),
            AuditLog.action == "UPLOAD",
        )
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.username == "doctor_test"


async def test_upload_dispatches_celery_task(client, doctor_token, _patch_celery):
    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("celery_test.pdf", io.BytesIO(_FAKE_PDF + b"_celery"), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Celery Patient",
            },
        )

    assert response.status_code in (200, 201)
    _patch_celery.assert_called_once()


async def test_upload_rejected_without_consent(client, doctor_token):
    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("no_consent.pdf", io.BytesIO(_FAKE_PDF + b"_nc"), "application/pdf")},
            data={
                "consent_given": "false",
                "consent_method": "written",
                "patient_name": "No Consent Patient",
            },
        )

    assert response.status_code == 422


async def test_upload_rejected_invalid_consent_method(client, doctor_token):
    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("bad_method.pdf", io.BytesIO(_FAKE_PDF + b"_bm"), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "oral",
                "patient_name": "Patient",
            },
        )

    assert response.status_code == 422


async def test_upload_rejected_invalid_mime(client, doctor_token):
    with patch("magic.from_buffer", return_value="text/plain"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("malware.txt", io.BytesIO(b"not a pdf"), "text/plain")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Patient",
            },
        )

    assert response.status_code == 422


async def test_upload_requires_doctor_role(client, admin_token):
    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {admin_token}"},
            files={"file": ("test.pdf", io.BytesIO(_FAKE_PDF + b"_admin"), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Test Patient",
            },
        )

    assert response.status_code == 403


async def test_upload_without_auth_401(client):
    response = await client.post(
        "/documents/upload",
        files={"file": ("test.pdf", io.BytesIO(_FAKE_PDF), "application/pdf")},
        data={
            "consent_given": "true",
            "consent_method": "written",
            "patient_name": "Test",
        },
    )
    assert response.status_code in (401, 403)
