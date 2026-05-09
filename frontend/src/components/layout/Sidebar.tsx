import type { ComponentType } from "react"
import { Activity, Building2, FileStack, FolderOpen, LayoutDashboard, Logs, PieChart, ShieldCheck, Upload, Users } from "lucide-react"
import { NavLink } from "react-router-dom"

import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

type Role = "doctor" | "admin" | "super_admin"

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  roles: readonly Role[]
}

const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["doctor", "admin", "super_admin"],
  },
  {
    to: "/upload",
    label: "Upload",
    icon: Upload,
    roles: ["doctor"],
  },
  {
    to: "/admin/audit-logs",
    label: "Audit Logs",
    icon: Logs,
    roles: ["admin", "super_admin"],
  },
  {
    to: "/admin/analytics",
    label: "Analytics",
    icon: PieChart,
    roles: ["admin", "super_admin"],
  },
  {
    to: "/admin/health",
    label: "Health",
    icon: Activity,
    roles: ["admin", "super_admin"],
  },
  {
    to: "/superadmin/users",
    label: "Users",
    icon: Users,
    roles: ["super_admin"],
  },
  {
    to: "/superadmin/hospital",
    label: "Hospital",
    icon: Building2,
    roles: ["super_admin"],
  },
  {
    to: "/superadmin/schemes",
    label: "Schemes",
    icon: FolderOpen,
    roles: ["super_admin"],
  },
  {
    to: "/superadmin/retention",
    label: "Retention",
    icon: FileStack,
    roles: ["super_admin"],
  },
]

const linkBase =
  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground/80 outline-none transition-all duration-200 hover:bg-primary/14 hover:text-primary hover:shadow-[0_1px_14px_-3px_rgba(249,115,22,0.38)] focus-visible:bg-primary/14 focus-visible:text-primary focus-visible:ring-2 focus-visible:ring-primary/28"

const linkActive =
  "bg-primary/[0.12] text-primary shadow-[var(--shadow-sm)] ring-1 ring-primary/25 [&_svg]:text-primary"

export function Sidebar() {
  const { user } = useAuth()
  const role = user?.role

  const visible = NAV_ITEMS.filter(
    (item) => role && item.roles.includes(role as Role),
  )

  return (
    <aside className="relative z-10 flex w-[15.5rem] shrink-0 flex-col border-border/55 border-r bg-white/60 shadow-[4px_0_36px_-18px_rgb(15_23_42_/_0.1),inset_-1px_0_0_rgb(255_255_255_/_0.7)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/48">
      <div className="border-border/30 border-b bg-gradient-to-b from-white/50 to-transparent px-4 py-5">
        <NavLink
          to="/dashboard"
          className="flex items-center gap-3 outline-none transition-opacity hover:opacity-90"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-sm)] shadow-primary/28 ring-1 ring-white/25">
            <ShieldCheck className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 text-left leading-tight">
            <span className="block font-semibold text-foreground text-sm tracking-tight">
              DisGen
            </span>
            <span className="block text-[11px] text-muted-foreground leading-tight">
              Discharge Intelligence
            </span>
          </div>
        </NavLink>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {visible.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                linkBase,
                isActive && linkActive,
                !isActive && "[&_svg]:opacity-80 group-hover:[&_svg]:text-primary group-hover:[&_svg]:opacity-100",
              )
            }
            end={to === "/dashboard"}
          >
            <Icon className="size-4 shrink-0 transition-colors" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-border/30 border-t bg-gradient-to-t from-muted/15 to-transparent px-3 py-3 text-[11px] text-muted-foreground/90 tracking-wide leading-relaxed">
        PHI-handling environment. Activity may be audited.
      </div>
    </aside>
  )
}
