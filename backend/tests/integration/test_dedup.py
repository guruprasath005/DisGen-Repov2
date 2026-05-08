"""
Integration tests for SHA-256 deduplication on document upload.

Two uploads of the same file content (same hash) within the same hospital
must return the existing document_id rather than creating a second row.
"""

import hashlib
import io
from unittest.mock import MagicMock, patch

import pytest


_FAKE_PDF = b"%PDF-1.4 fake pdf content for test"


async def test_duplicate_upload_returns_existing_document(
    client, doctor_token, doctor_user, db_session
):
    from models.document import Document
    from config import settings

    # Insert a document row whose SHA-256 matches our fake file.
    sha = hashlib.sha256(_FAKE_PDF).hexdigest()
    doc = Document(
        hospital_id=settings.hospital_id,
        uploaded_by=doctor_user.id,
        filename="original.pdf",
        minio_key=f"documents/{sha}.pdf",
        sha256_hash=sha,
        status="ready",
    )
    db_session.add(doc)
    await db_session.commit()
    existing_id = str(doc.id)

    # Upload the same content.
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

    assert response.status_code == 200
    data = response.json()
    assert str(data["document_id"]) == existing_id


async def test_different_content_creates_new_document(
    client, doctor_token, doctor_user, db_session
):
    from models.document import Document
    from config import settings
    from sqlalchemy import func, select

    content1 = b"%PDF-1.4 first document content"
    sha1 = hashlib.sha256(content1).hexdigest()
    doc = Document(
        hospital_id=settings.hospital_id,
        uploaded_by=doctor_user.id,
        filename="first.pdf",
        minio_key=f"documents/{sha1}.pdf",
        sha256_hash=sha1,
        status="ready",
    )
    db_session.add(doc)
    await db_session.commit()

    content2 = b"%PDF-1.4 second document with different content xyz"

    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("second.pdf", io.BytesIO(content2), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Jane Doe",
            },
        )

    assert response.status_code in (200, 201)
    result = await db_session.execute(
        select(func.count()).select_from(Document).where(
            Document.hospital_id == settings.hospital_id
        )
    )
    count = result.scalar_one()
    assert count == 2


async def test_same_hash_different_hospital_creates_new(
    client, doctor_token, doctor_user, db_session
):
    """SHA-256 dedup is scoped to the hospital_id."""
    from models.document import Document
    from config import settings

    sha = hashlib.sha256(_FAKE_PDF).hexdigest()
    doc = Document(
        hospital_id="different-hospital-id",  # different hospital
        uploaded_by=doctor_user.id,
        filename="other.pdf",
        minio_key=f"documents/other_{sha}.pdf",
        sha256_hash=sha,
        status="ready",
    )
    db_session.add(doc)
    await db_session.commit()

    with patch("magic.from_buffer", return_value="application/pdf"):
        response = await client.post(
            "/documents/upload",
            headers={"Authorization": f"Bearer {doctor_token}"},
            files={"file": ("test.pdf", io.BytesIO(_FAKE_PDF), "application/pdf")},
            data={
                "consent_given": "true",
                "consent_method": "written",
                "patient_name": "Patient Three",
            },
        )

    # Should create a new document, not return the other-hospital one.
    assert response.status_code in (200, 201)
    data = response.json()
    assert str(data["document_id"]) != str(doc.id)
