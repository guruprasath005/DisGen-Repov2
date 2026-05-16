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

- [x] Web app loads at `https://31.97.63.234:9443` (browser cert warning expected on self-signed; proceed). *Verified.*
- [x] Login succeeds, lands on dashboard. *Verified — tested with the doctor account `doctor001`; super-admin login implicitly worked too since the doctor account was created by it.*
- [ ] Idle-logout: leave the tab idle past the configured timeout — auto-logs out and redirects to login.
- [ ] Super-admin sees: Users, Schemes, Hospital Config, Retention, Analytics, Audit Logs, Health.
- [x] Create a `doctor` user via super-admin → log out → log in as that doctor → can NOT see admin/superadmin pages (403/hidden). *Verified: sidebar for `doctor001` shows only `Dashboard` and `Upload`; no Users / Schemes / Audit / Analytics / Health.*
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

- [x] After upload, status auto-advances `processing → ocr_complete → extracting → ready` **without manual refresh**. *Verified live — Phase 1 polling fix working ("Syncing status…" indicator + auto-advance to Extracting then Ready within ~10s and ~30–40s respectively).*
- [x] OCR completes within ~60–120 s for the 20-page PDF. *Beat target — ~10–15s OCR, full pipeline ~30–40s.*
- [x] `GET /api/documents/{id}` shows `pages = 20` (±1 depending on MD→PDF rendering) and `ocr_confidence >= 0.85` for a clean computer-generated PDF (lower for scanned). *Verified: pages = 20 exact, OCR confidence = 97.7%.*
- [ ] An `OCR_COMPLETE` audit row exists with pages, confidence, tables_extracted > 0, key_values_extracted > 0.
- [ ] Celery worker logs show no exceptions: `docker logs disgen-celery_worker-1 2>&1 | tail -50`.

## 5. ⭐ Extraction accuracy (THE CRITICAL TEST) — 20-page case sheet

After status reaches `ready`, open the structured-data tab in the UI OR pull
`GET /api/documents/{id}/structured` directly and compare every value below
against the source case sheet.

### 5.1 Patient demographics & scheme metadata

- [x] `patient_name` = "Mr. Suresh Babu Krishnamurthy" *Verified — exact match.*
- [x] `age` ≈ "52" / "52 years" *Verified: "52 years".*
- [x] `gender` = "Male" *Verified.*
- [x] `uhid` = "SMH-2026-0041877" *Verified.*
- [x] `abha_id` = "14-7621-9038-4452" *Verified.*
- [x] `phone` ≈ "98410 55621" or "9841055621" *Verified: "98410 55621".*
- [x] `blood_group` = "O Positive" / "O+" *Verified: "O Positive".*

### 5.2 Admission

- [x] `admission_date` = "2026-03-02" (ISO 8601) *Verified — exact ISO 8601.*
- [x] `discharge_date` = "2026-03-19" *Verified — exact ISO 8601.*
- [x] `ward` mentions "MICU" (or final ward "3B") *Verified: "MICU".*
- [x] `bed_number` mentions "6" or "312" (acceptable variants) *Verified: "Bed 6".*
- [x] `consultant` includes "Anand Subramanian" *Verified: "Dr. Anand Subramanian".*
- [x] `department` indicates Critical Care / Gastroenterology *Verified: "Surgical Gastroenterology".*

### 5.3 Diagnoses (the LLM must split correctly)

