import { api } from "@/api/client"

/** Aligns with API; backend may also return ocr_complete, extracting, ocr_failed. */
export type DocumentStatus =
  | "pending"
  | "processing"
  | "ready"
  | "confirmed"
  | "generating"
  | "generated"
  | "approved"
  | "failed"
  | "ocr_complete"
  | "extracting"
  | "ocr_failed"

export interface DocumentResponse {
  id: string
  filename: string
  status: DocumentStatus | string
  pages: number | null
  ocr_confidence: number | null
  created_at: string
  uploaded_by: string
  hospital_id: string
  sha256_hash: string
}

export interface DocumentListResponse {
  documents: DocumentResponse[]
  total: number
  page: number
  per_page: number
}

export interface StatsResponse {
  total_documents: number
  by_status: Record<string, number>
  avg_ocr_confidence: number | null
  uploads_last_7_days: { date: string; count: number }[]
}

export interface FetchDocumentsParams {
  page?: number
  per_page?: number
  status?: string
}

export async function fetchDocuments(
  params: FetchDocumentsParams = {},
): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>("/documents", {
    params: {
      page: params.page ?? 1,
      per_page: params.per_page ?? 20,
      ...(params.status ? { status: params.status } : {}),
    },
  })
  return data
}

export async function fetchDocumentStats(): Promise<StatsResponse> {
  const { data } = await api.get<StatsResponse>("/documents/stats")
  return data
}

/** Fields doctors may PATCH on `/documents/:id/structured` (subset of backend StructuredDataPatch). */
export interface StructuredDataPatch {
  patient_name?: string | null
  age?: string | null
  gender?: string | null
  uhid?: string | null
  abha_id?: string | null
  phone?: string | null
  admission_date?: string | null
  discharge_date?: string | null
  ward?: string | null
  bed_number?: string | null
  primary_diagnosis?: string | null
  secondary_diagnoses?: string[] | null
  presenting_complaints?: string[] | null
  blood_pressure?: string | null
  pulse_rate?: string | null
  temperature?: string | null
  oxygen_saturation?: string | null
  weight?: string | null
  height?: string | null
  investigations?: Record<string, unknown>[] | null
  procedures?: Record<string, unknown>[] | null
  medications_during_stay?: Record<string, unknown>[] | null
  discharge_medications?: Record<string, unknown>[] | null
  follow_up_instructions?: string | null
  follow_up_date?: string | null
  diet_advice?: string | null
  allergies?: string | null
  consultant?: string | null
  surgeon?: string | null
  anesthetist?: string | null
  excluded_fields?: string[] | null
}

export interface StructuredDataResponse {
  document_id: string
  data: Record<string, unknown>
  data_confirmed: boolean
  version: number
  updated_at: string
  excluded_fields: string[]
}

export interface DocumentStatusPayload {
  document_id: string
  status: string
}

/** Canonical lifecycle contract — served by GET /documents/state-machine. */
export interface StateMachineContract {
  states: string[]
  in_flight: string[]
  failure: string[]
  stable: string[]
  editable_structured: string[]
  generatable: string[]
  reprocessable: string[]
  reextractable: string[]
  deprecated: string[]
  poll_interval_ms: number
}

/**
 * Offline fallback used only if /documents/state-machine is unreachable.
 * Must stay in sync with backend/document_states.py IN_FLIGHT.
 */
export const DEFAULT_STATE_MACHINE: StateMachineContract = {
  states: [],
  in_flight: ["processing", "ocr_complete", "extracting", "generating"],
  failure: ["failed", "ocr_failed", "validation_failed"],
  stable: ["ready", "confirmed", "generated", "approved"],
  editable_structured: ["ready", "confirmed"],
  generatable: ["confirmed", "generated"],
  reprocessable: ["ocr_failed", "failed"],
  reextractable: ["ready", "ocr_complete", "failed"],
  deprecated: ["validation_failed"],
  poll_interval_ms: 3000,
}

export async function fetchStateMachine(): Promise<StateMachineContract> {
  const { data } = await api.get<StateMachineContract>(
    "/documents/state-machine",
  )
  return data
}

export interface UploadDocumentResponse {
  document_id: string
  status: string
  duplicate: boolean
}

export interface GenerateDocumentBody {
  scheme_id: string
}

export interface GenerateDocumentResponse {
  document_id: string
  scheme_id: string
  status: string
}

