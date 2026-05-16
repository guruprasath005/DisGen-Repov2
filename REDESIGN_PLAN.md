# DisGen — Production Hardening & Redesign Plan

**Target:** Delhi hospital pilot. Real PHI, 10–20 page scanned K-shape / Ayushman discharge docs.
**Mandate:** harden + redesign in place. No rewrite-from-scratch. Git history preserved so every phase is revertible.

---

## 0. Honest baseline assessment

This is **not** a broken prototype. The codebase is already security- and ops-conscious:

- AES-256-GCM field encryption, PHI log scrubbing, PHI scrubbing on error events.
- JWT RS256 + refresh rotation, RBAC (doctor/admin/super_admin), CSRF / idempotency / rate-limit middleware.
- Celery queues (`ocr`, `generate`, `maintenance`) + beat, `acks_late`, retries, a janitor that unsticks documents every 10 min.
- DPDP retention/anonymisation jobs, full audit trail.
- A **27 KB one-click `scripts/install.sh` already exists** (generates secrets, JWT keys, TLS, runs migrations, seeds, creates super-admin). You said you didn't have one — you do; it just needs an upgrade/redeploy path.

So this plan is **targeted hardening + redesign of the genuinely weak areas**, not a teardown.

### Confirmed decisions
- **LLM:** keep OpenAI, move `gpt-4o-mini → gpt-4o`. Patient PHI still leaves India → **known DPDP risk**. Mitigation: isolate the LLM behind a provider seam + a loud startup warning so swapping to Azure OpenAI (Central India) later is a config change, not a rewrite. *(User accepted this risk.)*
- **Scope (priority order):** 1) Core pipeline reliability 2) LLM extraction quality 3) Mobile app 4) Web UI + deployment polish.
- **Working mode:** this plan → approval → autonomous execution.

---

## Concrete defects found (evidence-based)

| # | Severity | Defect | Evidence |
|---|----------|--------|----------|
| D1 | 🔴 High | Web polling never refreshes during OCR→extract. Hook polls only on `processing`/`generating`; real in-flight statuses are `processing,ocr_complete,extracting,ready,generating`. UI silently goes stale — your "background refresh broken". | `frontend/src/hooks/useDocumentPolling.ts:8-10` vs `backend/models/document.py` status set |
| D2 | 🔴 High | No single source of truth for the document state machine. Web hook, `documents.py` status docstring, and mobile `DocumentDetailScreen` each hard-code different status lists that disagree. | `documents.py:609`, `DocumentDetailScreen.tsx:46-77`, polling hook |
| D3 | 🔴 High | Long-doc extraction truncation. `_call_llm` is single-shot, `max_tokens=16383`; system prompt demands *every* lab parameter separately. A 20-page K-shape can exceed the output cap → `json_repair` silently drops clinical data. gpt-4o has the same 16,384 output cap, so the model bump alone does not fix this. | `backend/llm/extractor.py:329-345`, `_SYSTEM_PROMPT` |
| D4 | 🟠 Med | Mobile notification fragility (your last 5 commits). `App.tsx` *statically* imports `expo-notifications` and eagerly calls `setNotificationChannelAsync` on every launch, defeating the lazy/gated `usePushNotifications` and forcing an ever-growing Metro dev stub. | `mobile/App.tsx:2,17-24` vs `usePushNotifications.ts:31-33`, `metro.config.js` |
| D5 | 🟠 Med | No manual recovery. `ocr_failed` has no re-OCR endpoint (only the 10-min janitor); extraction failure → empty+`ready` with no "retry extraction" affordance. | `documents.py` (no reprocess route), `extract_tasks.py:_store_empty_and_ready` |
| D6 | 🟠 Med | Edit-after-confirm correctness gap. PATCH is allowed in `confirmed` status but does not reset `data_confirmed`; generation then runs on edited-but-still-"confirmed" data without re-lock. | `documents.py:649-719` (`_EDITABLE_STATUSES` includes `confirmed`) |
| D7 | 🟠 Med | Dead `validation_failed` status: referenced in generate/approve guards but never set anywhere → confusing, untestable branch. | `documents.py:883`, `generate_tasks.py` (always `draft`/`generated`) |
| D8 | 🟡 Low | Stale comments mislead operators: "AWS Bedrock Claude 3.5 Sonnet v2", "calls the Bedrock SDK directly", while code is OpenAI. | `extract_tasks.py:1-24`, `llm/extractor.py:449`, `config.py`, `.env.example` |
| D9 | 🟡 Low | Upload queue (mobile) drops items silently after 3 retries, no user feedback, no completion signal, fixed backoff. | `mobile/src/hooks/useUploadQueue.tsx:66-72` |
| D10 | 🟡 Low | `install.sh` has no idempotent upgrade/redeploy, no preflight `.env` validation, no uninstall/reset, no documented backup/restore runbook. | `scripts/install.sh` |

---

## Phase plan

Each phase is independently shippable, committed separately, with stated acceptance criteria. I will run the existing `backend/tests` suite after backend phases.