- [x] `primary_diagnosis` = "Severe Acute Necrotising Pancreatitis" (or close paraphrase capturing severity + necrotising) *Verified — extraction captured: "Severe Acute Necrotising Pancreatitis (gallstone + alcohol related), ~35% necrosis, with walled-off necrosis - managed by step-up (percutaneous catheter drainage)" — etiology + severity + complication + management all preserved.*
- [x] `secondary_diagnoses` (list) **contains at least 5 of**: *Verified — extracted with "resolved/recovered" qualifiers preserved:*
  - [x] Acute Respiratory Distress Syndrome (ARDS) *— "Moderate ARDS - resolved (required mechanical ventilation + tracheostomy, decannulated)"*
  - [x] Acute Kidney Injury / AKI *— "AKI KDIGO Stage 3 - recovered (required haemodialysis ×4)"*
  - [x] Septic shock / Sepsis *— "Sepsis with septic shock (E. coli bacteraemia, ESBL) - resolved"*
  - [x] Type 2 Diabetes Mellitus *— "T2DM - uncontrolled (HbA1c 9.6%), now on insulin"*
  - [x] Hypertension *— "Systemic Hypertension"*
  - [x] Cholelithiasis *— "Cholelithiasis - for interval laparoscopic cholecystectomy"*
  - [x] Hospital-acquired pneumonia (Acinetobacter) *— "Hospital-acquired pneumonia (Acinetobacter) - treated"*

### 5.4 ICD-10 mapping (pg_trgm)

- [x] `icd10_primary` populated automatically with **K85.x** (similarity > 0.4) OR appears in `icd10_primary_candidates` with K85.x near the top. *PARTIAL — `icd10_primary` is null, but candidates correctly surface K85.21, K85.22, K85.81, K85.82, K85.20 (the necrotising-pancreatitis family). Doctor selects manually. See ISS-002 / ISS-003.*
- [ ] ❌ `icd10_secondary` (or candidates) include: **J80** (ARDS), **N17.9** (AKI), **A41.9** (sepsis), **E11.65** (T2DM hyperglycaemia), **I10** (HTN), **K80.20** (cholelithiasis). *FAILED — auto-assigned codes are clinically WRONG: O24.424 (gestational DM) for T2DM, K766 (portal hypertension) for systemic HTN, K9186 (post-cholecystectomy retained) for pre-op cholelithiasis. Expected codes J80/N17.9/I10/K80.20 missing even from candidates. Acinetobacter pneumonia correctly surfaced (J1561 sim 0.3968, just under auto threshold). See ISS-002 + ISS-003 — graceful workflow handles this since doctor reviews before confirm.*

### 5.5 Vitals & exam at admission

- [x] `blood_pressure` = "86/54" (or "86/54 mmHg") *Verified: "86/54 mmHg".*
- [x] `pulse_rate` = "126" *Verified: "126 /min".*
- [x] `respiratory_rate` = "32" *Verified: "32 /min".*
- [x] `temperature` ≈ "100.8 °F" / "38.2 °C" *Verified: "100.8 °F" (note: UTF-8 mojibake renders as "Â°F" — see ISS-005).*
- [x] `oxygen_saturation` mentions "88%" (RA) or "94%" (on O₂) *Verified: "88% on room air".*
- [x] `weight` = "74 kg" · `height` = "170 cm" *Verified.*

### 5.6 Investigations — **THE chunked-extraction stress test** (every lab row across 7 panels must survive)

Open the `investigations` array. Count and verify:

- [x] **Day 1 (02-Mar-2026)** panel — at least these are present with date `2026-03-02`: *Verified — 59 entries on this date, every expected value present:*
  - [x] Haemoglobin 17.8 · TLC 21,400 · Platelets 1,12,000 · Haematocrit 53.2 · MCV 88 · RDW 14.8 ✅
  - [x] Differential: Neutrophils 88, Lymphocytes 7, Monocytes 4, Eosinophils 1 ✅
  - [x] Urea 78 · Creatinine 2.6 · eGFR 28 · Na 131 · K 5.6 · Cl 98 · HCO₃ 16 · Uric acid 9.1 ✅
  - [x] Bilirubin total 3.4 · direct 2.1 · AST 188 · ALT 156 · ALP 342 · GGT 410 · TP 5.4 · Albumin 2.6 ✅
  - [x] **Amylase 1,420 · Lipase 3,860** (the diagnostic markers — must be present) ✅
  - [x] CRP 286 · Procalcitonin 8.4 · LDH 720 · Calcium 7.2 · Triglycerides 410 · RBS 318 · HbA1c 9.6 ✅
  - [x] ABG: pH 7.28, pCO₂ 30, pO₂ 62, HCO₃ 14, lactate 4.8, P/F 142 ✅ *(subscript "₂" dropped in pCO/pO/HCO/SaO names — ISS-005)*
  - [x] Coagulation: PT 19.6, INR 1.7, aPTT 44, fibrinogen 168, D-dimer 4,820 ✅
