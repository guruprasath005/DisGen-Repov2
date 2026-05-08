import type { AxiosProgressEvent } from "axios"

import { api } from "./client"

export interface DocumentDto {
  id: string
  filename: string
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

export async function fetchDocuments(params: {
  page?: number
  perPage?: number
}): Promise<DocumentListResponse> {
  const { data } = await api.get<DocumentListResponse>("/documents", {
    params: {
      page: params.page ?? 1,
      per_page: params.perPage ?? 20,
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
    const { data } = await api.get<StructuredDataDto>(
      `/documents/${id}/structured`,
    )
    return data
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
