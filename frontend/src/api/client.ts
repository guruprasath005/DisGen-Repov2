import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios"

import { getMemoryAccessToken, setMemoryAccessToken } from "./token-memory"

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"])

const baseURL =
  import.meta.env.VITE_API_URL?.trim() || "http://localhost:8000"

/** Bare client — refresh only; avoids interceptor recursion */
export const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
})

/** Main API — Bearer + silent refresh on 401 */
export const api: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = getMemoryAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const method = (config.method ?? "get").toLowerCase()
  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken()
    if (csrf) {
      config.headers["X-CSRF-Token"] = csrf
    }
  }
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessTokenOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ access_token: string }>("/auth/refresh")
      .then((res) => {
        const token = res.data.access_token
        setMemoryAccessToken(token)
        return token
      })
      .catch(() => {
        setMemoryAccessToken(null)
        return null
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function shouldSkipRefreshRetry(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? ""
  if (url.includes("/auth/refresh")) return true
  if (url.includes("/auth/login")) return true
  if (url.includes("/auth/logout")) return true
  return false
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      shouldSkipRefreshRetry(originalRequest)
    ) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    const newToken = await refreshAccessTokenOnce()
    if (!newToken) {
      setMemoryAccessToken(null)
      window.location.assign("/login")
      return Promise.reject(error)
    }

    originalRequest.headers.Authorization = `Bearer ${newToken}`
    return api(originalRequest)
  },
)

export async function silentRefreshSession(): Promise<string | null> {
  return refreshAccessTokenOnce()
}
