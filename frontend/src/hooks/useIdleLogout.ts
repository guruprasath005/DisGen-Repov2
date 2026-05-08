import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { useAuth } from "@/hooks/useAuth"

const IDLE_MS = 15 * 60 * 1000

/**
 * Clears session after 15 minutes without mouse / keyboard / scroll activity.
 */
export function useIdleLogout(enabled: boolean) {
  const { logout } = useAuth()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        toast.error("Session expired due to inactivity")
        await logout()
      }, IDLE_MS)
    }

    reset()

    const opts = { passive: true }
    window.addEventListener("mousemove", reset, opts)
    window.addEventListener("keydown", reset)
    window.addEventListener("click", reset)
    window.addEventListener("scroll", reset, opts)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener("mousemove", reset)
      window.removeEventListener("keydown", reset)
      window.removeEventListener("click", reset)
      window.removeEventListener("scroll", reset)
    }
  }, [enabled, logout])
}