export interface SummaryLatestResponse {
  id: string
  document_id: string
  scheme: string
  status: string
  version: number
  summary_text: string | null
  summary_fields: Record<string, string | null> | null
  validation_notes: Record<string, unknown> | null
  generated_by: string
  approved_by: string | null
  approved_at: string | null
  created_at: string
}

export async function uploadDocument(params: {
  file: File
  patient_name: string
  consent_given: boolean
  consent_method: string
  consent_date?: string | null
  onUploadProgress?: (pct: number) => void
}): Promise<{ data: UploadDocumentResponse; httpStatus: number }> {
  const fd = new FormData()
  fd.append("file", params.file)
  fd.append("patient_name", params.patient_name)
  fd.append("consent_given", params.consent_given ? "true" : "false")
  fd.append("consent_method", params.consent_method)
  if (params.consent_date) {
    fd.append("consent_date", params.consent_date)
  }

  const res = await api.post<UploadDocumentResponse>("/documents/upload", fd, {
    onUploadProgress: (ev) => {
      if (ev.total && params.onUploadProgress) {
        params.onUploadProgress(Math.round((ev.loaded * 100) / ev.total))
      }
    },
  })

  return { data: res.data, httpStatus: res.status }
}

export async function fetchDocument(documentId: string): Promise<DocumentResponse> {
  const { data } = await api.get<DocumentResponse>(`/documents/${documentId}`)
  return data
}

export async function fetchDocumentStatus(
  documentId: string,
): Promise<DocumentStatusPayload> {
  const { data } = await api.get<DocumentStatusPayload>(
    `/documents/${documentId}/status`,
  )
  return data
}

/** Re-run OCR on the stored file (recovery from `ocr_failed`). */
export async function reprocessDocument(
  documentId: string,
): Promise<DocumentStatusPayload> {
  const { data } = await api.post<DocumentStatusPayload>(
    `/documents/${documentId}/reprocess`,
  )
  return data
}

/** Re-run LLM extraction on existing OCR text (recovery from `ready`/`ocr_complete`). */
export async function reextractDocument(
  documentId: string,
): Promise<DocumentStatusPayload> {
  const { data } = await api.post<DocumentStatusPayload>(
    `/documents/${documentId}/reextract`,
  )
  return data
}

export async function fetchStructuredData(
  documentId: string,
): Promise<StructuredDataResponse> {
  const { data } = await api.get<StructuredDataResponse>(
    `/documents/${documentId}/structured`,
  )
  return data
}

export async function patchStructuredData(
  documentId: string,
  patch: StructuredDataPatch,
): Promise<StructuredDataResponse> {
  const { data } = await api.patch<StructuredDataResponse>(
    `/documents/${documentId}/structured`,
    patch,
  )
  return data
}

export async function confirmStructuredData(
  documentId: string,
): Promise<StructuredDataResponse> {
  const { data } = await api.post<StructuredDataResponse>(
    `/documents/${documentId}/structured/confirm`,
  )
  return data
}

export async function generateDocumentSummary(
  documentId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentResponse> {
  const { data } = await api.post<GenerateDocumentResponse>(
    `/documents/${documentId}/generate`,
    body,
  )
  return data
}

export async function fetchLatestSummary(
  documentId: string,
  schemeId?: string | null,
): Promise<SummaryLatestResponse> {
  const { data } = await api.get<SummaryLatestResponse>(
    `/documents/${documentId}/summary/latest`,
    {
      params: schemeId ? { scheme_id: schemeId } : {},
    },
  )
  return data
}

export async function approveLatestSummary(
  documentId: string,
  schemeId?: string | null,
): Promise<SummaryLatestResponse> {
  const { data } = await api.post<SummaryLatestResponse>(
    `/documents/${documentId}/summary/latest/approve`,
    undefined,
    {
      params: schemeId ? { scheme_id: schemeId } : {},
    },
  )
  return data
}

export async function updateSummaryFields(
  documentId: string,
  fields: Record<string, string | null>,
  schemeId?: string | null,
): Promise<SummaryLatestResponse> {
  const { data } = await api.patch<SummaryLatestResponse>(
    `/documents/${documentId}/summary/latest/fields`,
    { fields, ...(schemeId ? { scheme_id: schemeId } : {}) },
  )
  return data
}

export async function downloadLatestSummaryPdf(
  documentId: string,
  schemeId?: string | null,
): Promise<Blob> {
  const { data } = await api.get<Blob>(
    `/documents/${documentId}/summary/latest/pdf`,
    {
      params: schemeId ? { scheme_id: schemeId } : {},
      responseType: "blob",
    },
  )
  return data
}
