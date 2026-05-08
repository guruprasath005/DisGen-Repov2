import { api } from "@/api/client"

export interface SchemeFieldItem {
  field: string
  label: string
  type?: string
  section?: string | null
  hint?: string | null
  validation?: string | null
  options?: string[] | null
}

export interface SchemeResponse {
  id: string
  name: string
  label: string
  color: string
  required_fields: SchemeFieldItem[]
  optional_fields: SchemeFieldItem[]
  rules: string[]
  pdf_sections: string[]
  pdf_template: string
  is_builtin: boolean
  created_at: string
  created_by: string | null
}

export interface CustomSchemePayload {
  name: string
  label: string
  color: string
  required_fields: SchemeFieldItem[]
  optional_fields: SchemeFieldItem[]
  rules: string[]
  pdf_sections: string[]
  rag_chunks?: string[]
}

export async function fetchSchemes(): Promise<SchemeResponse[]> {
  const { data } = await api.get<SchemeResponse[]>("/schemes")
  return data
}

export async function createCustomScheme(
  body: CustomSchemePayload,
): Promise<SchemeResponse> {
  const { data } = await api.post<SchemeResponse>("/schemes/custom", body)
  return data
}

export async function updateCustomScheme(
  id: string,
  body: CustomSchemePayload,
): Promise<SchemeResponse> {
  const { data } = await api.put<SchemeResponse>(`/schemes/custom/${id}`, body)
  return data
}

export async function deleteCustomScheme(id: string): Promise<void> {
  await api.delete(`/schemes/custom/${id}`)
}
