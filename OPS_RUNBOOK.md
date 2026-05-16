# DisGen — Operations Runbook

Practical operations for the Delhi hospital deployment. Pairs with
`scripts/install.sh`. All commands run from the project root on the VPS.

---

## 1. Deploy / upgrade

| Action | Command |
|--------|---------|
| First-time install (interactive) | `bash scripts/install.sh` |
| Redeploy after a code change | `bash scripts/backup.sh && bash scripts/install.sh --upgrade` |
| Validate `.env` (placeholders + DPDP) | `bash scripts/install.sh --validate` |

`--upgrade` is idempotent: it rebuilds the frontend + backend image, runs DB
migrations, restarts the stack, and re-checks health **using the existing
`.env`** — no secrets are re-prompted or regenerated. Always back up first.

## 2. Health & status

```bash
curl -sk https://localhost/api/health        # -> {"status":"ok", ...}
docker compose ps                             # container states
docker compose logs -f backend                # API logs (PHI-scrubbed)
docker compose logs -f celery_worker          # OCR / extract / generate jobs
```

`/api/health` also reports `llm_provider`, `llm_data_residency`,
`dpdp_compliant`. **`dpdp_compliant: false` is expected during the review
phase** (OpenAI/US) and must become `true` before hospital go-live.

## 3. DPDP data residency (must resolve before go-live)

The LLM runs on OpenAI (US) — patient PHI leaves India. This is a deliberate,
hospital-approved interim state for review only.

- Backend logs a loud `DPDP WARNING` at startup; `/api/health` exposes the state.
- The seam is built: implement an in-India provider in
  `backend/llm/provider.py`, register it, set `LLM_PROVIDER=<name>` in `.env`,
  then `bash scripts/install.sh --upgrade`. No other code changes.

## 4. Backup & restore

| Action | Command |
|--------|---------|
| Manual DB backup | `bash scripts/backup.sh` → `backups/<timestamp>/disgen.dump` |
| Restore DB (destructive) | `bash scripts/restore.sh backups/<timestamp>` |

- Automated daily Postgres backups run via the `postgres_backup` container.
- `restore.sh` takes a safety backup, then `pg_restore --clean`, then restarts
  backend/workers.
- **MinIO** (uploaded source files) lives on the `minio_data` Docker volume.
  Snapshot it with your VPS volume/offsite backup. Clinical summaries and
  structured data are in Postgres and covered by the DB backup.
- **Secrets**: `.env`, `backend/auth/keys/*.pem`, `nginx/certs/*` are NOT in
  git. Back them up securely and separately — losing
  `FIELD_ENCRYPTION_KEY` makes all encrypted clinical data unrecoverable.

## 5. Document pipeline recovery

Lifecycle (canonical source: `backend/document_states.py`, served at
`GET /api/documents/state-machine`):

```
processing → ocr_complete → extracting → ready → confirmed
           → generating → generated → approved
failures:  ocr_failed (OCR)   |   failed (generation)
```

A stuck-document janitor auto-fails in-flight docs after 10–15 min. Manual
recovery (doctor, in-app or via API):

| Symptom | Status | Recovery |
|---------|--------|----------|
| OCR failed | `ocr_failed` | `POST /api/documents/{id}/reprocess` (re-OCR, no re-upload) |
| Bad/empty extraction | `ready` | `POST /api/documents/{id}/reextract` (re-run LLM extraction; data must be re-confirmed) |
| Generation failed | `failed` | Re-trigger generation (`failed` is now generatable) |

Extraction quality on long (10–20 page) K-shapes is chunked + truncation-split
so no lab/medication row is dropped. `structured.extraction_meta` flags
`pages_empty`, `truncated_chunks`, `low_ocr_confidence`,
`needs_doctor_review` — surface these to the reviewing doctor.

## 6. Common incidents

| Symptom | Check | Fix |
|---------|-------|-----|
| API 5xx / won't start | `docker compose logs backend` | Often a placeholder secret — `--validate`, fix `.env`, `--upgrade` |
| Docs stuck "processing" | `docker compose logs celery_worker` | Worker down → `docker compose restart celery_worker`; janitor recovers stuck rows |
| OCR all failing | backend logs for Azure errors | Check `AZURE_DOCUMENT_*` + Azure quota/region |
| Extraction failing | backend logs for LLM errors | Check `OPENAI_API_KEY`, model `gpt-4o`, rate limits |
| Web UI not refreshing | browser devtools network | `GET /api/documents/state-machine` reachable? polling derives from it |
| Mobile dev crash on launch | Expo logs | Notifications are lazy/gated now — `git pull` if on an old build |

## 7. Routine

- **Daily:** confirm automated backup produced a fresh `disgen.dump`; skim
  GlitchTip for new errors.
- **Weekly:** `docker compose ps` (all healthy); disk space (`df -h`); test
  `scripts/restore.sh` into a scratch environment quarterly.
- **Before any upgrade:** `bash scripts/backup.sh`.
- **Secret rotation:** rotate API keys in `.env` → `--upgrade`. Rotating
  `FIELD_ENCRYPTION_KEY` requires a data re-encryption migration — do not
  rotate it casually.