- [x] **Day 3 (04-Mar-2026)** — Hb 11.2, TLC 26,800, Plt 78k, Creat 3.8, K 6.2, Lipase 2,910, CRP 342, PCT 14.6, INR 2.1, Lactate 5.6 ✅ *14 entries — all present*
- [x] **Day 5 (06-Mar-2026)** — Hb 9.6, Creat 3.1, CRP 240, PCT 6.2, Lipase 980, Calcium 7.6, Lactate 2.4 ✅ *12 entries*
- [x] **Day 7 (08-Mar-2026)** — Hb 8.9, Creat 2.2, CRP 150, PCT 2.8, Lipase 360, HbA1c 9.4 ✅ *10 entries*
- [x] **Day 10 (11-Mar-2026)** — Hb 9.4, Creat 1.7, CRP 88, PCT 1.1, Lipase 180 ✅ *9 entries*
- [x] **Day 14 (15-Mar-2026)** — Hb 10.2, Creat 1.3, CRP 34, Lipase 96, FBS 142, PPBS 198 ✅ *10 entries*
- [x] **Day 18 (19-Mar-2026)** — Hb 11.1, Creat 1.1, CRP 12, Lipase 64, HbA1c 9.1 ✅ *10 entries*

**Total expected lab rows ≈ 80–120 across all panels.** No silent drops.
If <70, something is being lost — check `extraction_meta.truncated_chunks`.
**RESULT: ~123 rows preserved across 7 dates (59+14+12+10+9+10+10). Phase 4 chunking + deterministic merge worked exactly as designed — zero clinical rows dropped.** ✅✅✅

### 5.7 Imaging & procedures

- [x] `imaging` includes: USG abdomen (02-Mar), CECT abdomen 05-Mar with **CTSI 8**, follow-up CECT 16-Mar with WON, serial CXR, ECG, Echo (LVEF 58%). *Verified — 8 entries: USG abdomen 02-Mar, CECT pancreatic 05-Mar, CECT follow-up 16-Mar with WON 9.1×7.0×6.0 cm, 4 serial CXRs, Echo with LVEF 58%. **Minor gap**: CTSI 8/10 detail not captured in the Day 4 CECT finding (only the headline preserved).*
- [x] `procedures` includes (date matched): Intubation 03-Mar, Right IJ CVC 03-Mar, Radial arterial line 03-Mar, **PCD lesser sac 11-Mar (12 Fr pigtail, ~420 mL)**, Tracheostomy 13-Mar, ≥3 dialysis sessions, Ryle's + NJ tube. *Verified — all 7 procedures present with exact dates, operators, technical details (ETT size, catheter Fr, mL drained, dialysis session list).*

### 5.8 Medications (during stay)

`medications_during_stay` should contain (verify exact dose/route/frequency): *Verified — all 25 medications present in the extracted list; doses/routes/frequencies match the source.*

- [x] Noradrenaline 0.05–0.4 µg/kg/min IV infusion (Day 1–7) *(µg shown as "1g" — ISS-005)*
- [x] Meropenem 1 g IV TDS
- [x] Metronidazole 500 mg IV TDS
- [x] Colistin 4.5 MU IV BD
- [x] Teicoplanin 400 mg IV OD
- [x] Insulin (Regular) IV infusion + Glargine 18u SC OD
- [x] Pantoprazole 40 mg IV BD
- [x] Fentanyl 25–50 µg/h IV infusion
- [x] Hydrocortisone 50 mg IV QID
- [x] Furosemide 40 mg IV BD
- [x] Enoxaparin 40 mg SC OD
- [x] Octreotide 100 µg SC TDS
- [x] Thiamine 200 mg IV TDS
- [x] PRBC ×2 / FFP ×4 transfusion events