### Phase 1 — Canonical state machine + reliable refresh  *(fixes D1, D2, D6, D7)*
- **New:** `backend/document_states.py` — single source of truth: status enum, allowed transitions, `IN_FLIGHT` set, terminal/failure sets. All routers/tasks import from it (no more hard-coded literals).
- `documents.py`: derive guard sets from the new module; reset `report.data_confirmed=False` + audit when structured data is PATCHed after confirm (D6); remove or properly implement `validation_failed` (decision: **remove** — generation already always lands on `draft`/`generated`/`failed`; collapse the dead branch) (D7).
- Add `GET /documents/state-machine` (static contract) so web + mobile consume one definition.
- `frontend/src/hooks/useDocumentPolling.ts`: poll while status ∈ `IN_FLIGHT` (covers `processing,ocr_complete,extracting,generating`); stop on terminal/failure; keep 3 s interval; surface failure states to the caller.
- Acceptance: upload a doc → web view auto-advances through OCR→extract→ready→generated with no manual refresh; editing after confirm forces re-confirm; `validation_failed` no longer referenced.

### Phase 2 — Manual recovery + pipeline robustness  *(fixes D5)*
- `POST /documents/{id}/reprocess` (re-run OCR pipeline; doctor-owned, rate-limited, audited; only from `ocr_failed`/`failed`).
- `POST /documents/{id}/reextract` (re-run extraction; only from `ready`/`failed`; audited).
- Idempotency guards in both Celery tasks already exist — verified; extend to accept the new manual re-entry states.
- Acceptance: a forced OCR failure can be retried from the UI and completes; reextract regenerates structured data without re-upload.

### Phase 3 — LLM provider seam + model bump + DPDP guardrail  *(fixes D8, partial D3)*
- **New:** `backend/llm/provider.py` — thin interface (`complete_json`, `complete_with_tool`); `OpenAIProvider` implementation moved out of `client.py`. `client.py` becomes a stable façade.
- `config.py`/`.env.example`: `OPENAI_MODEL_ID=gpt-4o`; add `LLM_PROVIDER=openai` (future: `azure_openai`).
- Startup (`main.py` lifespan): if provider sends PHI outside India, log a prominent `DPDP WARNING` and expose it in `/health` (`{"dpdp_data_residency": "non_compliant_openai_us"}`) so operators can't miss it.
- Purge all stale Bedrock comments/docstrings (extract_tasks, extractor, config, .env.example).
- Acceptance: model is gpt-4o end-to-end; one config flag is the only thing standing between US-OpenAI and a future India provider; warning visible at boot and in `/health`.

### Phase 4 — Long-document extraction redesign  *(fixes D3 — the K-shape core)*
- `backend/llm/extractor.py` reworked for 10–20 page docs:
  - **Page/section-aware chunking** under a configurable token budget (OCR already yields per-page `sections` + `tables` + `key_values`).
  - Per-chunk structured extraction against the existing schema; **deterministic merge**: list fields = union with dedupe; scalars = first non-null with page provenance; investigations/medications keyed to avoid dup/loss.
  - **Truncation detection**: inspect `finish_reason`; on `length`, split the chunk and retry instead of silently repairing.
  - **Coverage check**: record which OCR pages contributed; flag pages with zero extracted content + low OCR confidence into `extraction_source`/audit so doctors see what to review.
- Keep the spaCy/regex fallback and merge semantics.
- Acceptance: the `sample_cardiology_case.md`-class document and a synthetic ~18-page doc extract with **no dropped lab rows / medications** (verified by count vs OCR tables); coverage metadata present in `GET /documents/{id}/structured`.

### Phase 5 — Mobile reliability & notification fix  *(fixes D4, D9)*
- `mobile/App.tsx`: remove the static `expo-notifications` import and eager channel setup. Channel creation moves into the lazy, `PUSH_SUPPORTED`-gated path in `usePushNotifications.ts`.
- Delete `mobile/src/stubs/expo-notifications-stub.js` and simplify `metro.config.js` (dev never resolves the native module → the recurring breakage class is gone).
- `useUploadQueue.tsx`: exponential backoff, dedupe by file hash, surface terminal failures + pending/working/failed counts to the UI, optional local notification on completion (gated, reuses the lazy import).
- Mobile consumes the Phase 1 state-machine contract (status pills + processing affordances aligned with web).
- Acceptance: clean Expo Go dev start with zero notification module errors; failed uploads are visible and retryable, not silently dropped; mobile + web show identical status semantics.

### Phase 6 — Web UI + deployment polish  *(fixes D10 + UI)*
- Web: consistent status pills/empty/loading/error states tied to the canonical machine; clearer structured-edit → confirm → generate → approve flow; ICD-10 candidate selection UX; visible DRAFT state. Targeted redesign of `DashboardPage`, `DocumentViewPage`, `DocumentEditPage` (no framework change — stays React/Vite/Tailwind/Radix).
- Deployment:
  - `scripts/install.sh`: add idempotent `--upgrade` (pull/build/migrate/restart without re-prompting secrets), `.env` preflight validation, `--uninstall`/`--reset`.
  - **New:** `scripts/backup-restore.sh` + `OPS_RUNBOOK.md` (backup/restore, rollback, health, log locations, secret rotation, the DPDP note).
- Acceptance: a fresh VPS comes up via `install.sh`; a code change deploys via `install.sh --upgrade` with zero data loss; runbook covers backup/restore/rollback.

---

## Out of scope (flagged, not done unless you ask)
- Migrating LLM to an India region (Azure OpenAI / Bedrock) — seam is built (Phase 3) but the switch is a separate decision.
- Self-hosted model.
- ICD-10 mapping accuracy overhaul beyond current pg_trgm (note: LLM-proposed + table-verified codes is a strong future improvement).
- Auth/RBAC redesign — current design is sound.

## Risk & rollback
- Each phase = its own commit on a `redesign/*` branch. Backend phases gated by `backend/tests`. No destructive data migrations; state-machine change is additive. Mobile stub deletion is reversible via git.
```
