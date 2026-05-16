"""
Canonical document state machine — the single source of truth.

Before this module the lifecycle was hard-coded, and disagreed, in at least
three places: ``routers/documents.py`` guard sets, the web polling hook, and the
mobile DocumentDetail screen. That divergence is exactly why the web UI silently
stopped refreshing during OCR/extraction. Every layer must now derive its
behaviour from the constants and predicates here, and the wire contract is
exposed verbatim at ``GET /documents/state-machine`` so the web and mobile
clients consume one definition instead of re-deriving their own.

Pure module — no DB, no I/O, no imports from the rest of the app. Safe to import
from routers, Celery tasks, and tests alike.
"""

from __future__ import annotations

from types import MappingProxyType


class DocumentState:
    """String constants — must match the ``document_status`` Postgres enum."""

    PROCESSING = "processing"        # uploaded; OCR running
    OCR_COMPLETE = "ocr_complete"    # OCR done; extraction about to start
    EXTRACTING = "extracting"        # LLM extraction running
    READY = "ready"                  # structured data available, editable
    CONFIRMED = "confirmed"          # data locked by the doctor
    GENERATING = "generating"        # summary generation running
    GENERATED = "generated"          # draft summary produced
    APPROVED = "approved"            # doctor-approved (terminal success)
    FAILED = "failed"                # generation permanently failed
    OCR_FAILED = "ocr_failed"        # OCR permanently failed

    # Deprecated: never set by any code path. The value is retained in the
    # Postgres enum only because dropping an enum value requires a destructive
    # type rebuild — not worth the migration risk for a dead value. Treated as
    # a generation failure everywhere so no guard has to special-case it.
    VALIDATION_FAILED = "validation_failed"


# ── State sets ────────────────────────────────────────────────────────────────

#: Every value present in the Postgres enum (including the deprecated one).
ALL: frozenset[str] = frozenset({
    DocumentState.PROCESSING,
    DocumentState.OCR_COMPLETE,
    DocumentState.EXTRACTING,
    DocumentState.READY,
    DocumentState.CONFIRMED,
    DocumentState.GENERATING,
    DocumentState.GENERATED,
    DocumentState.APPROVED,
    DocumentState.FAILED,
    DocumentState.OCR_FAILED,
    DocumentState.VALIDATION_FAILED,
})

#: Work is happening server-side — clients MUST poll while in these states.
IN_FLIGHT: frozenset[str] = frozenset({
    DocumentState.PROCESSING,
    DocumentState.OCR_COMPLETE,
    DocumentState.EXTRACTING,
    DocumentState.GENERATING,
})

#: Permanent failure — recoverable only via the manual recovery endpoints.
FAILURE: frozenset[str] = frozenset({
    DocumentState.FAILED,
    DocumentState.OCR_FAILED,
    DocumentState.VALIDATION_FAILED,
})

#: Stable states a client can rest on without polling.
STABLE: frozenset[str] = frozenset({
    DocumentState.READY,
    DocumentState.CONFIRMED,
    DocumentState.GENERATED,
    DocumentState.APPROVED,
})

#: Doctor may PATCH structured clinical data only in these states.
EDITABLE_STRUCTURED: frozenset[str] = frozenset({
    DocumentState.READY,
    DocumentState.CONFIRMED,
})

#: Summary generation may be triggered from these source states
#: (CONFIRMED = first run; GENERATED = regenerate after edits).
GENERATABLE: frozenset[str] = frozenset({
    DocumentState.CONFIRMED,
    DocumentState.GENERATED,
})

#: OCR may be re-run (full pipeline restart) only from these states.
REPROCESSABLE: frozenset[str] = frozenset({
    DocumentState.OCR_FAILED,
    DocumentState.FAILED,
})

#: LLM extraction may be re-run (without re-uploading the file) from these.
REEXTRACTABLE: frozenset[str] = frozenset({
    DocumentState.READY,
    DocumentState.OCR_COMPLETE,
    DocumentState.FAILED,
})


# ── Allowed transitions (authoritative graph; used for validation/docs) ───────

ALLOWED_TRANSITIONS: MappingProxyType = MappingProxyType({
    DocumentState.PROCESSING:    frozenset({DocumentState.OCR_COMPLETE, DocumentState.OCR_FAILED}),
    DocumentState.OCR_COMPLETE:  frozenset({DocumentState.EXTRACTING, DocumentState.PROCESSING}),
    DocumentState.EXTRACTING:    frozenset({DocumentState.READY, DocumentState.FAILED}),
    DocumentState.READY:         frozenset({DocumentState.CONFIRMED, DocumentState.EXTRACTING}),
    DocumentState.CONFIRMED:     frozenset({DocumentState.GENERATING, DocumentState.READY}),
    DocumentState.GENERATING:    frozenset({DocumentState.GENERATED, DocumentState.FAILED}),
    DocumentState.GENERATED:     frozenset({DocumentState.GENERATING, DocumentState.APPROVED}),
    DocumentState.APPROVED:      frozenset({DocumentState.GENERATING}),  # regenerate replaces the draft
    DocumentState.OCR_FAILED:    frozenset({DocumentState.PROCESSING}),  # via reprocess
    DocumentState.FAILED:        frozenset({DocumentState.PROCESSING, DocumentState.EXTRACTING, DocumentState.GENERATING}),
    DocumentState.VALIDATION_FAILED: frozenset({DocumentState.GENERATING}),  # deprecated; treated as FAILED
})


# ── Predicates ────────────────────────────────────────────────────────────────

def is_in_flight(status: str | None) -> bool:
    """Server-side work in progress — the client should keep polling."""
    return status in IN_FLIGHT


def is_failure(status: str | None) -> bool:
    """Permanent failure — needs manual recovery."""
    return status in FAILURE


def is_stable(status: str | None) -> bool:
    """Resting state — no polling required."""
    return status in STABLE


def can_edit_structured(status: str | None) -> bool:
    return status in EDITABLE_STRUCTURED


def can_generate(status: str | None) -> bool:
    return status in GENERATABLE


def can_reprocess(status: str | None) -> bool:
    return status in REPROCESSABLE


def can_reextract(status: str | None) -> bool:
    return status in REEXTRACTABLE


def is_transition_allowed(src: str | None, dst: str | None) -> bool:
    """True if ``src -> dst`` is a sanctioned edge in the lifecycle graph."""
    if src == dst:
        return True
    return dst in ALLOWED_TRANSITIONS.get(src, frozenset())


# ── Wire contract (served to web + mobile so they never re-derive this) ───────

def state_machine_contract() -> dict:
    """
    JSON-serialisable snapshot of the lifecycle. Exposed at
    ``GET /documents/state-machine`` and consumed by the web polling hook and
    the mobile status UI. Sorted lists keep the payload diff-stable.
    """
    return {
        "states": sorted(ALL),
        "in_flight": sorted(IN_FLIGHT),
        "failure": sorted(FAILURE),
        "stable": sorted(STABLE),
        "editable_structured": sorted(EDITABLE_STRUCTURED),
        "generatable": sorted(GENERATABLE),
        "reprocessable": sorted(REPROCESSABLE),
        "reextractable": sorted(REEXTRACTABLE),
        "deprecated": [DocumentState.VALIDATION_FAILED],
        "poll_interval_ms": 3000,
    }
