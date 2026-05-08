import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"

import { useAuth } from "@/hooks/useAuth"

export function DoctorGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (user?.role !== "doctor") {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
