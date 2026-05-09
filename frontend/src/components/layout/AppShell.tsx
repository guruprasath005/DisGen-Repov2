import { Outlet } from "react-router-dom"

import { Sidebar } from "@/components/layout/Sidebar"
import { Topbar } from "@/components/layout/Topbar"
import { useAuth } from "@/hooks/useAuth"
import { useIdleLogout } from "@/hooks/useIdleLogout"

export function AppShell() {
  const { accessToken, user } = useAuth()
  useIdleLogout(Boolean(accessToken && user))

  return (
    <div className="relative flex min-h-svh w-full bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-50/72 via-background to-sky-50/36"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-clinical-mesh opacity-[0.88]"
        aria-hidden
      />
      <Sidebar />
      <div className="relative flex min-h-svh min-w-0 flex-1 flex-col shadow-[inset_1px_0_0_rgb(15_23_42_/_0.04)]">
        <Topbar />
        <main className="scrollbar-clinical flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
