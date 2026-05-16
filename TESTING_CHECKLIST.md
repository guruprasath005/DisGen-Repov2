# DisGen — Pre-Hospital Testing Checklist

Pre-deployment test plan for the Delhi / pilot hospital review. The two
sections that matter most are **§5 Extraction Accuracy** and **§6 Summary
Generation Accuracy** — everything else is the safety net around them.

- Environment under test: `https://31.97.63.234:9443`
- Test inputs in `samples/`:
  - `sample_pancreatitis_icu_case_sheet.md` — **20-page case sheet** (use this
    one for the long-doc / scheme tests; PM-JAY metadata embedded)
  - `sample_cardiology_case.md` — compact STEMI case (smoke test only)
- API base: `https://31.97.63.234:9443/api`
- Reference for known answers: the source MD/PDF you upload (compare every
  extracted value against it).

Tick each box `[x]` as you verify. Anything failing → record under §13 and
do not promote to production until resolved.

---

## 1. Pre-test environment

- [x] All 13 `disgen-*` containers up: `docker compose ps` shows no `Exited`/`Restarting` except `disgen-glitchtip_migrate-1 Exited (0)` (expected one-shot). *Verified: 13 Up (6 healthy), uptime 3h, celery_beat stable.*
- [x] `curl -sk https://31.97.63.234:9443/api/health` returns: *(verified)*
  - [x] `"status":"ok"`
  - [x] `"llm_provider":"openai"`
  - [x] `"dpdp_compliant":false` *(expected for review; must become true for go-live)* — also surfaces `llm_data_residency: outside_india_us`
- [x] Backend startup logged the **DPDP WARNING** banner: `docker logs disgen-backend-1 2>&1 | grep -i 'DPDP WARNING'` non-empty. *Verified: 2× hits (initial boot + restart), both with the "NOT DPDP-compliant" follow-up.*
- [x] TLS cert SAN includes `IP:31.97.63.234`: `echo | openssl s_client -connect 31.97.63.234:9443 -servername 31.97.63.234 2>/dev/null | openssl x509 -noout -ext subjectAltName`. *Verified: `IP Address:31.97.63.234, IP Address:127.0.0.1`.*
- [x] CORS allows the web origin: `curl -sk -H "Origin: https://31.97.63.234:9443" -D - https://31.97.63.234:9443/api/health -o /dev/null | grep -i access-control-allow-origin` echoes the origin. *Verified.*
- [x] `/opt/disgen-v1-backup-*` directory still present (recovery path intact). *Both backup (065622) and archive (065826) present.*
- [x] All 17 non-DisGen containers (Sara, naadi, nephrolog, n8n, akshayaakka) still UP — no regression to other projects on the VPS. *Verified: count = 17, all expected names.*

## 2. Authentication & RBAC smoke

- [ ] Web app loads at `https://31.97.63.234:9443` (browser cert warning expected on self-signed; proceed).
- [ ] Login as the super-admin you set during install — succeeds, lands on dashboard.
- [ ] Idle-logout: leave the tab idle past the configured timeout — auto-logs out and redirects to login.
- [ ] Super-admin sees: Users, Schemes, Hospital Config, Retention, Analytics, Audit Logs, Health.
- [ ] Create a `doctor` user via super-admin → log out → log in as that doctor → can NOT see admin/superadmin pages (403/hidden).
- [ ] Create an `admin` user → can see Analytics + Audit Logs + Health, cannot edit Users/Schemes.
- [ ] Refresh-token rotation: leave the tab open for >15 min (access expires) — UI still works (silent refresh) until refresh token expires (7 days).
- [ ] JWT keys exist and are 600/644: `ls -l /opt/disgen/backend/auth/keys/`.

## 3. Upload flow

