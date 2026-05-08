import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Navigate } from "react-router-dom"

import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { accessToken, user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6">
        <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
        <div className="flex w-full max-w-md flex-col gap-3">
          <Skeleton className="h-4 w-[55%] rounded-md" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-[72%] rounded-md" />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Restoring secure session…
        </p>
      </div>
    )
  }

  if (!accessToken || !user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
