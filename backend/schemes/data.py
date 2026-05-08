"""
Built-in scheme definitions for DisGen.

Each scheme carries:
  - DB record fields (id, name, label, color, required_fields, optional_fields,
    rules, pdf_sections, pdf_template, is_builtin)
  - rag_chunks: list of rule-text paragraphs indexed into ChromaDB
    so the generator receives the top-3 most relevant rules for each
    patient's discharge summary.

Sources:
  PM-JAY  : NHA Operation Manual (AB PM-JAY), HBP 2.2 Manual
  CGHS    : CGHS Guidelines 2022 + Handbook June 2023
  ESI     : ESIC Circular + Form 52 requirements
  CMCHIS  : Tamil Nadu Health Dept CMCHIS/Dr.MGR Scheme guidelines
  Private : IRDAI Protocols for Hospitals (Mar 2013) + TPA standards
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class BuiltinScheme:
    id: str
    name: str
    label: str
    color: str                    # hex, e.g. "#1A56DB"
    required_fields: list[dict]   # [{"field": "...", "label": "...", "type": "...", "validation": "..."}]
    optional_fields: list[dict]
    rules: list[str]              # short clinical rules for JSONB storage
    pdf_sections: list[str]       # ordered section names in PDF
    pdf_template: str
    rag_chunks: list[str]         # full-text paragraphs → ChromaDB


# ─────────────────────────────────────────────────────────────────────────────
# PM-JAY  (Pradhan Mantri Jan Arogya Yojana)
# Authority: National Health Authority (NHA), New Delhi
# ─────────────────────────────────────────────────────────────────────────────
PMJAY = BuiltinScheme(
    id="pmjay",
    name="PM-JAY",
    label="Pradhan Mantri Jan Arogya Yojana",
    color="#1A56DB",
    required_fields=[
        {
            "field": "pmjay_beneficiary_id",
            "label": "PMJAY Beneficiary ID",
            "type": "string",
            "validation": r"^\d{9,24}$",
            "hint": "Household ID from SECC / BIS portal (9–24 digits)",
        },
        {
            "field": "pmjay_preauth_number",
            "label": "Pre-Authorization Number",
            "type": "string",
            "validation": r"^[A-Z0-9\-]{6,30}$",
            "hint": "TMS-generated pre-authorization approval number",
        },
        {
            "field": "hbp_package_code",
            "label": "HBP Package Code",
            "type": "string",
            "validation": r"^[A-Z0-9\-]{3,20}$",
            "hint": "Health Benefit Package code from HBP 2.2 manual",
        },
        {
            "field": "hbp_procedure_code",
            "label": "HBP Procedure Code",
            "type": "string",
            "validation": r"^[A-Z0-9\-]{3,20}$",
            "hint": "Procedure code within the HBP package",
        },
    ],
    optional_fields=[
        {
            "field": "pmjay_hid_card_number",
            "label": "Health ID (HID) Card Number",
            "type": "string",
            "hint": "Ayushman Bharat Health Account (ABHA) 14-digit ID",
        },
        {
            "field": "medco_name",
            "label": "Medical Coordinator (MEDCO) Name",
            "type": "string",
            "hint": "Name of the hospital's MEDCO for PM-JAY claims",
        },
        {
            "field": "implants_consumables",
            "label": "Implants / Consumables Used",
            "type": "text",
            "hint": "List each implant/consumable with code, name, quantity, and cost",
        },
        {
            "field": "package_cost_approved",
            "label": "Package Cost Approved (₹)",
            "type": "number",
            "hint": "Pre-authorization approved package cost in INR",
        },
    ],
    rules=[
        "ICD-10 diagnosis codes are mandatory for all primary and secondary diagnoses.",
        "HBP package code and procedure code must exactly match the pre-authorized package.",
        "All implants and consumables must be listed with their individual codes and costs.",
        "Pre-authorization number must be referenced in the discharge summary header.",
        "MEDCO signature is required alongside the treating doctor's signature.",
        "Claim must be initiated within 7 days of patient discharge via TMS portal.",
        "Summary must cover all 10 mandatory sections including course in hospital.",
        "Lab investigations and imaging reports must be referenced with dates.",
    ],
    pdf_sections=[
        "Patient Information & PMJAY Identifiers",
        "Admission and Discharge Details",
        "Primary and Secondary Diagnosis (with ICD-10 codes)",
        "Clinical Assessment at Admission",
        "Laboratory and Investigation Results",
        "Treatment During Hospital Stay",
        "Procedures Performed (with HBP Package & Procedure Codes)",
        "Implants and Consumables",
        "Discharge Medications",
        "Follow-up Instructions",
    ],
    pdf_template="pmjay.html",
    rag_chunks=[
        (
            "PM-JAY Beneficiary Identification: Every PM-JAY discharge summary must include "
            "the beneficiary's PMJAY Household ID from the SECC database, verified through the "
            "Beneficiary Identification System (BIS) at bis.pmjay.gov.in. The Ayushman Bharat "
            "Health Account (ABHA) 14-digit ID should be recorded if available. These identifiers "
            "must appear prominently in the discharge summary header alongside the patient's name, "
            "age, and gender."
        ),
        (
            "PM-JAY Pre-Authorization Documentation: The pre-authorization number issued by the "
            "State Health Agency (SHA) or Insurance Company through the Transaction Management "
            "System (TMS) must be cited in the discharge summary. The authorized Health Benefit "
            "Package (HBP 2.2) package code and the specific procedure code must exactly match "
            "the approved procedure. Any deviation from the pre-authorized package requires a "
            "modification request before discharge. The approved package cost in INR must be noted."
        ),
        (
            "PM-JAY Clinical Documentation Requirements: The discharge summary must contain all "
            "10 mandatory sections: (1) Patient Information with PMJAY identifiers, (2) Admission "
            "and Discharge Details with exact date-times, (3) Primary Diagnosis with ICD-10 code, "
            "(4) Secondary Diagnoses with ICD-10 codes, (5) Clinical Assessment at admission including "
            "vitals, (6) Key Laboratory and Investigation Results with dates, (7) Treatment during "
            "hospital stay including all medications with doses and dates, (8) Procedures performed "
            "with HBP codes, (9) Discharge Medications with dosage and duration, "
            "(10) Follow-up instructions with next appointment date."
        ),
        (
            "PM-JAY Implants and Consumables: All implants, prosthetics, and high-value consumables "
            "used during the procedure must be listed individually in the discharge summary. Each item "
            "must include: NHA-approved item code, generic/brand name, quantity used, unit cost, and "
            "total cost. Only NHA-approved implant codes are reimbursable. The total implant cost is "
            "separate from the package cost and must be claimed under the appropriate HBP implant code."
        ),
        (
            "PM-JAY Signature and Claim Submission: The discharge summary requires two signatures: "
            "the treating consultant doctor (with name, qualification, and registration number) and "
            "the hospital's Medical Coordinator (MEDCO). The hospital seal must be affixed. Claims "
            "must be submitted through the TMS portal within 7 days of patient discharge. Pre-final "
            "and final pre-authorization requests for residual amounts must be submitted via TMS "
            "before initiating the final claim. Incomplete documentation leads to claim rejection."
        ),
        (
            "PM-JAY ICD-10 Coding Requirements: Primary and secondary diagnoses must be coded using "
            "ICD-10-CM codes. The ICD-10 code for the primary diagnosis must align with the HBP "
            "package code selected. Procedure codes from ICD-10-PCS or HBP procedure code list must "
            "match the surgical or medical intervention performed. Coders must verify code-to-package "
            "alignment before finalizing the discharge summary to avoid claim rejection at the SHA."
        ),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# CGHS  (Central Government Health Scheme)
# Authority: Ministry of Health & Family Welfare, Government of India
# ─────────────────────────────────────────────────────────────────────────────
CGHS = BuiltinScheme(
    id="cghs",
    name="CGHS",
    label="Central Government Health Scheme",
    color="#0E9F6E",
    required_fields=[
        {
            "field": "cghs_card_number",
            "label": "CGHS Beneficiary Card Number",
            "type": "string",
            "validation": r"^[0-9]{6,12}$",
            "hint": "Numeric CGHS identity card number of the beneficiary",
        },
        {
            "field": "employee_id",
            "label": "Employee / Pensioner Code",
            "type": "string",
            "validation": r"^[A-Z0-9]{4,15}$",
            "hint": "Central government employee or pensioner code",
        },
        {
            "field": "ward_entitlement",
            "label": "Ward Entitlement",
            "type": "select",
            "options": ["General", "Semi-Private", "Private"],
            "hint": "Based on pay grade: General (Group D), Semi-Private (Group B/C), Private (Group A)",
        },
    ],
    optional_fields=[
        {
            "field": "referral_letter_number",
            "label": "Referral Letter Number",
            "type": "string",
            "hint": "CGHS Wellness Centre referral letter number (required for speciality treatment)",
        },
        {
            "field": "cghs_empanelment_number",
            "label": "Hospital CGHS Empanelment Number",
            "type": "string",
            "hint": "Hospital's CGHS empanelment reference number",
        },
        {
            "field": "treating_specialty",
            "label": "Treating Specialty",
            "type": "string",
            "hint": "Medical specialty under which treatment was provided",
        },
    ],
    rules=[
        "Ward entitlement is pay-grade based: General (Group D), Semi-Private (Group B/C), Private (Group A/PB-3+).",
        "Referral letter is mandatory for specialist consultation and inpatient treatment.",
        "All medicines prescribed must be from the CGHS formulary; non-formulary drugs require justification.",
        "Discharge summary must list all investigations with dates and results.",
        "CGHS-approved rate schedule rates must be referenced for all procedures.",
        "Original discharge summary copy must accompany the reimbursement claim.",
        "Reimbursement claims must be submitted to the CGHS Wellness Centre within the stipulated period.",
    ],
    pdf_sections=[
        "Patient Information & CGHS Details",
        "Admission and Discharge Details",
        "Referral Information",
        "Primary and Secondary Diagnosis (with ICD-10 codes)",
        "Clinical Assessment",
        "Laboratory and Investigation Results",
        "Treatment During Hospital Stay",
        "Ward/Room Category Details",
        "Discharge Medications (from CGHS Formulary)",
        "Follow-up Instructions",
    ],
    pdf_template="cghs.html",
    rag_chunks=[
        (
            "CGHS Beneficiary Identification: The discharge summary must include the CGHS beneficiary "
            "card number, the central government employee or pensioner code, and the beneficiary's "
            "relationship to the card holder (self/spouse/dependent). The ward entitlement must be "
            "documented based on the employee's pay grade: General Ward for Group D employees, "
            "Semi-Private for Group B and C, and Private Ward for Group A and above (PB-3+). "
            "Occupation of a higher-category ward than entitled requires the patient to bear the "
            "difference in room charges."
        ),
        (
            "CGHS Referral and Treatment Authorization: For speciality outpatient consultations and "
            "all inpatient admissions at CGHS-empanelled private hospitals, a valid referral letter "
            "from the CGHS Wellness Centre is mandatory. The referral letter number must be recorded "
            "in the discharge summary. Referrals are valid for one month and cover all related "
            "consultations, investigations, surgeries, chemotherapy, and radiotherapy within that "
            "period. Emergency admissions without prior referral are permitted but must be reported "
            "to the nearest CGHS Wellness Centre within 24 hours."
        ),
        (
            "CGHS Formulary and Medicine Documentation: All medicines administered during the hospital "
            "stay and prescribed at discharge must be individually listed with generic name, brand name, "
            "dose, frequency, and duration. Medicines must preferably be from the CGHS formulary. "
            "Non-formulary medicines require the treating doctor to provide written clinical justification. "
            "Generic prescribing is encouraged under CGHS. All investigation reports, pathology, and "
            "imaging results must be listed with dates and interpreted in the clinical summary."
        ),
        (
            "CGHS Rate Schedule and Billing Compliance: All procedures, investigations, and room charges "
            "must be billed at CGHS-approved rates. The discharge summary must reference the CGHS rate "
            "schedule code for each billable item. Overcharging beyond CGHS approved rates is not "
            "reimbursable. Itemized billing is mandatory. The hospital's CGHS empanelment number must "
            "appear on the discharge summary and all billing documents submitted for reimbursement."
        ),
        (
            "CGHS Reimbursement Claim Documentation: For reimbursement claims, the original discharge "
            "summary must be submitted along with: all original hospital bills and receipts, complete "
            "list of medicines with purchase receipts, all diagnostic and laboratory reports, referral "
            "letter (original + 2 copies), CGHS card details, and the signed reimbursement claim form. "
            "Claims must be submitted to the CGHS Wellness Centre within the time limit specified in "
            "CGHS guidelines (typically 3 months from discharge date)."
        ),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# ESI  (Employees' State Insurance Scheme)
# Authority: Employees' State Insurance Corporation (ESIC)
# ─────────────────────────────────────────────────────────────────────────────
ESI = BuiltinScheme(
    id="esi",
    name="ESI",
    label="Employees' State Insurance Scheme",
    color="#C27803",
    required_fields=[
        {
            "field": "esi_ip_number",
            "label": "ESI IP Number",
            "type": "string",
            "validation": r"^\d{10}$",
            "hint": "10-digit Insurance Person number (unique to the insured, does not change with job change)",
        },
        {
            "field": "esi_dispensary_code",
            "label": "ESI Dispensary / Branch Office Code",
            "type": "string",
            "validation": r"^\d{4,8}$",
            "hint": "Code of the ESIC dispensary or branch office linked to the insured person",
        },
    ],
    optional_fields=[
        {
            "field": "employer_code",
            "label": "Employer Registration Code",
            "type": "string",
            "hint": "ESIC employer code of the insured person's establishment",
        },
        {
            "field": "insurance_period",
            "label": "Insurance Period",
            "type": "string",
            "hint": "Active insurance contribution period (e.g., April 2025 – September 2025)",
        },
        {
            "field": "esi_form_52_reference",
            "label": "Form 52 Reference / Claim Number",
            "type": "string",
            "hint": "Medical Expense Reimbursement Claim Form 52 reference number",
        },
        {
            "field": "relationship_to_insured",
            "label": "Patient's Relationship to Insured",
            "type": "select",
            "options": ["Self", "Spouse", "Child", "Dependent Parent"],
            "hint": "Required if patient is a family dependent of the insured person",
        },
    ],
    rules=[
        "ESI IP number is 10 digits; verify via ESIC portal before claim.",
        "Reimbursement claims must be submitted on Form 52 within 15 days of discharge.",
        "All original bills, receipts, and discharge summary must be submitted with Form 52.",
        "Treatment at non-ESIC empanelled hospitals is reimbursable only in emergencies or with prior permission.",
        "Insurance period validity determines entitlement; verify contribution status before admission.",
        "Discharge summary must include duration of hospital stay and all procedures performed.",
        "Dependents (spouse, children, parents) are entitled to ESI medical benefits.",
    ],
    pdf_sections=[
        "Patient Information & ESI Details",
        "Admission and Discharge Details",
        "Primary and Secondary Diagnosis (with ICD-10 codes)",
        "Clinical Assessment",
        "Laboratory and Investigation Results",
        "Treatment During Hospital Stay",
        "Procedures Performed",
        "Discharge Medications",
        "Follow-up Instructions",
        "Form 52 Reimbursement Reference",
    ],
    pdf_template="esi.html",
    rag_chunks=[
        (
            "ESI Beneficiary Identification: The discharge summary must prominently record the "
            "Insurance Person (IP) number — a unique 10-digit identifier assigned to every ESI-insured "
            "worker. The IP number structure: first 2 digits represent the ESIC regional office code, "
            "digits 3–4 represent the sub-regional or branch office code, and digits 5–10 are the "
            "sequential insured person identifier. The IP number does not change when the insured changes "
            "employers. The ESI dispensary or branch office code must also be documented."
        ),
        (
            "ESI Insurance Period and Entitlement: ESI benefits are contribution-based with contribution "
            "periods running April–September and October–March each year. The corresponding benefit period "
            "runs six months later. Inpatient medical care entitlement must be confirmed against the "
            "active contribution period. If the patient is a dependent (spouse, children under 25, "
            "dependent parents), their relationship to the insured must be documented in the discharge "
            "summary. Family members of ESI insured persons are fully entitled to medical benefits."
        ),
        (
            "ESI Reimbursement Claim Process (Form 52): For treatment at non-ESIC hospitals, the "
            "insured must file Form 52 (Medical Expense Reimbursement Claim) within 15 days of discharge. "
            "The discharge summary must be submitted as an original copy with Form 52. Supporting "
            "documents required: all original hospital bills (operation, doctors, anesthetist, nursing, "
            "room, ICU, medicines, diagnostic tests), itemized prescriptions, investigation reports, "
            "payment receipts, and the employer's certificate of employment and contribution. "
            "Incomplete submissions lead to claim delays."
        ),
        (
            "ESI Clinical Documentation Standards: The ESI discharge summary must include: complete "
            "inpatient diagnosis with ICD-10 codes, all procedures performed with dates, complete "
            "medication list during hospitalization with generic names and doses, all investigations "
            "with results and dates, and detailed course of treatment. The duration of hospital stay "
            "must be precisely stated with admission and discharge date-times. Post-discharge medications "
            "must be listed with generic names, dosage, frequency, and duration of treatment."
        ),
        (
            "ESI Emergency Admission at Non-Empanelled Hospital: When emergency admission occurs at "
            "a non-ESIC empanelled hospital, the nearest ESIC office or hospital must be informed "
            "within 24 hours. The discharge summary must clearly document the emergency nature of "
            "the admission. Reimbursement for emergency treatment is processed through the ESIC "
            "branch office on Form 52. The treating doctor's certificate confirming the emergency "
            "condition must accompany the claim. ESIC reimburses at rates applicable to comparable "
            "ESIC hospital treatment."
        ),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# CMCHIS  (Chief Minister's Comprehensive Health Insurance Scheme, Tamil Nadu)
# Also known as: Dr. MGR Government Health Insurance Scheme
# Authority: Tamil Nadu Government, Dept. of Health & Family Welfare
# ─────────────────────────────────────────────────────────────────────────────
CMCHIS = BuiltinScheme(
    id="cmchis",
    name="CMCHIS",
    label="Chief Minister's Comprehensive Health Insurance Scheme (Tamil Nadu)",
    color="#7E3AF2",
    required_fields=[
        {
            "field": "cmchis_card_number",
            "label": "CMCHIS Smart Health Card Number",
            "type": "string",
            "validation": r"^[A-Z0-9]{8,20}$",
            "hint": "Smart Health Card number issued under CMCHIS / Dr. MGR scheme",
        },
        {
            "field": "cmchis_package_code",
            "label": "CMCHIS Package Code",
            "type": "string",
            "validation": r"^[A-Z0-9\-]{3,20}$",
            "hint": "Procedure package code from the CMCHIS approved package list",
        },
    ],
    optional_fields=[
        {
            "field": "cmchis_package_name",
            "label": "Package Name",
            "type": "string",
            "hint": "Name of the treatment package under CMCHIS",
        },
        {
            "field": "coverage_amount_sanctioned",
            "label": "Coverage Amount Sanctioned (₹)",
            "type": "number",
            "hint": "Amount sanctioned for this treatment episode (max ₹5 lakh per family per year)",
        },
        {
            "field": "hospital_empanelment_code",
            "label": "Hospital Empanelment Code",
            "type": "string",
            "hint": "TN Health Dept empanelment code for this hospital under CMCHIS",
        },
        {
            "field": "preauth_number",
            "label": "Pre-Authorization Number",
            "type": "string",
            "hint": "CMCHIS pre-authorization approval number",
        },
        {
            "field": "annual_benefit_used",
            "label": "Annual Benefit Already Used (₹)",
            "type": "number",
            "hint": "Amount already utilized from the ₹5 lakh annual family limit",
        },
    ],
    rules=[
        "CMCHIS covers government employees, their families, and below-poverty-line families in Tamil Nadu.",
        "Annual coverage limit: ₹5 lakh per family per year across all included procedures.",
        "Only procedures from the approved CMCHIS package list are reimbursable.",
        "Hospital empanelment under CMCHIS is mandatory; treatment at non-empanelled hospitals is not covered.",
        "Pre-authorization is required for elective procedures before admission.",
        "Discharge summary must reference the exact CMCHIS package code approved.",
        "Smart Health Card (SHC) must be swiped at the hospital kiosk for cashless processing.",
        "ICD-10 diagnosis codes must be aligned with the approved package code.",
    ],
    pdf_sections=[
        "Patient Information & CMCHIS Details",
        "Admission and Discharge Details",
        "Primary and Secondary Diagnosis (with ICD-10 codes)",
        "Clinical Assessment",
        "Laboratory and Investigation Results",
        "Treatment During Hospital Stay",
        "Procedure Performed (with CMCHIS Package Code)",
        "Coverage and Benefit Details",
        "Discharge Medications",
        "Follow-up Instructions",
    ],
    pdf_template="cmchis.html",
    rag_chunks=[
        (
            "CMCHIS Beneficiary Identification: The Chief Minister's Comprehensive Health Insurance Scheme "
            "(also known as the Dr. MGR Government Health Insurance Scheme) covers Tamil Nadu government "
            "employees and their families, unorganised sector workers, and families holding ration cards. "
            "The Smart Health Card (SHC) number is the primary identifier and must be recorded in the "
            "discharge summary header. The card must be verified at the hospital kiosk terminal at the "
            "time of admission for cashless processing. Annual coverage is ₹5 lakh per family."
        ),
        (
            "CMCHIS Package Code and Pre-Authorization: Only procedures included in the CMCHIS approved "
            "package list are reimbursable. Each package has a specific package code that must be cited "
            "in the discharge summary. For elective procedures, pre-authorization from the scheme "
            "administrator is mandatory before admission. Emergency admissions may proceed without "
            "prior authorization but must be reported immediately. The pre-authorization number and "
            "approved package cost must be documented in the discharge summary."
        ),
        (
            "CMCHIS Clinical Documentation Requirements: The discharge summary must document: CMCHIS "
            "smart card number, patient name and relationship to cardholder, CMCHIS package code and "
            "package name, ICD-10 diagnosis codes aligned with the approved package, all procedures "
            "performed with dates, investigations and results with dates, medications during stay with "
            "generic names and doses, and discharge medications. The annual benefit already utilized "
            "and the amount sanctioned for this episode must be recorded."
        ),
        (
            "CMCHIS Coverage Rules and Limits: The scheme provides cashless treatment at empanelled "
            "hospitals. Annual benefit limit is ₹5 lakh per family across all episodes in a year. "
            "For cancer treatment, there is an enhanced limit. Certain high-cost procedures have "
            "individual sub-limits within the annual cap. The discharge summary must specify the "
            "package cost approved, any co-payment required from the patient, and the residual "
            "annual benefit remaining. Costs exceeding approved package rates are borne by the patient."
        ),
        (
            "CMCHIS Empanelled Hospital Requirements: Treatment at non-CMCHIS empanelled hospitals "
            "is not covered except in genuine emergencies. The hospital's CMCHIS empanelment code "
            "must appear on the discharge summary and billing documents. The treating doctor must "
            "be on the empanelled hospital's specialist panel. The discharge summary must include "
            "the doctor's name, qualification, MCI/TN Medical Council registration number, and "
            "signature with hospital stamp. Claims not meeting empanelment criteria are rejected."
        ),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# Private Insurance (TPA-based)
# Authority: IRDAI (Insurance Regulatory and Development Authority of India)
# Reference: IRDA Protocols for Hospitals (18 March 2013), TPA standards
# ─────────────────────────────────────────────────────────────────────────────
PRIVATE = BuiltinScheme(
    id="private",
    name="Private",
    label="Private Health Insurance (TPA)",
    color="#E3A008",
    required_fields=[
        {
            "field": "policy_number",
            "label": "Insurance Policy Number",
            "type": "string",
            "validation": r"^[A-Z0-9\-\/]{6,20}$",
            "hint": "Policy number from the insurance certificate (format varies by insurer)",
        },
        {
            "field": "tpa_name",
            "label": "TPA / Insurance Company Name",
            "type": "string",
            "hint": "e.g., Star Health, HDFC ERGO, Niva Bupa, Medi Assist, Paramount TPA",
        },
        {
            "field": "preauth_reference_number",
            "label": "Pre-Authorization Reference Number",
            "type": "string",
            "hint": "TPA-issued pre-authorization / cashless authorization number",
        },
    ],
    optional_fields=[
        {
            "field": "member_id",
            "label": "Member ID / Insured Person ID",
            "type": "string",
            "hint": "Member ID from the insurance card",
        },
        {
            "field": "room_category_eligible",
            "label": "Eligible Room Category (as per policy)",
            "type": "select",
            "options": ["General Ward", "Semi-Private", "Private", "Deluxe", "Suite"],
            "hint": "Room category covered under the policy",
        },
        {
            "field": "room_category_occupied",
            "label": "Actual Room Category Occupied",
            "type": "select",
            "options": ["General Ward", "Semi-Private", "Private", "Deluxe", "Suite", "ICU", "HDU"],
            "hint": "Actual room/ward in which patient was admitted",
        },
        {
            "field": "sum_insured",
            "label": "Sum Insured (₹)",
            "type": "number",
            "hint": "Total sum insured under the policy",
        },
        {
            "field": "preauth_approved_amount",
            "label": "Pre-Auth Approved Amount (₹)",
            "type": "number",
            "hint": "Initial cashless approval amount from TPA",
        },
        {
            "field": "copay_percentage",
            "label": "Co-payment Percentage (%)",
            "type": "number",
            "hint": "Patient co-payment percentage as per policy terms (if applicable)",
        },
    ],
    rules=[
        "ICD-10 diagnosis codes are mandatory for all diagnoses in insurance discharge summaries.",
        "Room category must be documented; occupying a higher category than eligible triggers pro-rata deduction.",
        "Pre-authorization reference number must appear in the discharge summary header.",
        "Itemized billing is mandatory; lump-sum billing is not accepted by TPAs.",
        "Final pre-auth request for residual amount must be submitted to TPA before discharge.",
        "Discharge summary is the primary document for claim admissibility determination.",
        "All investigation reports must be included with the claim submission.",
        "Pre-existing condition disclosure and waiting period compliance must be ensured.",
    ],
    pdf_sections=[
        "Patient Information & Insurance Details",
        "TPA / Policy Details",
        "Admission and Discharge Details",
        "Primary and Secondary Diagnosis (with ICD-10 codes)",
        "Clinical Assessment",
        "Laboratory and Investigation Results",
        "Treatment During Hospital Stay",
        "Room Category and Billing Details",
        "Discharge Medications",
        "Follow-up Instructions",
    ],
    pdf_template="private.html",
    rag_chunks=[
        (
            "Private Insurance Policy Identification: The discharge summary must include the insurance "
            "policy number exactly as printed on the insurance certificate, the TPA or insurance company "
            "name, the member ID of the insured person, and the pre-authorization reference number issued "
            "by the TPA. If the patient is a dependent of the primary insured, document the relationship "
            "and the primary member's name and policy number. The sum insured and remaining balance must "
            "be verified with the TPA at the time of admission."
        ),
        (
            "TPA Pre-Authorization Documentation: Cashless treatment requires prior pre-authorization "
            "from the TPA. The initial pre-authorization number, the approved amount, and the scope of "
            "approved treatment must be documented. For any change in diagnosis or additional procedures "
            "during hospitalization, a modification to the pre-authorization must be sought. A final "
            "pre-authorization request for the residual amount must be submitted to the TPA before "
            "patient discharge. The discharge summary must cite all pre-authorization reference numbers."
        ),
        (
            "Room Category and Pro-Rata Billing Rule: The discharge summary must document both the "
            "room category eligible under the policy and the actual room category occupied. If the "
            "patient occupied a room of higher category than entitled, IRDAI regulations require "
            "pro-rata adjustment of all associated medical expenses (doctor fees, nursing charges, "
            "investigations, procedures) in proportion to the eligible room tariff versus actual "
            "room tariff. This pro-rata rule must be factored into the final billing and clearly "
            "stated in the discharge summary and itemized bill."
        ),
        (
            "Private Insurance Clinical Documentation: The discharge summary is the most critical "
            "document determining claim admissibility. It must contain: complete diagnosis with ICD-10 "
            "codes, all procedures with surgical notes reference, implants with make and cost, all "
            "investigations with dates and results, complete medication list with generic names, "
            "and discharge medication with duration. The attending doctor's name, qualification, "
            "MCI registration number, and signature with hospital stamp are mandatory. "
            "Discharge summaries with missing sections lead to claim queries and delays."
        ),
        (
            "Cashless vs Reimbursement Claim Submission: For cashless claims, the hospital submits "
            "the claim directly to the TPA with the discharge summary, itemized bill, and all "
            "investigation reports at the time of discharge. For reimbursement claims, the patient "
            "pays the hospital and submits original documents (discharge summary, all original bills "
            "and receipts, prescription slips, investigation reports, pharmacy bills) to the TPA "
            "or insurer within 15–30 days of discharge (as per policy terms). ICD-10 codes must "
            "match across all submitted documents for consistent claim processing."
        ),
        (
            "Pre-existing Conditions and Exclusions: The discharge summary must accurately document "
            "the date of onset of symptoms and first consultation for the presenting condition. "
            "Pre-existing conditions are subject to waiting periods as per IRDAI regulations "
            "(typically 2–4 years). If the condition is potentially pre-existing, the treating "
            "doctor's note on the clinical timeline is critical for claim assessment. Procedures "
            "that are permanently or temporarily excluded under the policy (cosmetic surgery, "
            "dental, refractive errors, etc.) must be identified and separated from the claim."
        ),
    ],
)


# ─────────────────────────────────────────────────────────────────────────────
# COMPLETE  (Standard clinical discharge summary — no insurance scheme)
# Generates a full, detailed discharge summary from all structured fields.
# Each field is a clinical narrative section written by the LLM.
# ─────────────────────────────────────────────────────────────────────────────
COMPLETE = BuiltinScheme(
    id="complete",
    name="Complete",
    label="Complete Clinical Discharge Summary",
    color="#374151",
    required_fields=[
        {
            "field": "history_and_examination",
            "label": "History & Examination",
            "type": "text",
            "hint": (
                "Write a comprehensive clinical paragraph covering: chief complaints, "
                "duration and character of symptoms, relevant past medical and surgical history, "
                "family and social history, and examination findings at admission including "
                "all vitals (BP, pulse, RR, temperature, SpO₂, weight, height)."
            ),
        },
        {
            "field": "hospital_course",
            "label": "Hospital Course",
            "type": "text",
            "hint": (
                "Write a detailed clinical narrative of events during admission: "
                "initial management, treatment response, significant clinical changes, "
                "complications if any, turning points, and the patient's condition at discharge. "
                "Include dates and clinician decisions where documented."
            ),
        },
        {
            "field": "investigation_results",
            "label": "Investigations & Results",
            "type": "text",
            "hint": (
                "List ALL investigations with their results and dates: "
                "complete blood count (each parameter), biochemistry panel, coagulation, "
                "cultures, cardiac markers, hormones, serology, urine analysis, "
                "imaging findings (X-ray, CT, MRI, Echo), and any special tests. "
                "Format as: Test Name: Value Unit (Date). One test per line."
            ),
        },
        {
            "field": "treatment_summary",
            "label": "Treatment During Stay",
            "type": "text",
            "hint": (
                "List all medications administered during admission: name, dose, route, "
                "frequency, and duration for each. Then list all procedures and surgeries "
                "performed with date and operating surgeon. Be complete — include IV fluids, "
                "oxygen therapy, nebulisations, and any therapeutic interventions."
            ),
        },
        {
            "field": "discharge_plan",
            "label": "Discharge Plan & Advice",
            "type": "text",
            "hint": (
                "Write the complete discharge plan: (1) Discharge medications — each with "
                "name, dose, frequency, duration, and special instructions. "
                "(2) Follow-up appointment — date, department, and investigations required. "
                "(3) Discharge advice — activity restrictions, diet instructions, wound care, "
                "warning symptoms that require immediate review. Be specific and complete."
            ),
        },
    ],
    optional_fields=[
        {
            "field": "operative_details",
            "label": "Operative Details",
            "type": "text",
            "hint": (
                "For surgical cases: operative approach, intraoperative findings, "
                "anastomosis technique, implants or stents used with specifications, "
                "estimated blood loss, and any intraoperative events."
            ),
        },
        {
            "field": "post_operative_course",
            "label": "Post-Operative Course",
            "type": "text",
            "hint": (
                "Day-by-day recovery: vital signs trend, drain output, wound status, "
                "diet progression, mobility, and any post-operative complications managed."
            ),
        },
        {
            "field": "donor_information",
            "label": "Donor Information",
            "type": "text",
            "hint": (
                "For transplant cases: donor name, age, gender, blood group, relation to "
                "recipient, IP number, and HLA/crossmatch compatibility summary."
            ),
        },
    ],
    rules=[
        "All structured clinical data must be used — do not omit any documented finding.",
        "Each section must be written as complete, formal clinical English.",
        "Investigations must list every test — never summarise or group results.",
        "Medications must include dose, route, frequency, and duration.",
        "Discharge plan must be self-contained and actionable for the patient.",
        "Dates in DD-Mon-YYYY format. Vitals must include units.",
        "Write 'Not documented.' only when the data field is genuinely absent.",
        "This summary is a medicolegal document — accuracy and completeness are mandatory.",
    ],
    pdf_sections=[
        "Patient Information",
        "Admission and Discharge Details",
        "Diagnosis",
        "History & Examination",
        "Hospital Course",
        "Investigations & Results",
        "Treatment During Stay",
        "Discharge Plan & Advice",
        "Operative Details (if applicable)",
        "Post-Operative Course (if applicable)",
    ],
    pdf_template="complete.html",
    rag_chunks=[
        (
            "Complete Discharge Summary — Clinical Completeness: A complete clinical discharge "
            "summary must document every aspect of the hospital episode without omission. "
            "The summary serves as a medicolegal record, a continuity-of-care document for "
            "outpatient providers, and a patient reference. All investigations must be listed "
            "individually with values, units, reference ranges where available, and dates. "
            "Never summarise or group results — each parameter of the CBC, each biochemistry "
            "value, and each imaging finding must appear separately."
        ),
        (
            "Complete Discharge Summary — Clinical Narrative Standards: The hospital course "
            "section must read as a chronological clinical narrative: onset of symptoms, "
            "examination findings, differential diagnosis considered, investigations ordered and "
            "their clinical impact, treatment decisions with rationale, response to treatment, "
            "complications encountered and managed, and condition at discharge. The narrative "
            "must be specific — name medications with doses, state dates of key events, "
            "and reference investigation results that changed management."
        ),
        (
            "Complete Discharge Summary — Discharge Plan Requirements: The discharge plan must "
            "be specific enough for both the patient and the receiving outpatient doctor to act on "
            "without further clarification. Discharge medications must state: generic name, brand "
            "name where relevant, dose (with units), route, frequency using standard abbreviations "
            "(OD/BD/TDS/QID), total duration, and any special instructions (take with food, "
            "avoid sunlight, etc.). Follow-up instructions must name the clinic and specialist, "
            "give a specific date or time frame, and list investigations to be done before the visit."
        ),
        (
            "Complete Discharge Summary — Vital Signs and Clinical Assessment: Vitals documented "
            "at admission establish the clinical severity and must be included in full: "
            "blood pressure (systolic/diastolic in mmHg), pulse rate (bpm with rhythm if noted), "
            "respiratory rate (breaths/min), temperature (°C or °F), SpO₂ (% with O₂ delivery "
            "method if applicable), height (cm), and weight (kg). For ICU or surgical patients, "
            "the post-operative vitals trend must be documented day by day in the post-operative "
            "course section."
        ),
        (
            "Complete Discharge Summary — Medicolegal and Continuity Standards: The complete "
            "discharge summary is a primary medicolegal document. It must be factually accurate, "
            "use standard medical terminology, include ICD-10 codes for all diagnoses, and be "
            "free from ambiguity. The treating consultant's name, qualification, and registration "
            "number must appear. For surgical cases, the operating surgeon and anaesthetist must "
            "be named. For transplant cases, full donor information including blood group and "
            "HLA compatibility must be documented. The summary must be completed before or at "
            "the time of discharge — never reconstructed retrospectively from memory."
        ),
    ],
)


# ── Master list — order determines DB seeding order ──────────────────────────
ALL_SCHEMES: list[BuiltinScheme] = [PMJAY, CGHS, ESI, CMCHIS, PRIVATE, COMPLETE]
