"""
Integration tests for the confirm → generate → approve → PDF flow.

LLM generation is async via Celery — the Celery task delay is patched in
conftest._patch_celery so it never dispatches.  Tests verify:
  - HTTP layer behaviour (status codes, response shape)
  - DB state machine transitions (document status, confirm flag)
  - Approve endpoint against a manually seeded GeneratedSummary
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

import pytest
from sqlalchemy import select

from crypto import encrypt
from models.document import Document
from models.scheme import GeneratedSummary, Scheme
from models.structured_report import StructuredReport


_MOCK_STRUCTURED_DATA = {
    "patient_name": "Test Patient",
    "age": "45 years",
    "gender": "Male",
    "uhid": "U123456",
    "abha_id": None,
    "phone": "9876543210",
    "admission_date": "2024-01-10",
    "discharge_date": "2024-01-15",
    "primary_diagnosis": "Community Acquired Pneumonia",
    "secondary_diagnoses": [],
    "icd10_primary": {"code": "J18.0", "description": "Pneumonia", "source": "auto"},
    "icd10_secondary": [],
    "blood_pressure": "120/80 mmHg",
    "pulse_rate": "80 bpm",
    "temperature": "37.5°C",
    "oxygen_saturation": "98%",
    "medications_during_stay": [],
    "discharge_medications": [],
    "investigations": [],
    "procedures": [],
    "follow_up_instructions": "Review in 2 weeks.",
    "extraction_source": "llm",
}


def _make_sections() -> str:
    from llm.generator import SECTIONS
    lines = [f"## {s}\n\nContent for {s}." for s in SECTIONS]
    body = "\n\n".join(lines)
    return body + "\n\n" + "Clinical details. " * 50 + " J18.0"


async def _seed_confirmed_document(db_session, doctor_user, scheme_id: str = "pmjay"):
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="test.pdf",
        minio_key="documents/test.pdf",
        sha256_hash="a" * 64,
        status="confirmed",
    )
    db_session.add(doc)
    await db_session.flush()

    report = StructuredReport(
        document_id=doc.id,
        data=encrypt(json.dumps(_MOCK_STRUCTURED_DATA)),
        data_confirmed=True,
        confirmed_by=doctor_user.id,
        confirmed_at=datetime.now(timezone.utc),
        excluded_fields=[],
        version=1,
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(report)
    await db_session.commit()
    return doc


# ── Confirm ───────────────────────────────────────────────────────────────────


async def test_confirm_structured_data_locks_report(
    client, doctor_token, doctor_user, db_session
):
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="confirm_test.pdf",
        minio_key="documents/confirm_test.pdf",
        sha256_hash="b" * 64,
        status="ready",
    )
    db_session.add(doc)
    await db_session.flush()

    report = StructuredReport(
        document_id=doc.id,
        data=encrypt(json.dumps(_MOCK_STRUCTURED_DATA)),
        data_confirmed=False,
        excluded_fields=[],
        version=1,
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(report)
    await db_session.commit()

    response = await client.post(
        f"/documents/{doc.id}/structured/confirm",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 200

    await db_session.refresh(report)
    assert report.data_confirmed is True


async def test_confirm_rejects_malformed_abha_id(
    client, doctor_token, doctor_user, db_session
):
    bad_data = {**_MOCK_STRUCTURED_DATA, "abha_id": "not-a-valid-abha"}
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="abha_test.pdf",
        minio_key="documents/abha_test.pdf",
        sha256_hash="c" * 64,
        status="ready",
    )
    db_session.add(doc)
    await db_session.flush()

    report = StructuredReport(
        document_id=doc.id,
        data=encrypt(json.dumps(bad_data)),
        data_confirmed=False,
        excluded_fields=[],
        version=1,
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(report)
    await db_session.commit()

    response = await client.post(
        f"/documents/{doc.id}/structured/confirm",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert response.status_code == 422


# ── Generate ──────────────────────────────────────────────────────────────────


async def test_generate_queues_task_and_sets_generating_status(
    client, doctor_token, doctor_user, db_session, pmjay_scheme
):
    """POST /generate returns 202 and transitions the document to 'generating'."""
    doc = await _seed_confirmed_document(db_session, doctor_user)

    response = await client.post(
        f"/documents/{doc.id}/generate",
        headers={"Authorization": f"Bearer {doctor_token}"},
        json={"scheme_id": "pmjay"},
    )

    assert response.status_code == 202
    body = response.json()
    assert body["document_id"] == str(doc.id)
    assert body["status"] == "queued"

    # Document status must be "generating" immediately after the HTTP request
    await db_session.refresh(doc)
    assert doc.status == "generating"


async def test_generate_requires_confirmed_data(
    client, doctor_token, doctor_user, db_session, pmjay_scheme
):
    """POST /generate is blocked when data has not been confirmed."""
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="unconfirmed.pdf",
        minio_key="documents/unconfirmed.pdf",
        sha256_hash="d" * 64,
        status="ready",
    )
    db_session.add(doc)
    await db_session.flush()

    report = StructuredReport(
        document_id=doc.id,
        data=encrypt(json.dumps(_MOCK_STRUCTURED_DATA)),
        data_confirmed=False,
        excluded_fields=[],
        version=1,
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(report)
    await db_session.commit()

    response = await client.post(
        f"/documents/{doc.id}/generate",
        headers={"Authorization": f"Bearer {doctor_token}"},
        json={"scheme_id": "pmjay"},
    )
    assert response.status_code in (400, 409, 422)


# ── Approve ───────────────────────────────────────────────────────────────────


async def test_approve_summary(
    client, doctor_token, doctor_user, db_session, pmjay_scheme
):
    """Approving a draft summary flips its status and advances the document."""
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="approve_test.pdf",
        minio_key="documents/approve_test.pdf",
        sha256_hash="e" * 64,
        status="generated",
    )
    db_session.add(doc)
    await db_session.flush()

    summary = GeneratedSummary(
        document_id=doc.id,
        scheme="pmjay",
        summary_text=encrypt(_make_sections()),
        status="draft",
        generated_by=doctor_user.id,
        version=1,
        validation_notes={},
        is_active=True,
    )
    db_session.add(summary)
    await db_session.commit()

    approve_resp = await client.post(
        f"/documents/{doc.id}/summary/latest/approve",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert approve_resp.status_code == 200

    await db_session.refresh(summary)
    assert summary.status == "approved"
    assert summary.approved_by == doctor_user.id

    await db_session.refresh(doc)
    assert doc.status == "approved"


async def test_approve_already_approved_returns_409(
    client, doctor_token, doctor_user, db_session, pmjay_scheme
):
    doc = Document(
        hospital_id="hospital-001",
        uploaded_by=doctor_user.id,
        filename="already_approved.pdf",
        minio_key="documents/already_approved.pdf",
        sha256_hash="f" * 64,
        status="approved",
    )
    db_session.add(doc)
    await db_session.flush()

    summary = GeneratedSummary(
        document_id=doc.id,
        scheme="pmjay",
        summary_text=encrypt(_make_sections()),
        status="approved",
        generated_by=doctor_user.id,
        approved_by=doctor_user.id,
        approved_at=datetime.now(timezone.utc),
        version=1,
        validation_notes={},
        is_active=True,
    )
    db_session.add(summary)
    await db_session.commit()

    approve_resp = await client.post(
        f"/documents/{doc.id}/summary/latest/approve",
        headers={"Authorization": f"Bearer {doctor_token}"},
    )
    assert approve_resp.status_code == 409
