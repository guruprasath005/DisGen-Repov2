import * as React from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import axios from "axios"
import { AlertDialog, Dialog } from "radix-ui"
import { Eye, EyeOff, KeyRound, Loader2, Shield, UserPlus } from "lucide-react"
import { toast } from "sonner"

import {
  activateSuperAdminUser,
  createSuperAdminUser,
  deactivateSuperAdminUser,
  fetchSuperAdminUserSessions,
  fetchSuperAdminUsers,
  resetSuperAdminUserPassword,
  revokeSuperAdminUserSessions,
  type SuperAdminSessionsResponse,
  type SuperAdminUserResponse,
} from "@/api/superadmin"
import {
  FilterPanel,
  FilterSelect,
  filterFieldClass,
  filterLabelClass,
} from "@/components/FilterPanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const PER_PAGE = 20

const USERNAME_RE = /^[A-Za-z0-9_]{3,50}$/

function extractErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data
    if (d && typeof d === "object" && "detail" in d) {
      const detail = (d as { detail?: unknown }).detail
      if (typeof detail === "string") return detail
      if (Array.isArray(detail)) return JSON.stringify(detail)
    }
    return e.message || "Request failed"
  }
  return e instanceof Error ? e.message : "Something went wrong"
}

function roleBadgeClass(role: string): string {
  if (role === "super_admin")
    return "border-violet-300/60 bg-violet-500/12 text-violet-900"
  if (role === "admin") return "border-primary/35 bg-primary/10 text-primary"
  return "border-border bg-muted/70 text-muted-foreground"
}

