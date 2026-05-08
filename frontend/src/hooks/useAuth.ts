import { useAuthContext } from "@/contexts/AuthContext"

/** Convenience alias — same as useAuthContext */
export function useAuth() {
  return useAuthContext()
}
