"""
Anonymized few-shot JSON examples for discharge summary generation.

One compact example per built-in scheme embedded in the cached system block.
All names, IDs, dates, and clinical details are entirely fabricated — no PHI.

Keys match SUMMARY_SECTION_KEYS in llm/generator.py (snake_case, 10 sections).
"""

from __future__ import annotations

# ── PM-JAY ────────────────────────────────────────────────────────────────────

_PMJAY: dict[str, str] = {
    "patient_information": (
        "Name: Rajesh Kumar | Age: 52 years | Gender: Male | UHID: HOSP-2024-001 | "
        "Blood Group: B+\nPMJAY Beneficiary ID: 12-3456-7890-0001 | HID Card: HID-9876543"
    ),
    "admission_and_discharge_details": (
        "Admission: 05-Jan-2024 (Emergency) | Discharge: 12-Jan-2024\n"
        "Ward: General Medicine | Bed: GM-14 | Duration: 7 days"
    ),
    "primary_and_secondary_diagnosis": (
        "Primary: Community Acquired Pneumonia (J18.0)\n"
        "Secondary: Type 2 Diabetes Mellitus (E11.9) | Hypertension (I10)"
    ),
    "clinical_assessment": (
        "52-year-old male presented with 5-day history of fever, productive cough, and progressive "
        "breathlessness. SpO2 88% on room air at admission. Chest examination: bilateral basal "
        "crepts. Managed with IV antibiotics and supportive therapy. Responded well; oxygen "
        "requirements resolved by Day 4. Discharged in stable condition, ambulant."
    ),
    "laboratory_and_investigation_results": (
        "CBC: Hb 11.2 g/dL | WBC 14,800 cells/μL (neutrophilia) | Platelets 2.1 L/μL\n"
        "CRP: 98 mg/L (elevated) | Fasting glucose: 182 mg/dL\n"
        "Chest X-ray (admission): Bilateral lower-zone consolidation\n"
        "Chest X-ray (discharge): Significant clearing of consolidation"
    ),
    "treatment_during_stay": (
        "IV Amoxicillin-Clavulanate 1.2 g BD × 5 days\n"
        "IV Azithromycin 500 mg OD × 3 days\n"
        "Nebulisation: Salbutamol + Ipratropium TDS\n"
        "Subcutaneous Insulin Glargine 10 units nocte (sliding scale)\n"
        "Supplemental oxygen: 2–4 L/min via nasal prongs (Days 1–4)"
    ),
    "discharge_medications": (
        "Tab Amoxicillin-Clavulanate 625 mg BD × 5 days (after meals)\n"
        "Tab Azithromycin 500 mg OD × 2 days (to complete course)\n"
        "Tab Metformin 500 mg BD (resume home medication)\n"
        "Tab Amlodipine 5 mg OD (resume home medication)\n"
        "Syp Ambroxol 10 mL TDS × 7 days"
    ),
    "follow_up_instructions": (
        "General Medicine OPD: 19-Jan-2024 (Dr Sharma, Room 5)\n"
        "Diabetology review: 26-Jan-2024\n"
        "Tests at follow-up: HbA1c, Fasting Blood Sugar, repeat Chest X-ray\n"
        "Avoid cold exposure. Complete antibiotic course fully. Monitor capillary blood sugar daily."
    ),
    "icd_10_codes": (
        "J18.0 — Pneumonia, unspecified organism\n"
        "E11.9 — Type 2 diabetes mellitus without complications\n"
        "I10   — Essential (primary) hypertension"
    ),
    "scheme_specific_fields": (
        "Scheme: PM-JAY (Pradhan Mantri Jan Arogya Yojana)\n"
        "PMJAY Beneficiary ID: 12-3456-7890-0001\n"
        "HID Card Number: HID-9876543\n"
        "Pre-authorisation Number: AUTH-2024-PMJAY-00892\n"
        "PMJAY Package Code: HBP1106 — Respiratory conditions requiring hospitalisation"
    ),
}

# ── CGHS ──────────────────────────────────────────────────────────────────────

