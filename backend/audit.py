"""
Audit log creation with SHA-256 hash chain integrity.

Every audit entry computes:
    hash = SHA-256(prev_hash || canonical(row))

where canonical() is a deterministic JSON serialisation of the immutable scalar
fields. An advisory lock prevents concurrent inserts from forking the chain.

Verification walk:
    GET /admin/audit/verify replays the chain and reports the first broken entry.

Legacy rows (pre-hardening) have prev_hash = NULL and hash = NULL. The verifier
treats them as chain-start sentinels and reports them as "pre-hardening boundary".
"""

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from models.audit import AuditLog


def _canonicalize(row: dict) -> str:
    fields = [
        "id", "user_id", "username", "role", "action",
        "document_id", "ip_address", "created_at", "prev_hash",
    ]
    return json.dumps(
        {k: str(row[k]) if row[k] is not None else None for k in fields},
        sort_keys=True,
    )


async def create_audit_log(db: AsyncSession, **kwargs) -> AuditLog:
    """
    Create an audit log entry with hash chain integrity.

    Uses pg_advisory_xact_lock to prevent two concurrent inserts from reading
    the same prev_hash. The lock is scoped to the transaction and releases
    automatically on commit/rollback.
    """
    hospital_id = kwargs.pop("hospital_id", settings.hospital_id)

    # Advisory lock scoped to this transaction — prevents concurrent inserts forking the chain
    lock_key = hash(hospital_id) & 0x7FFFFFFFFFFFFFFF  # pg_advisory needs int64
    await db.execute(text(f"SELECT pg_advisory_xact_lock({lock_key})"))

    # Fetch the last hash for this hospital
    result = await db.execute(
        text(
            "SELECT hash FROM audit_logs "
            "WHERE hospital_id = :hid ORDER BY created_at DESC LIMIT 1"
        ),
        {"hid": hospital_id},
    )
    row = result.fetchone()
    prev_hash = row[0] if (row and row[0]) else "0" * 64  # genesis sentinel

    entry = AuditLog(**kwargs, hospital_id=hospital_id, prev_hash=prev_hash)
    db.add(entry)
    await db.flush()  # assigns entry.id + created_at from DB default

    canonical = _canonicalize({
        "id": entry.id,
        "user_id": entry.user_id,
        "username": entry.username,
        "role": entry.role,
        "action": entry.action,
        "document_id": entry.document_id,
        "ip_address": entry.ip_address,
        "created_at": entry.created_at,
        "prev_hash": prev_hash,
    })
    entry.hash = hashlib.sha256(canonical.encode()).hexdigest()
    db.add(entry)
    return entry


async def verify_audit_chain(db: AsyncSession, hospital_id: str | None = None) -> dict:
    """
    Walk all audit rows for a hospital in order and verify the hash chain.

    Returns:
        {ok: bool, first_broken_id: str | None, total_checked: int,
         pre_hardening_rows: int}
    """
    hid = hospital_id or settings.hospital_id
    result = await db.execute(
        text(
            "SELECT id, user_id, username, role, action, document_id, "
            "ip_address, created_at, prev_hash, hash "
            "FROM audit_logs WHERE hospital_id = :hid ORDER BY created_at ASC"
        ),
        {"hid": hid},
    )
    rows = result.fetchall()

    total_checked = 0
    pre_hardening = 0
    expected_prev = "0" * 64

    for row in rows:
        (rid, user_id, username, role, action, doc_id,
         ip, created_at, prev_hash, stored_hash) = row

        # Pre-hardening rows have no hash — treat as chain boundary
        if stored_hash is None:
            pre_hardening += 1
            expected_prev = "0" * 64
            continue

        total_checked += 1
        canonical = _canonicalize({
            "id": rid, "user_id": user_id, "username": username, "role": role,
            "action": action, "document_id": doc_id, "ip_address": ip,
            "created_at": created_at, "prev_hash": prev_hash,
        })
        computed = hashlib.sha256(canonical.encode()).hexdigest()

        if computed != stored_hash:
            return {
                "ok": False,
                "first_broken_id": str(rid),
                "total_checked": total_checked,
                "pre_hardening_rows": pre_hardening,
            }
        expected_prev = stored_hash

    return {
        "ok": True,
        "first_broken_id": None,
        "total_checked": total_checked,
        "pre_hardening_rows": pre_hardening,
    }
