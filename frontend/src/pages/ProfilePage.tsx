import { LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

function roleBadgeClass(role: string): string {
  if (role === "super_admin")
    return "border-violet-300/60 bg-violet-500/12 text-violet-900"
  if (role === "admin") return "border-primary/35 bg-primary/10 text-primary"
  return "border-border bg-muted/70 text-muted-foreground"
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
}

export default function ProfilePage() {
  const { user, logout } = useAuth()

  if (!user) {
    return null
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 pb-12">
      <div className="space-y-1">
        <p className="font-medium text-[11px] text-primary uppercase tracking-[0.14em]">
          Workspace
        </p>
        <h1 className="font-semibold text-2xl text-foreground tracking-tight">
          Profile
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Your account details for this hospital workspace.
        </p>
      </div>

      <Card className="border-white/58 bg-white/58 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/46">
        <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
          <div
            className="flex size-20 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/10 font-semibold text-2xl text-primary tabular-nums shadow-inner"
            aria-hidden
          >
            {initials(user.full_name)}
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground text-xl tracking-tight">
              {user.full_name}
            </p>
            <p className="text-muted-foreground text-sm">@{user.username}</p>
            <p className="text-muted-foreground text-sm">{user.email}</p>
            <div className="pt-2">
              <span
                className={cn(
                  "inline-flex rounded-md border px-2.5 py-1 font-medium text-[11px] uppercase tracking-wide",
                  roleBadgeClass(user.role),
                )}
              >
                {user.role.replace(/_/g, " ")}
              </span>
            </div>
            <p className="pt-3 font-mono text-muted-foreground text-xs">
              Hospital ID:{" "}
              <span className="text-foreground">{user.hospital_id}</span>
            </p>
          </div>
          <p className="max-w-sm rounded-xl border border-amber-200/75 bg-gradient-to-br from-amber-50/98 to-amber-50/85 px-4 py-3 text-amber-950 text-sm leading-relaxed shadow-[var(--shadow-xs)]">
            To update your profile details, contact your Super Admin.
          </p>
          <Button
            type="button"
            variant="destructive"
            className="min-w-[200px] rounded-xl border border-destructive/35 shadow-[var(--shadow-xs)]"
            onClick={() => {
              void logout()
            }}
          >
            <LogOut className="size-4" aria-hidden />
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
