import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useColorScheme } from "react-native"

import { darkTheme, theme as lightTheme, type ThemeTokens } from "../theme"

const THEME_OVERRIDE_KEY = "theme_override"

export type ThemeOverride = "light" | "dark" | null

interface ThemeContextValue {
  theme: ThemeTokens
  isDark: boolean
  themeOverride: ThemeOverride
  toggleTheme: () => void
  setThemeOverride: (mode: ThemeOverride) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const [themeOverride, setThemeOverrideState] = useState<ThemeOverride>(null)

  useEffect(() => {
    let cancelled = false
    void AsyncStorage.getItem(THEME_OVERRIDE_KEY).then((raw) => {
      if (cancelled) return
      if (raw === "light" || raw === "dark") setThemeOverrideState(raw)
      else setThemeOverrideState(null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const effectiveDark =
    themeOverride === "dark" ||
    (themeOverride === null && systemScheme === "dark")

  const activeTheme = effectiveDark ? darkTheme : lightTheme

  const persistOverride = useCallback((mode: ThemeOverride) => {
    setThemeOverrideState(mode)
    if (mode === null) {
      void AsyncStorage.removeItem(THEME_OVERRIDE_KEY)
    } else {
      void AsyncStorage.setItem(THEME_OVERRIDE_KEY, mode)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    persistOverride(effectiveDark ? "light" : "dark")
  }, [effectiveDark, persistOverride])

  const setThemeOverride = useCallback(
    (mode: ThemeOverride) => {
      persistOverride(mode)
    },
    [persistOverride],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: activeTheme,
      isDark: effectiveDark,
      themeOverride,
      toggleTheme,
      setThemeOverride,
    }),
    [
      activeTheme,
      effectiveDark,
      themeOverride,
      toggleTheme,
      setThemeOverride,
    ],
  )

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return ctx
}
