import { api } from "@/api/client"

export interface AuditLogEntry {
  id: string
  user_id: string | null
  username: string
  role: string
  action: string
  document_id: string | null
  target_user_id: string | null
  ip_address: string
  details: Record<string, unknown> | null
  created_at: string
}

export interface AuditLogListResponse {
  logs: AuditLogEntry[]
  total: number
  page: number
  per_page: number
}

export interface ServiceHealth {
  status: "ok" | "degraded" | "error" | "unconfigured" | string
  latency_ms: number | null
  detail: string | null
}

export interface AdminHealthResponse {
  overall: "ok" | "degraded" | "error"
  uptime_seconds: number
  services: Record<string, ServiceHealth>
}

export interface AdminAnalyticsResponse {
  documents_total: number
  summaries_approved: number
  avg_ocr_confidence: number | null
  uploads_by_date: { date: string; count: number }[]
  status_distribution: Record<string, number>
  scheme_distribution: Record<string, number>
}

export interface FetchAuditLogsParams {
  page?: number
  per_page?: number
  action?: string | null
  from?: string | null
  to?: string | null
}

/** Audit action filter dropdown values (aligned with backend audit vocabulary). */
export const AUDIT_ACTION_OPTIONS = [
  "UPLOAD",
  "OCR_COMPLETE",
  "EXTRACT_COMPLETE",
  "STRUCTURED_UPDATE",
  "STRUCTURED_CONFIRM",
  "GENERATE",
  "APPROVE",
  "PDF_DOWNLOAD",
  "LOGIN",
  "LOGOUT",
  "USER_CREATE",
  "USER_DEACTIVATE",
  "SCHEME_CREATE",
  "SCHEME_UPDATE",
  "SCHEME_DELETE",
] as const

export async function fetchAuditLogs(
  params: FetchAuditLogsParams = {},
): Promise<AuditLogListResponse> {
  const { data } = await api.get<AuditLogListResponse>("/admin/audit-logs", {
    params: {
      page: params.page ?? 1,
      per_page: params.per_page ?? 50,
      ...(params.action ? { action: params.action } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
  })
  return data
}

export async function fetchAdminHealth(): Promise<AdminHealthResponse> {
  const { data } = await api.get<AdminHealthResponse>("/admin/health")
  return data
}

export async function fetchAdminAnalytics(): Promise<AdminAnalyticsResponse> {
  const { data } = await api.get<AdminAnalyticsResponse>("/admin/analytics")
  return data
}