_CGHS: dict[str, str] = {
    "patient_information": (
        "Name: Meena Sharma | Age: 61 years | Gender: Female | UHID: HOSP-2024-002\n"
        "CGHS Beneficiary No: CGH-DL-0045678 | Employee ID: MH-GOV-9900234"
    ),
    "admission_and_discharge_details": (
        "Admission: 10-Feb-2024 (Elective) | Discharge: 14-Feb-2024\n"
        "Ward: Cardiology | Bed: CARD-07 | Duration: 4 days"
    ),
    "primary_and_secondary_diagnosis": (
        "Primary: Unstable Angina (I20.0)\n"
        "Secondary: Hyperlipidaemia (E78.5) | Hypothyroidism (E03.9)"
    ),
    "clinical_assessment": (
        "61-year-old retired central government employee admitted with chest pain at rest. "
        "ECG: ST-segment depression in leads II, III, and aVF. Troponin-I negative on serial "
        "testing. Managed medically with antiplatelet, anticoagulant, and statin therapy. "
        "Coronary angiogram deferred to outpatient per patient preference. Discharged stable."
    ),
    "laboratory_and_investigation_results": (
        "Troponin-I: 0.01 ng/mL (negative, ×3) | ECG: ST-depression II/III/aVF\n"
        "Total cholesterol: 248 mg/dL | LDL: 172 mg/dL | TSH: 6.8 mIU/L (elevated)\n"
        "2D Echocardiography: EF 55%, no regional wall-motion abnormality"
    ),
    "treatment_during_stay": (
        "Inj Heparin 5,000 units SC BD\n"
        "Tab Aspirin 325 mg (loading) then 75 mg OD\n"
        "Tab Clopidogrel 300 mg (loading) then 75 mg OD\n"
        "Tab Atorvastatin 80 mg nocte | Tab Metoprolol 25 mg BD\n"
        "Tab Pantoprazole 40 mg OD | Continuous cardiac monitoring"
    ),
    "discharge_medications": (
        "Tab Aspirin 75 mg OD (with food, long-term)\n"
        "Tab Clopidogrel 75 mg OD × 12 months\n"
        "Tab Atorvastatin 80 mg nocte\n"
        "Tab Metoprolol Succinate 25 mg OD\n"
        "Tab Levothyroxine 50 mcg OD (30 min before breakfast)\n"
        "Tab Pantoprazole 40 mg OD (before breakfast)"
    ),
    "follow_up_instructions": (
        "Cardiology OPD: 21-Feb-2024 (Dr Rajan, Room 12)\n"
        "Bring: previous ECG, echo report, lipid profile\n"
        "Coronary angiogram to be scheduled — CGHS pre-authorisation required\n"
        "Avoid strenuous exertion. Report immediately for chest pain, breathlessness."
    ),
    "icd_10_codes": (
        "I20.0 — Unstable angina\n"
        "E78.5 — Hyperlipidaemia, unspecified\n"
        "E03.9 — Hypothyroidism, unspecified"
    ),
    "scheme_specific_fields": (
        "Scheme: CGHS (Central Government Health Scheme)\n"
        "CGHS Card Number: CGH-DL-0045678\n"
        "Employee ID: MH-GOV-9900234 | Designation: Retired Grade-B Officer (Ministry of Finance)\n"
        "CGHS Referral Number: CGHS-DL-REF-2024-11234\n"
        "Empanelment Status: Yes — MoHFW Empanelled Panel 2024"
    ),
}

# ── ESI ───────────────────────────────────────────────────────────────────────

