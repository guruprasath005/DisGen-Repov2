import type { AxiosProgressEvent } from "axios"

import { api, getMemoryAccessToken } from "./client"

export interface DocumentDto {
  id: string
  filename: string
  patient_name?: string | null
  status: string
  pages: number | null
  ocr_confidence: number | null
  created_at: string
  uploaded_by: string
  hospital_id: string
  sha256_hash: string
}

export interface DocumentListResponse {
  documents: DocumentDto[]
  total: number
  page: number
  per_page: number
}

export interface Icd10Entry {
  code: string
  description: string
}

export interface Medication {
  name: string
  dose?: string | null
  route?: string | null
  frequency?: string | null
  duration?: string | null
  normalized?: boolean
}

export interface Investigation {
  name: string
  result?: string | null
  unit?: string | null
  normal_range?: string | null
  date?: string | null
}

export interface Vitals {
  bp?: string | null
  pulse?: string | null
  temp?: string | null
  spo2?: string | null
  weight?: string | null
  height?: string | null
}

export interface StructuredDataDto {
  patient_name: string | null
  patient_age: string | null
  patient_gender: string | null
  uhid: string | null
  abha_id: string | null
  phone: string | null
  admission_date: string | null
  discharge_date: string | null
  ward: string | null
  bed_number: string | null
  hospital_name: string | null
  referring_doctor: string | null
  treating_doctor: string | null
  chief_complaint: string | null
  history: string | null
  clinical_summary: string | null
  icd10_primary: Icd10Entry | null
  icd10_secondary: Icd10Entry[]
  diagnoses: string[]
  medications: Medication[]
  vitals: Vitals | null
  investigations: Investigation[]
  procedures: string[]
  allergies: string[]
  comorbidities: string[]
  data_confirmed: boolean
  version: number
}

export interface SummaryDto {
  id: string
  scheme: string
  summary_text: string
  status: string
  validation_notes: Record<string, unknown> | null
  generated_by: string | null
  approved_by: string | null
  approved_at: string | null
  version: number
  created_at: string
}

export interface DocumentsStats {
  total: number
  pending: number
  processing: number
  approved: number
}

interface StatsApiResponse {
  total_documents: number
  by_status: Record<string, number>
  avg_ocr_confidence: number | null
  uploads_last_7_days: { date: string; count: number }[]
}

const PROCESSING_STATUSES = new Set([
  "processing",
  "ocr_complete",
  "extracting",
  "generating",
])

export async function fetchStats(): Promise<DocumentsStats> {
  const token = getMemoryAccessToken()
  const { data } = await api.get<StatsApiResponse>("/documents/stats", {
    ...(token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : {}),
  })
  const by = data.by_status ?? {}
  const processing = Object.entries(by)
    .filter(([s]) => PROCESSING_STATUSES.has(s))
    .reduce((sum, [, n]) => sum + n, 0)
  return {
    total: data.total_documents ?? 0,
    pending: by["pending"] ?? 0,
    processing,
    approved: by["approved"] ?? 0,
  }
}

export async function approveDocument(documentId: string): Promise<void> {
  const token = getMemoryAccessToken()
  await api.post(
    `/documents/${documentId}/approve`,
    undefined,
    {
      ...(token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    },
  )
}

interface StructuredDataApiResponse {
  document_id: string
  data: Record<string, unknown>
  data_confirmed: boolean
  version: number
  updated_at: string
  excluded_fields: string[]
}

function unwrapStructured(res: StructuredDataApiResponse): StructuredDataDto {
  return {
    ...(res.data as Omit<StructuredDataDto, "data_confirmed" | "version">),
    data_confirmed: res.data_confirmed,
    version: res.version,
  }
}

export async function patchStructuredData(
  documentId: string,
  body: Partial<StructuredDataDto>,
): Promise<StructuredDataDto> {
  const token = getMemoryAccessToken()
  const { data } = await api.patch<StructuredDataApiResponse>(
    `/documents/${documentId}/structured`,
    body,
    {
      ...(token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    },
  )
  return unwrapStructured(data)
}

export async function fetchDocuments(params: {
  page?: number
  perPage?: number
  status?: string
}): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>("/documents", {
    params: {
      page: params.page ?? 1,
      per_page: params.perPage ?? 20,
      ...(params.status ? { status: params.status } : {}),
    },
  })
  return data
}

export type ConsentMethod = "written" | "verbal" | "digital"

export async function uploadDischargeDocument(input: {
  patientName: string
  fileUri: string
  fileName: string
  mimeType: string
  consentGiven: boolean
  consentMethod: ConsentMethod
  onUploadProgress?: (percent: number) => void
}): Promise<{ status: number; duplicate?: boolean; document_id?: string }> {
  const form = new FormData()
  form.append("patient_name", input.patientName.trim())
  form.append("consent_given", input.consentGiven ? "true" : "false")
  form.append("consent_method", input.consentMethod)
  form.append(
    "file",
    {
      uri: input.fileUri,
      name: input.fileName,
      type: input.mimeType,
    } as unknown as Blob,
  )

  const { data, status } = await api.post<{
    document_id?: string
    duplicate?: boolean
    status?: string
  }>("/documents/upload", form, {
    transformRequest: (d) => d,
    headers: {
      Accept: "application/json",
    },
    onUploadProgress: (evt: AxiosProgressEvent) => {
      const total = evt.total ?? 0
      if (total > 0 && input.onUploadProgress) {
        input.onUploadProgress(Math.round((evt.loaded * 100) / total))
      }
    },
  })

  return {
    status,
    duplicate: Boolean(data?.duplicate),
    document_id: data?.document_id,
  }
}

export async function fetchDocumentDetail(id: string): Promise<DocumentDto> {
  const { data } = await api.get<DocumentDto>(`/documents/${id}`)
  return data
}

export async function pollDocumentStatus(
  id: string,
): Promise<{ status: string }> {
  const { data } = await api.get<{ status: string }>(`/documents/${id}/status`)
  return data
}

export async function fetchStructuredData(
  id: string,
): Promise<StructuredDataDto | null> {
  try {
    const { data } = await api.get<StructuredDataApiResponse>(
      `/documents/${id}/structured`,
    )
    return unwrapStructured(data)
  } catch {
    return null
  }
}

export async function fetchSummary(id: string): Promise<SummaryDto | null> {
  try {
    const { data } = await api.get<SummaryDto>(
      `/documents/${id}/summary/latest`,
    )
    return data
  } catch {
    return null
  }
}
