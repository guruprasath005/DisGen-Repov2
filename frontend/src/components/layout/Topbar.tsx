import { LogOut } from "lucide-react"
import { NavLink } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const roleLabel: Record<string, string> = {
  doctor: "Doctor",
  admin: "Admin",
  super_admin: "Super Admin",
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
}

export function Topbar() {
  const { user, logout } = useAuth()

  return (
    <header className="relative z-10 flex h-[3.65rem] shrink-0 items-center justify-between gap-6 border-border/45 border-b bg-white/55 px-5 shadow-[var(--shadow-xs)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/44">
      {user ? (
        <NavLink
          to="/profile"
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 outline-none transition-all",
            "hover:border-primary/25 hover:bg-primary/12 hover:shadow-[0_2px_16px_-8px_rgba(249,115,22,0.45)]",
            "focus-visible:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/35",
          )}
        >
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/22 bg-gradient-to-br from-primary/14 to-primary/8 font-semibold text-primary text-xs shadow-[inset_0_1px_1px_rgb(255_255_255_/_0.55)] tabular-nums sm:size-11 sm:text-sm"
            aria-hidden
          >
            {initials(user.full_name)}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 text-left leading-tight">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 truncate font-semibold text-foreground text-sm tracking-tight">
                {user.full_name}
              </p>
              <span
                className={cn(
                  "inline-flex shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-[10px] text-primary uppercase tracking-wide",
                )}
              >
                {roleLabel[user.role] ?? user.role.replace(/_/g, " ")}
              </span>
            </div>
            <p className="truncate font-mono text-muted-foreground text-xs">
              {user.username}
            </p>
          </div>
        </NavLink>
      ) : (
        <div className="size-10 shrink-0" aria-hidden />
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-6 shrink-0 gap-2 rounded-xl border-primary/28 bg-white/75 shadow-[var(--shadow-xs)] transition-colors hover:border-primary/42 hover:bg-primary/11 hover:text-primary sm:ml-10"
        onClick={() => void logout()}
      >
        <LogOut className="size-3.5" aria-hidden />
        Logout
      </Button>
    </header>
  )
}
