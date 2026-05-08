import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios"
import * as SecureStore from "expo-secure-store"

export const REFRESH_TOKEN_KEY = "disgen_refresh_token"

const baseURL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""

export const API_BASE_URL = baseURL

/** In-memory access token — not persisted */
let memoryAccessToken: string | null = null

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token
}

export function getMemoryAccessToken(): string | null {
  return memoryAccessToken
}

let onSessionExpired: () => void = () => {}

/** Call from AuthContext on mount so 401 refresh failures clear app session + UI */
export function registerSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler
}

export async function clearStoredRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
  } catch {
    /* key may be absent */
  }
}

/** No auth interceptor — used only for refresh rotation */
const refreshClient = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
})

export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
})

api.interceptors.request.use((config) => {
  const t = getMemoryAccessToken()
  if (t) {
    config.headers.Authorization = `Bearer ${t}`
  }
  return config
})

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

async function handleAuthFailure(): Promise<void> {
  setMemoryAccessToken(null)
  await clearStoredRefreshToken()
  onSessionExpired()
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined

    if (!axios.isAxiosError(error) || !originalRequest) {
      return Promise.reject(error)
    }

    const reqUrl = originalRequest.url ?? ""
    if (
      reqUrl.includes("/auth/login") ||
      reqUrl.includes("/auth/logout") ||
      reqUrl.includes("/auth/refresh")
    ) {
      return Promise.reject(error)
    }

    if (
      error.response?.status !== 401 ||
      originalRequest._retry
    ) {
      if (error.response?.status === 401 && originalRequest._retry) {
        await handleAuthFailure()
      }
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      const rt = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
      if (!rt) {
        await handleAuthFailure()
        return Promise.reject(error)
      }

      const { data } = await refreshClient.post<{
        access_token: string
        refresh_token?: string | null
      }>("/auth/refresh", { refresh_token: rt })

      setMemoryAccessToken(data.access_token)
      if (data.refresh_token) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token)
      }

      originalRequest.headers.Authorization = `Bearer ${data.access_token}`
      return api(originalRequest)
    } catch {
      await handleAuthFailure()
      return Promise.reject(error)
    }
  },
)