- [ ] **As doctor**, upload `sample_pancreatitis_icu_case_sheet.pdf` (your MD-converted PDF).
- [ ] Consent form mandatory — submission without consent_given is rejected (422).
- [ ] Patient name field accepted; document status returned is `processing`.
- [ ] Unsupported file rejected: try uploading a `.txt` → 422 ("Unsupported file type detected"). The MIME check is magic-byte, not extension — try renaming a `.txt` to `.pdf` and confirm it's still rejected.
- [ ] Oversize rejected: try a >25 MB file → 413.
- [ ] Empty file rejected: try a 0-byte file → 422.
- [ ] Dedup works: upload the SAME PDF again → response has `duplicate: true` and points at the original document_id (200 not 201).
- [ ] Rate limit: rapid-fire 11 uploads in <60 s → 11th returns 429.
- [ ] An `UPLOAD` audit row was written: super-admin → Audit Logs filter by action `UPLOAD` → see the entry with sha256, file size, mime.

## 4. OCR pipeline

- [ ] After upload, status auto-advances `processing → ocr_complete → extracting → ready` **without manual refresh**. (This is the Phase 1 polling fix — if it stalls at any point, that's a regression.)
- [ ] OCR completes within ~60–120 s for the 20-page PDF.
- [ ] `GET /api/documents/{id}` shows `pages = 20` (±1 depending on MD→PDF rendering) and `ocr_confidence >= 0.85` for a clean computer-generated PDF (lower for scanned).
- [ ] An `OCR_COMPLETE` audit row exists with pages, confidence, tables_extracted > 0, key_values_extracted > 0.
- [ ] Celery worker logs show no exceptions: `docker logs disgen-celery_worker-1 2>&1 | tail -50`.

## 5. ⭐ Extraction accuracy (THE CRITICAL TEST) — 20-page case sheet

After status reaches `ready`, open the structured-data tab in the UI OR pull
`GET /api/documents/{id}/structured` directly and compare every value below
against the source case sheet.

### 5.1 Patient demographics & scheme metadata

- [ ] `patient_name` = "Mr. Suresh Babu Krishnamurthy" (or "Suresh Babu Krishnamurthy")
- [ ] `age` ≈ "52" / "52 years"
- [ ] `gender` = "Male"
- [ ] `uhid` = "SMH-2026-0041877"
- [ ] `abha_id` = "14-7621-9038-4452"
- [ ] `phone` ≈ "98410 55621" or "9841055621"
- [ ] `blood_group` = "O Positive" / "O+"

### 5.2 Admission

- [ ] `admission_date` = "2026-03-02" (ISO 8601)
- [ ] `discharge_date` = "2026-03-19"
- [ ] `ward` mentions "MICU" (or final ward "3B")
- [ ] `bed_number` mentions "6" or "312" (acceptable variants)
- [ ] `consultant` includes "Anand Subramanian"
- [ ] `department` indicates Critical Care / Gastroenterology

### 5.3 Diagnoses (the LLM must split correctly)

- [ ] `primary_diagnosis` = "Severe Acute Necrotising Pancreatitis" (or close paraphrase capturing severity + necrotising)
- [ ] `secondary_diagnoses` (list) **contains at least 5 of**:
  - [ ] Acute Respiratory Distress Syndrome (ARDS)
  - [ ] Acute Kidney Injury / AKI
  - [ ] Septic shock / Sepsis
  - [ ] Type 2 Diabetes Mellitus
  - [ ] Hypertension
  - [ ] Cholelithiasis
  - [ ] Hospital-acquired pneumonia (Acinetobacter)

### 5.4 ICD-10 mapping (pg_trgm)

- [ ] `icd10_primary` populated automatically with **K85.x** (similarity > 0.4) OR appears in `icd10_primary_candidates` with K85.x near the top.
- [ ] `icd10_secondary` (or candidates) include: **J80** (ARDS), **N17.9** (AKI), **A41.9** (sepsis), **E11.65** (T2DM hyperglycaemia), **I10** (HTN), **K80.20** (cholelithiasis).

### 5.5 Vitals & exam at admission

- [ ] `blood_pressure` = "86/54" (or "86/54 mmHg")
- [ ] `pulse_rate` = "126"
- [ ] `respiratory_rate` = "32"
- [ ] `temperature` ≈ "100.8 °F" / "38.2 °C"
- [ ] `oxygen_saturation` mentions "88%" (RA) or "94%" (on O₂)
- [ ] `weight` = "74 kg" · `height` = "170 cm"

### 5.6 Investigations — **THE chunked-extraction stress test** (every lab row across 7 panels must survive)

Open the `investigations` array. Count and verify:

- [ ] **Day 1 (02-Mar-2026)** panel — at least these are present with date `2026-03-02`:
  - [ ] Haemoglobin 17.8 · TLC 21,400 · Platelets 1,12,000 · Haematocrit 53.2 · MCV 88 · RDW 14.8
  - [ ] Differential: Neutrophils 88, Lymphocytes 7, Monocytes 4, Eosinophils 1
  - [ ] Urea 78 · Creatinine 2.6 · eGFR 28 · Na 131 · K 5.6 · Cl 98 · HCO₃ 16 · Uric acid 9.1
  - [ ] Bilirubin total 3.4 · direct 2.1 · AST 188 · ALT 156 · ALP 342 · GGT 410 · TP 5.4 · Albumin 2.6
  - [ ] **Amylase 1,420 · Lipase 3,860** (the diagnostic markers — must be present)
  - [ ] CRP 286 · Procalcitonin 8.4 · LDH 720 · Calcium 7.2 · Triglycerides 410 · RBS 318 · HbA1c 9.6
  - [ ] ABG: pH 7.28, pCO₂ 30, pO₂ 62, HCO₃ 14, lactate 4.8, P/F 142
  - [ ] Coagulation: PT 19.6, INR 1.7, aPTT 44, fibrinogen 168, D-dimer 4,820
- [ ] **Day 3 (04-Mar-2026)** — Hb 11.2, TLC 26,800, Plt 78k, Creat 3.8, K 6.2, Lipase 2,910, CRP 342, PCT 14.6, INR 2.1, Lactate 5.6
- [ ] **Day 5 (06-Mar-2026)** — Hb 9.6, Creat 3.1, CRP 240, PCT 6.2, Lipase 980, Calcium 7.6, Lactate 2.4
- [ ] **Day 7 (08-Mar-2026)** — Hb 8.9, Creat 2.2, CRP 150, PCT 2.8, Lipase 360, HbA1c 9.4
- [ ] **Day 10 (11-Mar-2026)** — Hb 9.4, Creat 1.7, CRP 88, PCT 1.1, Lipase 180
- [ ] **Day 14 (15-Mar-2026)** — Hb 10.2, Creat 1.3, CRP 34, Lipase 96, FBS 142, PPBS 198
- [ ] **Day 18 (19-Mar-2026)** — Hb 11.1, Creat 1.1, CRP 12, Lipase 64, HbA1c 9.1

**Total expected lab rows ≈ 80–120 across all panels.** No silent drops.
If <70, something is being lost — check `extraction_meta.truncated_chunks`.

### 5.7 Imaging & procedures

- [ ] `imaging` includes: USG abdomen (02-Mar), CECT abdomen 05-Mar with **CTSI 8**, follow-up CECT 16-Mar with WON, serial CXR, ECG, Echo (LVEF 58%).
- [ ] `procedures` includes (date matched): Intubation 03-Mar, Right IJ CVC 03-Mar, Radial arterial line 03-Mar, **PCD lesser sac 11-Mar (12 Fr pigtail, ~420 mL)**, Tracheostomy 13-Mar, ≥3 dialysis sessions, Ryle's + NJ tube.

### 5.8 Medications (during stay)

`medications_during_stay` should contain (verify exact dose/route/frequency):

- [ ] Noradrenaline 0.05–0.4 µg/kg/min IV infusion (Day 1–7)
- [ ] Meropenem 1 g IV TDS
- [ ] Metronidazole 500 mg IV TDS
- [ ] Colistin 4.5 MU IV BD
- [ ] Teicoplanin 400 mg IV OD
- [ ] Insulin (Regular) IV infusion + Glargine 18u SC OD
- [ ] Pantoprazole 40 mg IV BD
- [ ] Fentanyl 25–50 µg/h IV infusion
- [ ] Hydrocortisone 50 mg IV QID
- [ ] Furosemide 40 mg IV BD
- [ ] Enoxaparin 40 mg SC OD
- [ ] Octreotide 100 µg SC TDS
- [ ] Thiamine 200 mg IV TDS
- [ ] PRBC ×2 / FFP ×4 transfusion events

### 5.9 Drug normalization

- [ ] At least 50% of medications have `normalized: true` and a `generic_name` set (via `pg_trgm` against `drug_mappings`).
- [ ] **No** medication includes Ciprofloxacin (allergy documented). If it appears, the LLM hallucinated — fail this check.

### 5.10 Discharge medications

`discharge_medications` should contain:

- [ ] Insulin Glargine 18 u SC OD HS
- [ ] Insulin Aspart 8-8-8 u SC pre-meals
- [ ] Metformin 500 mg PO BD
- [ ] Pantoprazole 40 mg PO OD × 4 weeks
- [ ] Amlodipine 5 mg PO OD
- [ ] Atorvastatin 20 mg PO HS
- [ ] Pancreatic enzymes (Pancreatin) 25,000 IU PO with meals
- [ ] Thiamine 100 mg PO OD
- [ ] Paracetamol 500 mg PO SOS

### 5.11 Follow-up

- [ ] `follow_up_date` ≈ "2026-03-26" or text "1 week"
- [ ] `follow_up_instructions` mentions **interval laparoscopic cholecystectomy after 6–8 weeks**, repeat CECT at 6 weeks, endocrinology + nephrology review.

### 5.12 Allergies — safety-critical

- [ ] `allergies` field contains **"Ciprofloxacin"** (rash/urticaria).
- [ ] No other fabricated allergies.

### 5.13 ⭐ Phase 4 coverage diagnostics (this is *the* feature you want validated)

Inspect `extraction_meta` in the structured response:

- [ ] `pages_total` ≈ 20
- [ ] `chunk_count` ≥ 3 (proves chunking actually ran; if 1, the doc was small enough — try a longer test)
- [ ] `pages_with_content` covers most pages 1..N
- [ ] `pages_empty` ideally `[]`; if non-empty, list them and manually re-check those pages
- [ ] `truncated_chunks` ideally `[]`. If non-empty, **the split-and-retry path fired** — verify no rows are missing in §5.6.
- [ ] `low_ocr_confidence` = false for a clean PDF
- [ ] `needs_doctor_review` should be **false** for this clean synthetic doc. If true, the amber **coverage banner** must show in the UI listing exactly what to recheck.

### 5.14 What MUST NOT appear (hallucination guard)

- [ ] No invented dates not in the source doc
- [ ] No invented medications (e.g., no Ciprofloxacin, no drug not listed)
- [ ] No invented ICD-10 codes (only the ones derivable from the diagnoses)
- [ ] No PHI from any other patient (sanity)
- [ ] No prompt-injection artifacts (Phase 3 sanitizer should strip; validate via `validation_notes.injection_artifacts == []`)

## 6. ⭐ Summary generation accuracy

- [ ] As doctor: review structured data → make a small edit (e.g., correct a typo) → confirm the **edit-after-confirm reset** works: PATCH while `confirmed` → status returns to `ready`, `data_confirmed=false`, audit log records `reconfirm_required: true`.
- [ ] Re-confirm → status `confirmed`.

### 6.1 PM-JAY scheme (the case sheet has PM-JAY metadata)

- [ ] Click Generate → pick **PM-JAY** → status `generating → generated` within ~30–90 s.
- [ ] Latest summary (`/summary/latest?scheme_id=...`) returns `status:"draft"`, `version: 1`, `summary_fields` populated.
- [ ] PM-JAY scheme-required fields filled from the source data:
  - [ ] PM-JAY beneficiary / card number = "P21449008733112"
  - [ ] Family ID = "TN-CHE-04-188273-001"
  - [ ] Pre-authorisation number = "PA-PMJAY-2026-CHE-559231"
  - [ ] Package code = "MG-SE-31"
  - [ ] Approved amount mentions ₹ 1,75,000 (or total ₹ 2,70,000 with enhancement)
  - [ ] Length of stay = 18 days
- [ ] `validation_notes.empty_required_fields` is empty (or lists *only* fields genuinely missing from the source).
- [ ] `validation_notes.injection_artifacts` = `[]`.
- [ ] No hallucinated PM-JAY metadata (cross-check every code/number against the source PDF).

### 6.2 Cross-scheme regeneration (same source, different scheme)

- [ ] Regenerate with **Private** scheme → new active summary, prior PM-JAY summary `is_active=false` and `superseded_by_id` points at the new one.
- [ ] Regenerate with **Complete** scheme → all sections populated.
- [ ] Switching schemes never invents scheme metadata absent from the source — fields not present in source should be `null`, not fabricated.

### 6.3 Field edits + approval gate

- [ ] PATCH `/summary/latest/fields` to fill a null field → version stays, `validation_notes` recomputes.
- [ ] Approve while any required field is empty → 422 with `missing_fields` array.
- [ ] Fill the missing field → Approve → 200; `status:"approved"`, `approved_by`/`approved_at` set; document status advances to `approved`.

### 6.4 Determinism

- [ ] Regenerate the PM-JAY summary twice without changing the source. Field values should be effectively identical (temperature=0 throughout). Minor whitespace differences acceptable; clinical content drift is not.

### 6.5 PDF rendering

- [ ] GET `/summary/latest/pdf` while in `draft` → PDF downloads, has **DRAFT watermark**.
- [ ] After approve → DRAFT watermark gone.
- [ ] PDF header carries the hospital name you set during install ("Test Care Hospital" or whatever).
- [ ] PDF contains all sections; ICD-10 codes section present and matches structured data.
- [ ] PDF passes a simple eyeball: no broken tables, no `null` strings showing through, no template debris.

## 7. Recovery paths (Phase 2)

- [ ] Force an OCR failure: temporarily revoke the Azure key → upload a doc → status reaches `ocr_failed` after retries. Restore the key.
- [ ] In the doc view, the **DocumentRecoveryPanel** shows "Re-run OCR" button.
- [ ] Click it → status `ocr_failed → processing → ocr_complete → extracting → ready`, document recovers.
- [ ] From a `ready` doc, click **Re-run extraction** → confirms reset, status walks through extraction again; the new structured data replaces the old (version++).
- [ ] Trigger a generation failure (briefly bad OpenAI key) → status `failed` — verify it is now **generatable again** (Phase 2 allowance), no longer stranded.

## 8. State machine contract (Phase 1)

- [ ] `GET /api/documents/state-machine` returns the contract with `in_flight`, `failure`, `editable_structured`, `generatable`, `reprocessable`, `reextractable`, `poll_interval_ms`.
- [ ] Web polling stops at any `stable` state (no console errors, no busy loop).
- [ ] Mobile DocumentDetail (when you reach mobile) uses the same in-flight set — pulls show the same progression.

## 9. Security

- [x] All API responses include `X-Request-ID` header. *Verified: `x-request-id: aeefd7d12a08be6776dda75a47df8d41`.*
- [ ] Backend logs are PHI-scrubbed: `docker logs disgen-backend-1 2>&1 | grep -iE 'patient_name|abha_id' | head` should return masked/empty.
- [ ] CSRF blocks cross-site POSTs (use a test fetch from a different origin without the CSRF token).
- [ ] Idempotency: replay the same upload with the same `Idempotency-Key` → identical response, no duplicate row.
- [ ] Rate limits enforced (already exercised in §3).
- [ ] ❌ **FAIL** — `/metrics` IS exposed externally: returns HTTP 200 at `https://31.97.63.234:9443/metrics`. Contradicts comment in `main.py` (“Prometheus — internal only (nginx does not expose /metrics externally)”) and OPS_RUNBOOK. Leaks operational telemetry to the public internet. Logged in §13 as ISS-001 (Major). Fix: nginx location block restricting `/metrics`.

## 10. Compliance & audit

- [ ] Every clinical action you performed in this checklist has a corresponding row in Audit Logs (UPLOAD, OCR_COMPLETE, EXTRACT_COMPLETE, STRUCTURED_UPDATE, STRUCTURED_CONFIRM, GENERATE, FIELD_EDIT, APPROVE, PDF_DOWNLOAD, REPROCESS, REEXTRACT as applicable).
- [ ] Consent record visible per upload.
- [ ] Soft-delete (super-admin): delete the test document → it disappears from listings, audit row written, MinIO object & DB row retained for retention compliance.
- [ ] Retention task runs (or can be triggered): `docker exec disgen-backend-1 celery -A tasks.celery_app inspect scheduled` shows `enforce_retention` scheduled.

## 11. Monitoring & ops

- [ ] Grafana reachable at `https://31.97.63.234:9443/grafana` with the admin password from `CREDENTIALS.txt`.
- [ ] Prometheus scrape healthy — Grafana panels for `disgen_*` metrics show data (uploads, ocr_duration, extraction_duration, generation_duration, status_total counters).
- [ ] GlitchTip web reachable; a forced backend exception appears as an event (with PHI scrubbed).
- [ ] Daily backup container is healthy: `docker compose ps postgres_backup` → `Up (healthy)`. Manual: `bash scripts/backup.sh` writes a non-empty `backups/<ts>/disgen.dump`.
- [x] `bash scripts/install.sh --validate` reports no `changeme` placeholders and notes the DPDP warning. *Verified: `.env validated` + the two DPDP warning lines about LLM_PROVIDER=openai.*

## 12. Disaster recovery dry-run (optional but recommended)

- [ ] Stop everything: `cd /opt/disgen && docker compose down` (keeps volumes).
- [ ] `docker compose up -d && sleep 30 && curl -sk https://31.97.63.234:9443/api/health` → 200; previous data still accessible.
- [ ] `bash scripts/restore.sh <a-pre-test-backup-dir>` in a scratch environment → restored DB readable.

## 13. Issues found (record here as you test)

| # | Section | Symptom | Severity (blocker / major / minor) | Repro | Status |
|---|---------|---------|------------------------------------|-------|--------|
| ISS-001 | §9.5 | `/metrics` returns HTTP 200 over the public URL (`https://31.97.63.234:9443/metrics`) — exposes Prometheus operational telemetry externally. nginx not blocking the path despite the documented intent. | **Major** (no PHI in payload; info-leak only) | `curl -sk -o /dev/null -w '%{http_code}\n' https://31.97.63.234:9443/metrics` → 200 | OPEN — fix queued: add nginx `location = /metrics { return 404; }` (or `allow 127.0.0.1; deny all;`) and restart nginx. |
|   |         |         |                                    |       |        |

## 14. Go / no-go gate for hospital review

Promote to hospital review **only when**:

- [ ] §5 — every box ticked. Specifically: zero dropped lab rows across all 7 panels, zero hallucinated medications, allergy preserved, ICD-10 mapped or candidate-listed.
- [ ] §6 — every box ticked. Specifically: PM-JAY scheme fields all extracted from source (no fabrications); approval gate works; PDF renders cleanly with hospital header.
- [ ] §7 — both recovery paths verified.
- [ ] §1, §2, §9 — all green.
- [ ] §13 has **no blocker** entries. Major issues triaged with workaround documented.
- [ ] DPDP plan: hospital sign-off on running review on OpenAI/US is recorded; switch-to-India-provider date scheduled (the seam is built — config flip + provider class only).

---

*Test plan version 1 · Companion docs: `OPS_RUNBOOK.md`, `REDESIGN_PLAN.md`.*
