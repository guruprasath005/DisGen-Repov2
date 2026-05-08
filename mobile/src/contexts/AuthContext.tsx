import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"
import axios from "axios"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import {
  api,
  clearStoredRefreshToken,
  getMemoryAccessToken,
  REFRESH_TOKEN_KEY,
  registerSessionExpiredHandler,
  setMemoryAccessToken,
} from "../api/client"

const baseURL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? ""

const BIOMETRIC_ENABLED_KEY = "biometric_enabled"
const SAVED_USERNAME_KEY = "saved_username"
const SAVED_PASSWORD_KEY = "saved_password"

export interface AuthUser {
  id: string
  username: string
  full_name: string
  email: string
  role: string
  hospital_id: string
}

interface AuthContextValue {
  accessToken: string | null
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>("/auth/me")
  return data
}

/** Bare client for boot refresh — avoids interceptor recursion */
const bootRefreshClient = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
})

async function saveBiometricCredentials(username: string, password: string) {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    if (hasHardware && enrolled) {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true")
      await SecureStore.setItemAsync(SAVED_USERNAME_KEY, username)
      await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password)
    }
  } catch {
    /* ignore */
  }
}

async function clearBiometricCredentials() {
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(SAVED_USERNAME_KEY).catch(() => undefined)
  await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY).catch(() => undefined)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    getMemoryAccessToken(),
  )
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncAccessToken = useCallback((token: string | null) => {
    setMemoryAccessToken(token)
    setAccessTokenState(token)
  }, [])

  const performLogin = useCallback(
    async (username: string, password: string) => {
      syncAccessToken(null)
      const { data } = await api.post<{
        access_token: string
        refresh_token?: string | null
      }>("/auth/login", { username, password })

      if (data.refresh_token) {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token)
      } else {
        await clearStoredRefreshToken()
      }

      syncAccessToken(data.access_token)
      const me = await fetchMe()
      setUser(me)

      await saveBiometricCredentials(username, password)
    },
    [syncAccessToken],
  )

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      syncAccessToken(null)
      setUser(null)
    })
  }, [syncAccessToken])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      let sessionRestored = false

      try {
        const rt = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
        if (rt && !cancelled) {
          try {
            const { data } = await bootRefreshClient.post<{
              access_token: string
              refresh_token?: string | null
            }>("/auth/refresh", { refresh_token: rt })

            if (!cancelled) {
              syncAccessToken(data.access_token)
              if (data.refresh_token) {
                await SecureStore.setItemAsync(
                  REFRESH_TOKEN_KEY,
                  data.refresh_token,
                )
              }

              const me = await fetchMe()
              if (!cancelled) {
                setUser(me)
                sessionRestored = true
              }
            }
          } catch {
            await clearStoredRefreshToken()
            syncAccessToken(null)
          }
        }
      } catch {
        await clearStoredRefreshToken().catch(() => undefined)
        syncAccessToken(null)
      }

      if (!cancelled && !sessionRestored) {
        try {
          const bio = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)
          const su = await SecureStore.getItemAsync(SAVED_USERNAME_KEY)
          const sp = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY)
          if (bio === "true" && su && sp) {
            const authResult = await LocalAuthentication.authenticateAsync({
              promptMessage: "Sign in to DisGen",
              fallbackLabel: "Use password",
              cancelLabel: "Cancel",
            })
            if (authResult.success && !cancelled) {
              try {
                await performLogin(su, sp)
              } catch {
                /* fall through to LoginScreen */
              }
            }
          }
        } catch {
          /* ignore */
        }
      }

      if (!cancelled) setIsLoading(false)
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [performLogin, syncAccessToken])

  const login = useCallback(
    async (username: string, password: string) => {
      await performLogin(username, password)
    },
    [performLogin],
  )

  const logout = useCallback(async () => {
    const rt = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(
      () => null,
    )
    try {
      await api.post("/auth/logout", {
        refresh_token: rt ?? undefined,
      })
    } catch {
      /* session may already be invalid */
    }
    await clearStoredRefreshToken()
    await clearBiometricCredentials()
    syncAccessToken(null)
    setUser(null)
  }, [syncAccessToken])

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      user,
      isLoading,
      login,
      logout,
    }),
    [accessToken, user, isLoading, login, logout],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}
