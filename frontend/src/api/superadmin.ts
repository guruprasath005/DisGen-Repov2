import { api } from "@/api/client"

export interface SuperAdminUserResponse {
  id: string
  username: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  last_login: string | null
  failed_attempts: number
  locked_until: string | null
}

export interface SuperAdminUserListResponse {
  users: SuperAdminUserResponse[]
  total: number
  page: number
  per_page: number
}

export interface FetchSuperAdminUsersParams {
  page?: number
  per_page?: number
  role?: string | null
  /** When `true`: active only; when `false`: inactive only; omit or `undefined`: all */
  is_active?: boolean | null
  /** Case-insensitive partial match on full name or username */
  name?: string | null
}

export async function fetchSuperAdminUsers(
  params: FetchSuperAdminUsersParams = {},
): Promise<SuperAdminUserListResponse> {
  const { data } = await api.get<SuperAdminUserListResponse>("/superadmin/users", {
    params: {
      page: params.page ?? 1,
      per_page: params.per_page ?? 20,
      ...(params.role ? { role: params.role } : {}),
      ...(typeof params.is_active === "boolean"
        ? { is_active: params.is_active }
        : {}),
      ...(params.name?.trim() ? { name: params.name.trim() } : {}),
    },
  })
  return data
}

export interface CreateSuperAdminUserBody {
  username: string
  full_name: string
  email: string
  password: string
  role: "admin" | "doctor"
}

export async function createSuperAdminUser(
  body: CreateSuperAdminUserBody,
): Promise<SuperAdminUserResponse> {
  const { data } = await api.post<SuperAdminUserResponse>("/superadmin/users", body)
  return data
}

export interface UpdateSuperAdminUserBody {
  full_name?: string
  email?: string
  role?: "admin" | "doctor"
  is_active?: boolean
}

export async function updateSuperAdminUser(
  id: string,
  body: UpdateSuperAdminUserBody,
): Promise<SuperAdminUserResponse> {
  const { data } = await api.put<SuperAdminUserResponse>(
    `/superadmin/users/${id}`,
    body,
  )
  return data
}

export async function deactivateSuperAdminUser(
  id: string,
): Promise<SuperAdminUserResponse> {
  const { data } = await api.post<SuperAdminUserResponse>(
    `/superadmin/users/${id}/deactivate`,
  )
  return data
}

export async function activateSuperAdminUser(
  id: string,
): Promise<SuperAdminUserResponse> {
  const { data } = await api.post<SuperAdminUserResponse>(
    `/superadmin/users/${id}/activate`,
  )
  return data
}

export async function resetSuperAdminUserPassword(
  id: string,
  body: { new_password: string },
): Promise<SuperAdminUserResponse> {
  const { data } = await api.post<SuperAdminUserResponse>(
    `/superadmin/users/${id}/reset-password`,
    body,
  )
  return data
}

export interface SuperAdminSessionInfo {
  jti: string
  expires_at: string
}

export interface SuperAdminSessionsResponse {
  user_id: string
  sessions: SuperAdminSessionInfo[]
  count: number
}

export async function fetchSuperAdminUserSessions(
  id: string,
): Promise<SuperAdminSessionsResponse> {
  const { data } = await api.get<SuperAdminSessionsResponse>(
    `/superadmin/users/${id}/sessions`,
  )
  return data
}

export async function revokeSuperAdminUserSessions(id: string): Promise<void> {
  await api.delete(`/superadmin/users/${id}/sessions`)
}

export interface HospitalConfigResponse {
  name: string
  logo: string | null
  address: string | null
  phone: string | null
  email: string | null
  registration_number: string | null
  gstin: string | null
  default_scheme: string
  pdf_header_color: string
  pdf_accent_color: string
  updated_at: string
}

export type HospitalConfigUpdateBody = Omit<
  HospitalConfigResponse,
  "updated_at"
>

export async function fetchHospitalConfig(): Promise<HospitalConfigResponse> {
  const { data } = await api.get<HospitalConfigResponse>("/superadmin/hospital")
  return data
}

export async function updateHospitalConfig(
  body: HospitalConfigUpdateBody,
): Promise<HospitalConfigResponse> {
  const { data } = await api.put<HospitalConfigResponse>(
    "/superadmin/hospital",
    body,
  )
  return data
}

export interface RetentionSettingsResponse {
  retention_days: number
  auto_delete: boolean
  anonymize_on_expiry: boolean
  updated_at: string
}

export interface RetentionSettingsUpdateBody {
  retention_days: number
  auto_delete: boolean
  anonymize_on_expiry: boolean
}

export async function fetchRetentionSettings(): Promise<RetentionSettingsResponse> {
  const { data } = await api.get<RetentionSettingsResponse>(
    "/superadmin/retention",
  )
  return data
}

export async function updateRetentionSettings(
  body: RetentionSettingsUpdateBody,
): Promise<RetentionSettingsResponse> {
  const { data } = await api.put<RetentionSettingsResponse>(
    "/superadmin/retention",
    body,
  )
  return data
}