function formatLogin(iso: string | null): string {
  if (!iso) return "Never"
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function formatExpires(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function isLocked(u: SuperAdminUserResponse): boolean {
  if (!u.locked_until) return false
  try {
    return new Date(u.locked_until).getTime() > Date.now()
  } catch {
    return false
  }
}

export default function UsersPage() {
  const qc = useQueryClient()
  const { user: actor } = useAuth()

  const [page, setPage] = React.useState(1)
  const [roleFilter, setRoleFilter] = React.useState<
    "" | "admin" | "doctor"
  >("")
  const [activeFilter, setActiveFilter] = React.useState<
    "all" | "active" | "inactive"
  >("all")
  const [nameSearchInput, setNameSearchInput] = React.useState("")
  const [nameSearch, setNameSearch] = React.useState("")

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setNameSearch(nameSearchInput.trim())
    }, 350)
    return () => window.clearTimeout(id)
  }, [nameSearchInput])

  React.useEffect(() => {
    setPage(1)
  }, [nameSearch])

  const listParams = React.useMemo(
    () => ({
      page,
      per_page: PER_PAGE,
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(activeFilter === "active"
        ? { is_active: true as const }
        : activeFilter === "inactive"
          ? { is_active: false as const }
          : {}),
      ...(nameSearch ? { name: nameSearch } : {}),
    }),
    [page, roleFilter, activeFilter, nameSearch],
  )

  const usersQuery = useQuery({
    queryKey: ["superadmin", "users", listParams],
    queryFn: () => fetchSuperAdminUsers(listParams),
  })

  const data = usersQuery.data
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const pageSafe = Math.min(page, totalPages)

  const rangeStart = total === 0 ? 0 : (pageSafe - 1) * PER_PAGE + 1
  const rangeEnd = Math.min(pageSafe * PER_PAGE, total)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [resetUser, setResetUser] = React.useState<SuperAdminUserResponse | null>(
    null,
  )
  const [sessionsUser, setSessionsUser] =
    React.useState<SuperAdminUserResponse | null>(null)
  const [deactivateTarget, setDeactivateTarget] =
    React.useState<SuperAdminUserResponse | null>(null)
  const [revokeTarget, setRevokeTarget] =
    React.useState<SuperAdminUserResponse | null>(null)

  const invalidateUsers = React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["superadmin", "users"] })
  }, [qc])

  function clearUserFilters() {
    setRoleFilter("")
    setActiveFilter("all")
    setNameSearchInput("")
    setNameSearch("")
    setPage(1)
  }

  const userFilterActiveCount =
    (roleFilter ? 1 : 0) +
    (activeFilter !== "all" ? 1 : 0) +
    (nameSearch ? 1 : 0)

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateSuperAdminUser(id),
    onSuccess: async () => {
      toast.success("User activated.")
      await invalidateUsers()
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateSuperAdminUser(id),
    onSuccess: async () => {
      toast.success("User deactivated.")
      setDeactivateTarget(null)
      await invalidateUsers()
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeSuperAdminUserSessions(id),
    onSuccess: async (_void, revokedUserId) => {
      toast.success("All sessions revoked.")
      setRevokeTarget(null)
      setSessionsUser(null)
      await invalidateUsers()
      await qc.invalidateQueries({
        queryKey: ["superadmin", "users", revokedUserId, "sessions"],
      })
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const sessionsQuery = useQuery<SuperAdminSessionsResponse>({
    queryKey: ["superadmin", "users", sessionsUser?.id, "sessions"],
    queryFn: () => fetchSuperAdminUserSessions(sessionsUser!.id),
    enabled: Boolean(sessionsUser),
  })

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            User management
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Provision admins and doctors, enforce lockouts, and control active
            sessions across your tenant.
          </p>
        </div>
        <Button
          type="button"
          className="gap-2 shadow-md shadow-orange-950/15"
          onClick={() => setCreateOpen(true)}
        >
          <UserPlus className="size-4" aria-hidden />
          Create user
        </Button>
      </div>

      <CreateUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={invalidateUsers}
      />

      <ResetPasswordModal
        user={resetUser}
        onClose={() => setResetUser(null)}
        onDone={invalidateUsers}
      />

      <SessionsModal
        user={sessionsUser}
        onClose={() => setSessionsUser(null)}
        sessionsQuery={sessionsQuery}
        onRequestRevoke={(u) => setRevokeTarget(u)}
      />

      <AlertDialog.Root
        open={deactivateTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeactivateTarget(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/98 p-6 shadow-xl outline-none">
            <AlertDialog.Title className="font-semibold text-foreground text-lg">
              Deactivate account?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-muted-foreground text-sm">
              <span className="font-medium text-foreground">
                {deactivateTarget?.full_name}
              </span>{" "}
              ({deactivateTarget?.username}) will be blocked from signing in and
              all refresh sessions will end immediately.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" className="bg-white/70">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deactivateMutation.isPending}
                  onClick={() => {
                    if (deactivateTarget)
                      deactivateMutation.mutate(deactivateTarget.id)
                  }}
                >
                  Deactivate user
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={revokeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRevokeTarget(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/98 p-6 shadow-xl outline-none">
            <AlertDialog.Title className="font-semibold text-foreground text-lg">
              Revoke all sessions?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-muted-foreground text-sm">
              Every active refresh token for{" "}
              <span className="font-medium text-foreground">
                {revokeTarget?.full_name}
              </span>{" "}
              will be invalidated. They must sign in again on each device.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" className="bg-white/70">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={revokeMutation.isPending}
                  onClick={() => {
                    if (revokeTarget) revokeMutation.mutate(revokeTarget.id)
                  }}
                >
                  Revoke all sessions
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <FilterPanel
        title="Filters"
        description="Search by display name or username, then narrow by role and activation state. Table actions apply to visible rows only."
        activeFilterCount={userFilterActiveCount}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={userFilterActiveCount === 0}
            onClick={clearUserFilters}
          >
            Reset filters
          </Button>
        }
      >
        <div className={cn(filterFieldClass, "min-w-[min(100%,14rem)] flex-1")}>
          <label htmlFor="filter-name" className={filterLabelClass}>
            Name or username
          </label>
          <Input
            id="filter-name"
            type="search"
            placeholder="Search…"
            autoComplete="off"
            value={nameSearchInput}
            onChange={(e) => setNameSearchInput(e.target.value)}
            className="h-10 rounded-xl border-input/95 bg-background shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)]"
          />
        </div>

        <div className={cn(filterFieldClass, "max-w-xs")}>
          <label htmlFor="filter-role" className={filterLabelClass}>
            Role
          </label>
          <FilterSelect
            id="filter-role"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value as "" | "admin" | "doctor")
              setPage(1)
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="doctor">Doctor</option>
          </FilterSelect>
        </div>

        <div className={cn(filterFieldClass, "min-w-[min(100%,17rem)]")}>
          <span className={filterLabelClass}>Active status</span>
          <div className="inline-flex w-full rounded-xl border border-input/95 bg-muted/35 p-1 shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)]">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["inactive", "Inactive"],
              ] as const
            ).map(([key, lab]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 font-semibold text-xs transition-all",
                  activeFilter === key
                    ? "bg-primary text-primary-foreground shadow-[var(--shadow-sm)] shadow-primary/20 ring-1 ring-primary/25"
                    : "text-muted-foreground hover:bg-background/95 hover:text-foreground",
                )}
                onClick={() => {
                  setActiveFilter(key)
                  setPage(1)
                }}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>
      </FilterPanel>

      <Card className="overflow-hidden border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead>
                <tr className="border-border/60 border-b bg-muted/35 text-left">
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Full name
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Username
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Email
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Role
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Last login
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Failed
                  </th>
                  <th className="px-3 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-border/40 border-b">
                        <td className="px-3 py-3" colSpan={8}>
                          <Skeleton className="h-10 w-full rounded-md" />
                        </td>
                      </tr>
                    ))
                  : usersQuery.error
                    ? (
                        <tr>
                          <td
                            className="px-6 py-12 text-center text-destructive text-sm"
                            colSpan={8}
                          >
                            Unable to load users.
                          </td>
                        </tr>
                      )
                    : !data?.users.length
                      ? (
                          <tr>
                            <td
                              className="px-6 py-16 text-center text-muted-foreground text-sm"
                              colSpan={8}
                            >
                              No users match these filters.
                            </td>
                          </tr>
                        )
                      : data.users.map((row) => {
                          const locked = isLocked(row)
                          const selfRow = actor?.id === row.id
                          const superRow = row.role === "super_admin"
                          const canToggleDeactivate =
                            !selfRow &&
                            !superRow &&
                            row.is_active
                          const canToggleActivate =
                            !superRow && !row.is_active

                          return (
                            <tr
                              key={row.id}
                              className="border-border/40 border-b hover:bg-muted/20"
                            >
                              <td className="px-3 py-3 font-medium">
                                {row.full_name}
                              </td>
                              <td className="px-3 py-3 font-mono text-xs">
                                {row.username}
                              </td>
                              <td className="max-w-[200px] truncate px-3 py-3 text-muted-foreground text-xs">
                                {row.email}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={cn(
                                    "rounded-md border px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                                    roleBadgeClass(row.role),
                                  )}
                                >
                                  {row.role.replace(/_/g, " ")}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={cn(
                                    "rounded-md border px-2 py-1 font-semibold text-[10px] uppercase tracking-wide",
                                    locked
                                      ? "border-amber-300/70 bg-amber-50 text-amber-950"
                                      : row.is_active
                                        ? "border-emerald-300/70 bg-emerald-50 text-emerald-950"
                                        : "border-border bg-muted/50 text-muted-foreground",
                                  )}
                                >
                                  {locked
                                    ? "Locked"
                                    : row.is_active
                                      ? "Active"
                                      : "Inactive"}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-muted-foreground text-xs tabular-nums">
                                {formatLogin(row.last_login)}
                              </td>
                              <td className="px-3 py-3 font-mono text-xs tabular-nums">
                                {row.failed_attempts}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {canToggleDeactivate ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      className="bg-white/70"
                                      disabled={deactivateMutation.isPending}
                                      onClick={() => setDeactivateTarget(row)}
                                    >
                                      Deactivate
                                    </Button>
                                  ) : null}
                                  {canToggleActivate ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      className="border-emerald-300/60 bg-emerald-50/80 text-emerald-950 hover:bg-emerald-50"
                                      disabled={activateMutation.isPending}
                                      onClick={() =>
                                        activateMutation.mutate(row.id)
                                      }
                                    >
                                      Activate
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    className="gap-1 bg-white/70"
                                    onClick={() => setResetUser(row)}
                                  >
                                    <KeyRound className="size-3" aria-hidden />
                                    Reset password
                                  </Button>
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="outline"
                                    className="gap-1 bg-white/70"
                                    onClick={() => setSessionsUser(row)}
                                  >
                                    <Shield className="size-3" aria-hidden />
                                    Sessions
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
              </tbody>
            </table>
          </div>

          {!usersQuery.isLoading && data && data.users.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-border/50 border-t bg-white/40 px-4 py-3 backdrop-blur-sm">
              <p className="text-muted-foreground text-xs">
                Showing{" "}
                <span className="font-medium text-foreground">{rangeStart}</span>
                –
                <span className="font-medium text-foreground">{rangeEnd}</span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{total}</span>{" "}
                users
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-white/70"
                  disabled={pageSafe <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-white/70"
                  disabled={pageSafe >= totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(totalPages, p + 1))
                  }
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function CreateUserModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => Promise<void>
}) {
  const [username, setUsername] = React.useState("")
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [role, setRole] = React.useState<"admin" | "doctor">("doctor")
  const [showPw, setShowPw] = React.useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      createSuperAdminUser({
        username: username.trim().toLowerCase(),
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
      }),
    onSuccess: async () => {
      toast.success("User created.")
      await onCreated()
      onOpenChange(false)
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const u = username.trim()
    if (!USERNAME_RE.test(u)) {
      toast.error(
        "Username must be 3–50 characters (letters, digits, underscores).",
      )
      return
    }
    if (!fullName.trim()) {
      toast.error("Full name is required.")
      return
    }
    if (!email.trim()) {
      toast.error("Email is required.")
      return
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setUsername("")
          setFullName("")
          setEmail("")
          setPassword("")
          setRole("doctor")
          setShowPw(false)
        }
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/98 p-6 shadow-xl outline-none">
          <Dialog.Title className="font-semibold text-foreground text-lg">
            Create user
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-muted-foreground text-sm">
            Creates an administrator or clinician login scoped to this hospital.
          </Dialog.Description>
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="cu-user">Username</Label>
              <Input
                id="cu-user"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-white/70 font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-name">Full name</Label>
              <Input
                id="cu-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-white/70"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-email">Email</Label>
              <Input
                id="cu-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/70"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-pw">Password</Label>
              <div className="relative">
                <Input
                  id="cu-pw"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-white/70 pr-10"
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cu-role">Role</Label>
              <select
                id="cu-role"
                className={cn(
                  "h-9 w-full rounded-lg border border-input bg-white/70 px-3 text-sm outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as "admin" | "doctor")
                }
              >
                <option value="doctor">Doctor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="bg-white/70">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Creating…
                  </>
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: SuperAdminUserResponse | null
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const open = user !== null
  const [pw, setPw] = React.useState("")
  const [showPw, setShowPw] = React.useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      resetSuperAdminUserPassword(user!.id, { new_password: pw }),
    onSuccess: async () => {
      toast.success("Password reset. User must sign in again.")
      await onDone()
      onClose()
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPw("")
          setShowPw(false)
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/98 p-6 shadow-xl outline-none">
          <Dialog.Title className="font-semibold text-foreground text-lg">
            Reset password
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-muted-foreground text-sm">
            Set a new password for{" "}
            <span className="font-medium text-foreground">{user?.full_name}</span>.
            Existing sessions will be revoked.
          </Dialog.Description>
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="rp-pw">New password</Label>
              <div className="relative">
                <Input
                  id="rp-pw"
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className="bg-white/70 pr-10"
                  minLength={8}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline" className="bg-white/70">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Reset password"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SessionsModal({
  user,
  onClose,
  sessionsQuery,
  onRequestRevoke,
}: {
  user: SuperAdminUserResponse | null
  onClose: () => void
  sessionsQuery: UseQueryResult<SuperAdminSessionsResponse>
  onRequestRevoke: (u: SuperAdminUserResponse) => void
}) {
  const open = user !== null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-white/60 bg-white/98 shadow-xl outline-none">
          <div className="border-border/40 shrink-0 border-b px-6 py-4">
            <Dialog.Title className="font-semibold text-foreground text-lg">
              Active sessions
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-muted-foreground text-sm">
              {user?.full_name} — refresh tokens currently allowed for this user.
            </Dialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {sessionsQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : sessionsQuery.error ? (
              <p className="text-destructive text-sm">
                Unable to load sessions.
              </p>
            ) : (
              <>
                <p className="mb-3 font-medium text-foreground text-sm">
                  Count:{" "}
                  <span className="tabular-nums">
                    {sessionsQuery.data?.count ?? 0}
                  </span>
                </p>
                <ul className="space-y-2">
                  {(sessionsQuery.data?.sessions ?? []).map((s) => (
                    <li
                      key={s.jti}
                      className="rounded-lg border border-border/60 bg-white/60 px-3 py-2 font-mono text-[11px]"
                    >
                      <div className="break-all opacity-80">{s.jti}</div>
                      <div className="mt-1 text-muted-foreground">
                        Expires {formatExpires(s.expires_at)}
                      </div>
                    </li>
                  ))}
                </ul>
                {!(sessionsQuery.data?.sessions ?? []).length ? (
                  <p className="py-6 text-center text-muted-foreground text-sm">
                    No active refresh sessions.
                  </p>
                ) : null}
              </>
            )}
          </div>
          <div className="flex shrink-0 justify-between gap-2 border-border/40 border-t px-6 py-4">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" className="bg-white/70">
                Close
              </Button>
            </Dialog.Close>
            {user && (sessionsQuery.data?.count ?? 0) > 0 ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => onRequestRevoke(user)}
              >
                Revoke all sessions
              </Button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
