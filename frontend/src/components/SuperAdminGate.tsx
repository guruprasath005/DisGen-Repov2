import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"

import { useAuth } from "@/hooks/useAuth"

export function SuperAdminGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (user?.role !== "super_admin") {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
