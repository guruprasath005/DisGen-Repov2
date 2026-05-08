import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useNavigate } from "react-router-dom"

import { api, silentRefreshSession } from "@/api/client"
import { setMemoryAccessToken } from "@/api/token-memory"

export interface AuthUser {
  id: string
  username: string
  full_name: string
  email: string
  role: "doctor" | "admin" | "super_admin"
  hospital_id: string
}

interface AuthState {
  accessToken: string | null
  user: AuthUser | null
}

interface AuthContextValue extends AuthState {
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>("/auth/me")
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncToken = useCallback((token: string | null) => {
    setMemoryAccessToken(token)
    setAccessToken(token)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const token = await silentRefreshSession()
        if (cancelled) return
        if (token) {
          syncToken(token)
          const me = await fetchMe()
          if (!cancelled) setUser(me)
        } else {
          syncToken(null)
          setUser(null)
        }
      } catch {
        if (!cancelled) {
          syncToken(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [syncToken])

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<{ access_token: string }>(
      "/auth/login",
      { username, password },
    )
    syncToken(data.access_token)
    const me = await fetchMe()
    setUser(me)
  }, [syncToken])

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout")
    } catch {
      /* session already invalid — still clear client state */
    }
    syncToken(null)
    setUser(null)
    navigate("/login", { replace: true })
  }, [navigate, syncToken])

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

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuthContext must be used within AuthProvider")
  }
  return ctx
}