_ESI: dict[str, str] = {
    "patient_information": (
        "Name: Suresh Babu | Age: 38 years | Gender: Male | UHID: HOSP-2024-003\n"
        "ESI IP Number: ESI-KA-4567890 | Dispensary Code: ESI-BLNG-022"
    ),
    "admission_and_discharge_details": (
        "Admission: 20-Mar-2024 (Emergency) | Discharge: 25-Mar-2024\n"
        "Ward: Surgery | Bed: SURG-11 | Duration: 5 days"
    ),
    "primary_and_secondary_diagnosis": (
        "Primary: Acute Appendicitis (K35.8)\n"
        "Secondary: Not documented"
    ),
    "clinical_assessment": (
        "38-year-old male factory worker presented with 24-hour history of right iliac fossa pain, "
        "fever (38.8°C), and vomiting. Rovsing's sign positive. WBC 18,200 cells/μL. "
        "USG confirmed acute appendicitis. Emergency laparoscopic appendicectomy performed under "
        "general anaesthesia. Uneventful recovery. Tolerating orals. Discharged stable."
    ),
    "laboratory_and_investigation_results": (
        "WBC: 18,200 cells/μL (neutrophilia 82%) | CRP: 142 mg/L\n"
        "USG Abdomen: Thickened aperistaltic appendix 9 mm, periappendiceal fat stranding\n"
        "Post-op wound: clean, no erythema or discharge on Day 4"
    ),
    "treatment_during_stay": (
        "Emergency laparoscopic appendicectomy — 21-Mar-2024 (Dr Prakash, Surgery)\n"
        "General anaesthesia — Dr Venkatesan, Anaesthetics\n"
        "IV Cefuroxime 1.5 g TDS (pre-op + 48 h post-op)\n"
        "IV Metronidazole 500 mg TDS × 48 h\n"
        "IV Paracetamol 1 g TDS for analgesia | IV RL + DNS × 48 h"
    ),
    "discharge_medications": (
        "Tab Amoxicillin-Clavulanate 625 mg TDS × 5 days (after meals)\n"
        "Tab Metronidazole 400 mg TDS × 5 days\n"
        "Tab Ibuprofen 400 mg TDS × 3 days (with food, for pain)\n"
        "Tab Pantoprazole 40 mg OD × 7 days"
    ),
    "follow_up_instructions": (
        "Surgical OPD: 01-Apr-2024 for suture removal (Dr Prakash)\n"
        "ESI dispensary follow-up for completion of coverage documentation\n"
        "Avoid heavy lifting > 5 kg for 4 weeks. Avoid driving for 1 week.\n"
        "Return immediately for: fever > 38°C, wound discharge, or severe abdominal pain."
    ),
    "icd_10_codes": "K35.8 — Other and unspecified acute appendicitis",
    "scheme_specific_fields": (
        "Scheme: ESI (Employees' State Insurance)\n"
        "ESI IP Number: ESI-KA-4567890\n"
        "Dispensary Code: ESI-BLNG-022 | Insurance Period: Apr 2023 – Mar 2025\n"
        "Employer: ABC Textiles Pvt Ltd | ESI Branch Office: Bengaluru South"
    ),
}

# ── CMCHIS ────────────────────────────────────────────────────────────────────

_CMCHIS: dict[str, str] = {
    "patient_information": (
        "Name: Lakshmi Devi | Age: 67 years | Gender: Female | UHID: HOSP-2024-004\n"
        "CMCHIS Card Number: TN-CM-8901234 | Scheme Code: CMCHIS-001"
    ),
    "admission_and_discharge_details": (
        "Admission: 05-Apr-2024 (Elective) | Discharge: 10-Apr-2024\n"
        "Ward: Orthopaedics | Bed: ORTH-05 | Duration: 5 days"
    ),
    "primary_and_secondary_diagnosis": (
        "Primary: Right Femoral Neck Fracture (S72.0)\n"
        "Secondary: Osteoporosis (M81.0) | Hypertension (I10)"
    ),
    "clinical_assessment": (
        "67-year-old female presented with right hip pain and inability to weight-bear following a "
        "ground-level fall. X-ray: displaced right femoral neck fracture (Garden Grade IV). "
        "Elective right hemiarthroplasty performed under spinal anaesthesia. Post-operative "
        "physiotherapy commenced Day 2. Discharged ambulant with walking frame."
    ),
    "laboratory_and_investigation_results": (
        "Pre-op Hb: 10.8 g/dL | Serum Creatinine: 1.1 mg/dL | ECG: Normal sinus rhythm\n"
        "X-ray right hip (AP/lateral): Displaced fracture right femoral neck — Garden IV\n"
        "DEXA Bone Densitometry: T-score −3.2 (severe osteoporosis)"
    ),
    "treatment_during_stay": (
        "Right hemiarthroplasty — 06-Apr-2024 (Dr Arun, Orthopaedics)\n"
        "Spinal anaesthesia — Dr Priya, Anaesthetics\n"
        "IV Cefazolin 1 g pre-op + 24 h post-op (prophylaxis)\n"
        "Inj Enoxaparin 40 mg SC OD × 5 days (DVT prophylaxis)\n"
        "Physiotherapy: partial weight bearing with walking frame from Day 2"
    ),
    "discharge_medications": (
        "Tab Calcium 500 mg + Vitamin D3 250 IU BD\n"
        "Tab Alendronate 70 mg once weekly (morning, fasting, with full glass of water)\n"
        "Tab Tramadol 50 mg BD × 5 days (for pain, with food)\n"
        "Tab Pantoprazole 40 mg OD × 2 weeks\n"
        "Tab Amlodipine 5 mg OD (continue for hypertension)"
    ),
    "follow_up_instructions": (
        "Orthopaedics OPD: 20-Apr-2024 — suture removal and X-ray check (Dr Arun)\n"
        "Physiotherapy OPD: twice weekly × 6 weeks\n"
        "CMCHIS coverage valid for implant follow-up for 6 months from date of surgery\n"
        "Avoid low chairs, cross-legged sitting, bending forward beyond 90°. Use handrails."
    ),
    "icd_10_codes": (
        "S72.0 — Fracture of neck of femur\n"
        "M81.0 — Osteoporosis without current pathological fracture\n"
        "I10   — Essential (primary) hypertension"
    ),
    "scheme_specific_fields": (
        "Scheme: CMCHIS (Chief Minister's Comprehensive Health Insurance Scheme — Tamil Nadu)\n"
        "CMCHIS Card Number: TN-CM-8901234\n"
        "Scheme Code: CMCHIS-001 | Coverage Amount Utilised: ₹45,000\n"
        "Pre-authorisation Reference: TN-CMCHIS-AUTH-2024-03291\n"
        "CMCHIS Package: Orthopaedic — Hip Arthroplasty (Package No. 709)"
    ),
}