### 5.9 Drug normalization

- [x] At least 50% of medications have `normalized: true` and a `generic_name` set (via `pg_trgm` against `drug_mappings`). *Verified: 17/25 normalized = 68%. Generics correctly resolved (e.g., Noradrenaline → "Norepinephrine (Noradrenaline)", Lactated Ringer's, Insulin Glargine, etc.). Not normalized: Meropenem, Teicoplanin, Calcium Gluconate, KCl, Vitamin K, Octreotide, Pancreatin, NJ feed (gaps in `drug_mappings` table — improvement target, not blocker).*
- [x] **No** medication includes Ciprofloxacin (allergy documented). If it appears, the LLM hallucinated — fail this check. *Verified — exhaustively scanned medications_during_stay AND discharge_medications: zero Cipro/fluoroquinolone hallucinations. ✅ Safety-critical pass.*

### 5.10 Discharge medications

`discharge_medications` should contain:

- [x] Insulin Glargine 18 u SC OD HS *— Verified*
- [x] Insulin Aspart 8-8-8 u SC pre-meals *— Verified*
- [x] Metformin 500 mg PO BD *— Verified*
- [x] Pantoprazole 40 mg PO OD × 4 weeks *— Verified*
- [x] Amlodipine 5 mg PO OD *— Verified*
- [x] Atorvastatin 20 mg PO HS *— Verified*
- [x] Pancreatic enzymes (Pancreatin) 25,000 IU PO with meals *— Verified — Cap Pancreatic Enzyme 25,000 IU × 8 weeks*
- [x] Thiamine 100 mg PO OD *— Verified, × 8 weeks*
- [x] Paracetamol 500 mg PO SOS *— Verified, max QID*

All 10 discharge medications captured with correct doses, frequencies, and durations.

### 5.11 Follow-up

- [x] `follow_up_date` ≈ "2026-03-26" or text "1 week" *Verified: "2026-03-26".*
- [ ] `follow_up_instructions` mentions **interval laparoscopic cholecystectomy after 6–8 weeks**, repeat CECT at 6 weeks, endocrinology + nephrology review. *PARTIAL: captured Surgical Gastro OPD 26-Mar with Dr. Anand Subramanian + repeat USG abdomen. The interval cholecystectomy ended up in `secondary_diagnoses` ("Cholelithiasis - for interval laparoscopic cholecystectomy"). The repeat-CECT-at-6-weeks + endocrinology/nephrology review are NOT in this field. Acceptable (info dispersed across fields) — minor.*

### 5.12 Allergies — safety-critical

- [x] `allergies` field contains **"Ciprofloxacin"** (rash/urticaria). *Verified — exact text: "Ciprofloxacin - rash and urticaria documented previously".* ✅
- [x] No other fabricated allergies. *Verified.* ✅

### 5.13 ⭐ Phase 4 coverage diagnostics (this is *the* feature you want validated)

Inspect `extraction_meta` in the structured response:

- [ ] ❌ `extraction_meta` field is **absent** from the stored structured data response. Only `extraction_source: "merged"` is present. The Phase 4 coverage telemetry (`chunk_count`, `truncated_chunks`, `pages_empty`, `low_ocr_confidence`, `needs_doctor_review`) is NOT being persisted, so the UI's amber coverage banner can never appear. The chunking itself clearly executed (proved by ~123 lab rows preserved across 7 dates without drops), but the diagnostics aren't reaching storage. **See ISS-004 — investigate the path from `extract_structured()` returning `extraction_meta=meta` to the encrypted JSON write in `extract_tasks._pipeline`.**

### 5.14 What MUST NOT appear (hallucination guard)

- [x] No invented dates not in the source doc *Verified.*
- [x] No invented medications (e.g., no Ciprofloxacin, no drug not listed) *Verified — no Cipro/fluoroquinolone anywhere; every medication maps to a source line.* ✅
- [x] No invented ICD-10 codes (only the ones derivable from the diagnoses) *Verified — the codes that surfaced (incl. the wrong auto-assigns) all came from the actual `icd10_codes` table by similarity; the LLM did NOT fabricate codes. See ISS-002 about wrong mappings — different problem from hallucination.*
- [x] No PHI from any other patient (sanity) *Verified.*
- [x] No prompt-injection artifacts *Verified — no injection-like patterns in extracted text.*

## 6. ⭐ Summary generation accuracy

- [ ] As doctor: review structured data → make a small edit (e.g., correct a typo) → confirm the **edit-after-confirm reset** works: PATCH while `confirmed` → status returns to `ready`, `data_confirmed=false`, audit log records `reconfirm_required: true`.
- [ ] Re-confirm → status `confirmed`.

### 6.1 PM-JAY scheme (the case sheet has PM-JAY metadata)

- [x] Click Generate → pick **PM-JAY** → status `generating → generated` within ~30–90 s. *Verified — auto-progressed.*
- [x] Latest summary (`/summary/latest?scheme_id=...`) returns `status:"draft"`, `version: 1`, `summary_fields` populated. *Verified — draft created.*
- [ ] ❌ PM-JAY scheme-required fields filled from the source data: *MOSTLY FAILED — ISS-006:*
  - [ ] PM-JAY beneficiary / card number = "P21449008733112" *— BLANK*
  - [ ] Family ID = "TN-CHE-04-188273-001" *— BLANK*
  - [ ] Pre-authorisation number = "PA-PMJAY-2026-CHE-559231" *— BLANK*
  - [ ] Package code = "MG-SE-31" *— BLANK*
  - [ ] Approved amount mentions ₹ 1,75,000 (or total ₹ 2,70,000 with enhancement) *— BLANK*
  - [ ] Length of stay = 18 days *— BLANK*
  - [x] Health ID (HID) = ABHA `14-7621-9038-4452` *— correctly mapped from abha_id*
- [ ] `validation_notes.empty_required_fields` is empty *— will list multiple PMJAY fields; approval gate blocks correctly (good)*
- [x] No hallucinated PM-JAY metadata. *Verified — fields are blank, NOT invented. System fails safe.*

### 6.2 Cross-scheme regeneration (same source, different scheme)

- [ ] Regenerate with **Private** scheme → new active summary, prior PM-JAY summary `is_active=false` and `superseded_by_id` points at the new one.
- [ ] Regenerate with **Complete** scheme → all sections populated.
- [ ] Switching schemes never invents scheme metadata absent from the source — fields not present in source should be `null`, not fabricated.

### 6.3 Field edits + approval gate

- [x] PATCH `/summary/latest/fields` to fill a null field → version stays, `validation_notes` recomputes. *Verified via the Edit UI — manually filled PMJAY blanks with case-sheet values.*
- [x] Approve while any required field is empty → 422 with `missing_fields` array. *Verified — user reported "without filling the data, I can't able to upload" = approval was blocked.*
- [x] Fill the missing field → Approve → 200; `status:"approved"`, `approved_by`/`approved_at` set; document status advances to `approved`. *Verified — PDF footer reads "Status APPROVED · Approved by Doctor-001 on 16-May-2026 11:04".*

### 6.4 Determinism

- [ ] Regenerate the PM-JAY summary twice without changing the source. Field values should be effectively identical (temperature=0 throughout). Minor whitespace differences acceptable; clinical content drift is not.

### 6.5 PDF rendering

- [ ] GET `/summary/latest/pdf` while in `draft` → PDF downloads, has **DRAFT watermark**. *Skipped — went straight to approved download.*
- [x] After approve → DRAFT watermark gone. *Verified — final PDF has no DRAFT watermark; footer reads "Status APPROVED".*
- [ ] ❌ PDF header carries the hospital name you set during install. *FAILED — header reads literal "Hospital Name". See ISS-007.*
- [ ] ❌ PDF contains all sections; ICD-10 codes section present. *FAILED — no ICD-10 block in PDF. See ISS-009.*
- [x] PDF passes a simple eyeball: no broken tables, no `null` strings showing through, no template debris. *Verified — 4 pages, clean rendering, professional template. Two real gaps documented (ISS-007, ISS-008 SAFETY, ISS-009).*

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
- [x] /metrics is NOT exposed externally. *Fixed (commit `8dffc1a`): added `location ^~ /metrics { return 404; }` to both 443 and 8080 server blocks. Verified post-restart: `/metrics` and `/metrics/foo` → HTTP 404; `/api/health` → 200; SPA still serves. See ISS-001 (RESOLVED).*

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
| ISS-001 | §9.5 | `/metrics` returned HTTP 200 over the public URL in Batch 1. Body inspection later (pre-fix in Batch 2) showed an nginx 404 instead — behaviour was intermittent between the two test runs (suspected try_files internal-redirect / SPA-fallback edge case). Either way it was not a Prometheus leak (no proxy to backend:8000/metrics in the config). | Minor (downgraded after body inspection — operational telemetry was never reachable) | Originally `curl https://31.97.63.234:9443/metrics → 200`; post-fix `→ 404` consistently | **RESOLVED** in `8dffc1a`: explicit `location ^~ /metrics { return 404; }` added to both 443 and 8080 server blocks. Verified on VPS: /metrics & /metrics/foo → 404; /api/health → 200; SPA → 200. |
| ISS-002 | §5.4 | ICD-10 **auto-assignments are clinically wrong** for 3 secondary diagnoses: T2DM → `O24.424` (gestational DM in childbirth — patient is a 52-year-old man); Systemic HTN → `K766` (Portal hypertension — hepatic); Pre-op Cholelithiasis → `K9186` (Retained cholelithiasis following cholecystectomy — post-op). pg_trgm `>0.4` threshold admits semantically wrong matches because the raw diagnosis text is verbose vs. short ICD descriptions. | **Major** (billing-accuracy impact). Workflow-mitigated: doctor must confirm structured data before generating, so wrong codes are caught at review. | Upload the case sheet → check `icd10_secondary` auto-assigned codes against the diagnosis strings. | OPEN — recommend: (a) tighten threshold to 0.6 OR (b) LLM-proposed + table-verified ICD-10 mapping (deferred future improvement noted in REDESIGN_PLAN). Until then, **doctor MUST review ICD-10 codes before confirm**. |
| ISS-003 | §5.4 | Expected ICD-10 codes **NOT surfaced even as candidates** for several diagnoses: **J80** (ARDS — abbreviation doesn't trigram-match the spelled-out description), **N17.9** (AKI — same pattern), **I10** (Essential HTN — masked by Portal HTN auto-match), **K80.20** (Cholelithiasis — masked by post-op variant). | **Major** — these are common Indian hospital codes. | Inspect `icd10_secondary_candidates` for the diagnoses listed. | OPEN — same recommendation as ISS-002; also consider seeding a synonym/abbreviation dictionary (ARDS, AKI, MI, etc.) for the trigram lookup. |
| ISS-004 | §5.13 | `extraction_meta` (Phase 4 coverage diagnostics) is **absent from the stored structured data response**. Only `extraction_source: "merged"` is present. The chunking + truncation-split clearly executed (proven by no row loss across 7 dated lab panels), but the meta object (`chunk_count`, `truncated_chunks`, `pages_empty`, `low_ocr_confidence`, `needs_doctor_review`) is missing. UI amber coverage banner cannot appear without it. | Medium (telemetry-only; extraction itself is correct) | `GET /api/documents/{id}/structured` → no `extraction_meta` key in `data` object. | OPEN — debug: confirm `backend/llm/extractor.py` `extract_structured()` is populating `filtered["extraction_meta"] = meta` AND that `StructuredData.extraction_meta` exists in the deployed container's source (verify via `docker exec disgen-backend-1 python3 -c "from llm.extractor import StructuredData; import dataclasses; print([f.name for f in dataclasses.fields(StructuredData)])"`). |
| ISS-005 | §5 (multi) | UTF-8 / encoding glitches in extracted strings: `/µL → /1L/HL/pL`; `°F → Â°F`; `×4 → Ã4`; subscript 2 dropped from pCO₂ / pO₂ / HCO₃⁻ / SaO₂. Source is the MD → PDF → Azure OCR pipeline; the underlying values are correct. | Minor (cosmetic; values numerically accurate) | Visible throughout extracted JSON. | OPEN — post-process normalizer in `extractor.py` could collapse mojibake to canonical unicode (e.g., `Â°` → `°`, restore `µ`, `×`, subscripts). Quick win. |
| ISS-006 | §6.1 | **Scheme-specific identifiers in the source PDF are not extracted** — PMJAY card number, family ID, pre-authorisation number, package code, procedure code, approved amount, length of stay all came out **blank** in the generated PMJAY summary, even though every one of them is on page 1 of the source case sheet and Azure OCR clearly read them (97.7% confidence). Root cause: `backend/llm/extractor.py`'s extraction prompt + `StructuredData` dataclass only model clinical fields; scheme metadata (PM-JAY / CGHS / ESI identifiers) is never asked for, so it doesn't reach `structured_reports.data`, so `generate_scheme_fields()` has nothing to draw from. The system **fails safely** — fields are blank, never invented — and the approval gate blocks until the doctor fills them. ABHA → HID mapping is the one scheme field that worked (because abha_id IS a modelled extractor field). | **Major** — defeats the automation value for PM-JAY/CGHS billing; doctor must hand-retype identifiers visible in the source PDF. | Confirm structured data → Generate with PM-JAY scheme → inspect `summary_fields` — every scheme-specific field is null. | OPEN — fix: add scheme-metadata fields to `StructuredData` (e.g., `scheme_beneficiary_id`, `scheme_card_number`, `scheme_family_id`, `pre_authorization_number`, `package_code`, `procedure_code`, `approved_amount`, `length_of_stay`, `implants_used`) AND extend the `_SYSTEM_PROMPT` in `extractor.py` to request them. ~30 min, single-file change; flows downstream automatically. |
| ISS-007 | §6.5 | PDF header shows literal placeholder **"Hospital Name"** instead of the install-time `HOSPITAL_NAME="Test Care Hospital"`. The PDF template pulls from the `hospital_config` DB row, which was never seeded from the install `.env`. | **Major** — embarrassing in a hospital review. | Open downloaded discharge PDF → header reads "Hospital Name PM-JAY". | OPEN — fix: seed `hospital_config` in `install.sh`/seed step with the install-time HOSPITAL_NAME/HOSPITAL_ID/CORS_DOMAIN values; OR have super-admin Hospital Config page set it. ~15 min change. Workaround NOW: log in as super-admin → Hospital Config → fill in name + address + sign-off line. |
| ISS-008 | §6.5 | 🚨 **SAFETY** — the rendered discharge-summary PDF does **NOT contain an Allergies section**. Patient is documented allergic to **Ciprofloxacin** (rash + urticaria); structured data preserves it correctly; UI surfaces it; but the PDF the patient walks home with prints NO allergy warning. A doctor elsewhere prescribing a fluoroquinolone has no way to know. | **Major / safety-critical for hospital review** — discharge summaries must print drug allergies prominently. | Open downloaded discharge PDF → no Allergies section anywhere in pages 1–4. | OPEN — fix: add `ALLERGIES` section to `backend/pdf/templates/*.html` (or whichever template the PMJAY scheme uses) — rendered prominently near the top, with patient-safety styling. Field already exists in source data (`structured.allergies`). ~10 min template change. **Must ship before hospital sees the system.** |
| ISS-009 | §6.5 | PDF has Diagnosis section (text) but **no separate ICD-10 codes block**. Hospital billing typically requires ICD codes on the discharge summary. | Medium | Open downloaded discharge PDF → no ICD-10 codes section. | OPEN — fix together with ISS-002/003 (correct ICD mapping) + template addition for an ICD-10 codes block. Render auto-mapped + doctor-selected codes. ~20 min after ICD fix. |

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