# ── Private (Health Insurance) ────────────────────────────────────────────────

_PRIVATE: dict[str, str] = {
    "patient_information": (
        "Name: Arjun Mehta | Age: 44 years | Gender: Male | UHID: HOSP-2024-005\n"
        "Insurance Policy: POL-2024-STAR-7654321 | TPA: Star Health & Allied Insurance"
    ),
    "admission_and_discharge_details": (
        "Admission: 15-May-2024 (Emergency) | Discharge: 19-May-2024\n"
        "Ward: ICU (Days 1–2) then General Surgery (Days 3–4) | Duration: 4 days"
    ),
    "primary_and_secondary_diagnosis": (
        "Primary: Acute Pancreatitis (K85.0)\n"
        "Secondary: Hypertriglyceridaemia (E78.1)"
    ),
    "clinical_assessment": (
        "44-year-old male presented with severe epigastric pain radiating to the back, nausea, and "
        "vomiting. Serum lipase 4,200 U/L (>3× normal). CT abdomen: pancreatic oedema with "
        "peripancreatic fat stranding, no necrosis (Balthazar C, CT Severity Index 4). "
        "Managed conservatively in ICU: nil by mouth, aggressive IV fluids, analgesia. Transitioned "
        "to oral diet on Day 3. Discharged in satisfactory condition."
    ),
    "laboratory_and_investigation_results": (
        "Serum Lipase: 4,200 U/L | Serum Amylase: 1,800 U/L\n"
        "Triglycerides: 920 mg/dL (severely elevated) | LFT: within normal limits\n"
        "CT Abdomen (contrast): Pancreatic oedema, peripancreatic fat stranding; no necrosis — "
        "Balthazar C, CT-Severity Index 4"
    ),
    "treatment_during_stay": (
        "Aggressive IV fluid resuscitation: Ringer's Lactate 150 mL/h × 48 h\n"
        "Inj Pantoprazole 40 mg IV BD | Inj Tramadol 50 mg IV TDS (analgesia)\n"
        "Nil by mouth × 48 h; oral clear liquids from Day 3\n"
        "Insulin infusion for hyperglycaemia secondary to hypertriglyceridaemia\n"
        "Continuous vitals monitoring in ICU (Days 1–2)"
    ),
    "discharge_medications": (
        "Tab Pantoprazole 40 mg OD × 4 weeks (before breakfast)\n"
        "Tab Fenofibrate 145 mg OD (for hypertriglyceridaemia, with dinner)\n"
        "Cap Omega-3 Fatty Acids 1 g BD\n"
        "Tab Paracetamol 500 mg SOS for pain\n"
        "Strict low-fat diet: < 20 g total fat per day"
    ),
    "follow_up_instructions": (
        "Gastroenterology OPD: 26-May-2024 (Dr Nair)\n"
        "Repeat fasting lipid profile in 4 weeks\n"
        "Submit final bills and discharge summary to TPA within 15 days\n"
        "Pre-auth Reference: PA-STAR-2024-88123\n"
        "Absolute alcohol abstinence. Strict low-fat diet indefinitely."
    ),
    "icd_10_codes": (
        "K85.0 — Idiopathic acute pancreatitis\n"
        "E78.1 — Pure hyperglyceridaemia"
    ),
    "scheme_specific_fields": (
        "Scheme: Private (Health Insurance)\n"
        "Insurance Policy Number: POL-2024-STAR-7654321\n"
        "TPA Name: Star Health & Allied Insurance Co. Ltd\n"
        "Pre-authorisation Reference: PA-STAR-2024-88123\n"
        "Estimated Covered Amount: ₹1,80,000 (subject to policy terms and conditions)"
    ),
}

# ── Complete (Standard Clinical Discharge Summary) ────────────────────────────

_COMPLETE: dict[str, str] = {
    "history_and_examination": (
        "Mr. Vikram Nair, 45-year-old male, presented on 12-Jan-2025 with a 3-day history of "
        "high-grade fever (up to 39.8°C), dry cough, progressive breathlessness, and myalgia. "
        "No haemoptysis. No prior similar episodes. Past medical history: Type 2 Diabetes "
        "Mellitus (on Metformin 500 mg BD) and mild hypertension (on Amlodipine 5 mg OD). "
        "No known drug allergies. Non-smoker, non-alcoholic. Factory worker.\n"
        "Vitals at admission: BP 128/82 mmHg · Pulse 108 bpm (regular) · RR 26 breaths/min "
        "· Temperature 39.2°C · SpO₂ 88% on room air · Weight 72 kg · Height 168 cm.\n"
        "Examination: Mild respiratory distress. Bilateral basal crackles on auscultation. "
        "No wheeze. Heart sounds normal. Abdomen soft. No pedal oedema."
    ),
    "hospital_course": (
        "Patient admitted to the respiratory ward and commenced on supplemental oxygen (4 L/min "
        "via nasal prongs) achieving SpO₂ 94%. RT-PCR SARS-CoV-2 returned positive on "
        "13-Jan-2025. Managed as moderate-severe COVID-19 pneumonia per institutional protocol: "
        "IV Remdesivir initiated on Day 1, oral Dexamethasone 6 mg OD from Day 2. "
        "Blood glucose monitored QID — steroid dysglycemia requiring sliding scale insulin. "
        "CRP 148 mg/L on admission; trended down to 42 mg/L by Day 5. "
        "Oxygen requirement reduced progressively: stepped down to nasal prongs 2 L/min on "
        "Day 4, weaned off supplemental oxygen on Day 6 with SpO₂ 96% on room air. "
        "Repeat HRCT chest (Day 3): bilateral ground-glass opacities 40% involvement. "
        "Patient ambulant, tolerating oral diet, and discharged in stable condition on Day 7 "
        "(18-Jan-2025). Advised home quarantine and incentive spirometry."
    ),
    "investigation_results": (
        "HAEMATOLOGY (12-Jan-2025)\n"
        "Haemoglobin: 13.8 g/dL · WBC: 9,200 cells/μL · Neutrophils: 78% · Lymphocytes: 14% "
        "· Monocytes: 6% · Platelets: 1.86 L/μL · PCV: 41.4%\n\n"
        "BIOCHEMISTRY (12-Jan-2025)\n"
        "Fasting glucose: 214 mg/dL · Serum creatinine: 0.9 mg/dL · Urea: 28 mg/dL "
        "· Na: 136 mEq/L · K: 3.8 mEq/L · AST: 48 U/L · ALT: 52 U/L · ALP: 88 U/L "
        "· Total bilirubin: 0.8 mg/dL · Albumin: 3.6 g/dL\n\n"
        "INFLAMMATORY MARKERS\n"
        "CRP: 148 mg/L (12-Jan) → 86 mg/L (15-Jan) → 42 mg/L (17-Jan)\n"
        "LDH: 520 U/L (12-Jan) · Ferritin: 880 ng/mL (12-Jan) · D-Dimer: 1.2 μg/mL FEU\n\n"
        "SEROLOGY\n"
        "RT-PCR SARS-CoV-2 (nasopharyngeal swab): POSITIVE (13-Jan-2025)\n"
        "COVID-19 IgG: Reactive\n\n"
        "IMAGING\n"
        "Chest X-ray (12-Jan-2025): Bilateral perihilar and lower zone haziness. "
        "No pleural effusion.\n"
        "HRCT Chest (14-Jan-2025): Bilateral multifocal ground-glass opacities predominantly "
        "in lower lobes, 40% lung involvement. No consolidation. CT Severity Score: 12/25."
    ),
    "treatment_summary": (
        "MEDICATIONS DURING ADMISSION\n"
        "Inj Remdesivir 200 mg IV Day 1, then 100 mg IV OD Days 2–5\n"
        "Tab Dexamethasone 6 mg PO OD Days 2–7 (tapering plan given at discharge)\n"
        "Inj Enoxaparin 40 mg SC OD (prophylactic anticoagulation)\n"
        "Tab Metformin 500 mg BD (held on Days 2–3 due to IV contrast; resumed Day 4)\n"
        "Tab Amlodipine 5 mg OD (continued)\n"
        "Sliding scale Actrapid insulin (QID for steroid dysglycemia)\n"
        "Oxygen supplementation: 4 L/min nasal prongs Day 1–3, 2 L/min Days 4–5, weaned Day 6\n"
        "Nebulisation: Ipratropium 0.5 mg + Salbutamol 2.5 mg TDS\n"
        "IV Normal Saline 1 L + 500 mL Ringer's Lactate for hydration (Days 1–2)\n"
        "Tab Pantoprazole 40 mg OD (gastroprotection with steroids)\n\n"
        "PROCEDURES\n"
        "Venepuncture and IV cannulation on admission (12-Jan-2025)\n"
        "RT-PCR nasopharyngeal swab (12-Jan-2025)"
    ),
    "discharge_plan": (
        "DISCHARGE MEDICATIONS\n"
        "Tab Dexamethasone 4 mg OD × 2 days, then 2 mg OD × 2 days, then stop\n"
        "Tab Metformin 500 mg BD (continue indefinitely — resume regular diabetic regimen)\n"
        "Tab Amlodipine 5 mg OD (continue)\n"
        "Tab Pantoprazole 40 mg OD × 14 days (before breakfast)\n"
        "Tab Vitamin C 500 mg OD × 30 days\n"
        "Tab Zinc 50 mg OD × 14 days\n\n"
        "FOLLOW-UP\n"
        "Respiratory Medicine OPD: 01-Feb-2025 (Dr Anand, Room 8)\n"
        "Investigations before follow-up: CBC, CRP, fasting blood glucose, HbA1c, LFT\n"
        "Repeat HRCT chest at 6-week follow-up if symptoms persist.\n\n"
        "DISCHARGE ADVICE\n"
        "Home isolation for 10 days from discharge date.\n"
        "Incentive spirometry: 10 breaths × 5 sets every 2 hours while awake.\n"
        "Ambulate indoors; avoid exertion. Increase activity gradually over 4 weeks.\n"
        "Monitor capillary blood sugar daily — target fasting < 130 mg/dL.\n"
        "Return to ER immediately for: SpO₂ < 93%, chest pain, worsening breathlessness, "
        "fever > 38.5°C persisting beyond Day 3 after discharge."
    ),
}


# ── Public registry ───────────────────────────────────────────────────────────

FEW_SHOT_EXAMPLES: dict[str, dict[str, str]] = {
    "pmjay": _PMJAY,
    "cghs": _CGHS,
    "esi": _ESI,
    "cmchis": _CMCHIS,
    "private": _PRIVATE,
    "complete": _COMPLETE,
}


def get_few_shot_example(scheme_id: str) -> dict[str, str]:
    """
    Return the anonymized few-shot JSON example for the given scheme.
    Falls back to the PM-JAY example for custom/unknown schemes so the
    model always receives a concrete reference output.
    """
    return FEW_SHOT_EXAMPLES.get(scheme_id.lower()) or FEW_SHOT_EXAMPLES["pmjay"]
