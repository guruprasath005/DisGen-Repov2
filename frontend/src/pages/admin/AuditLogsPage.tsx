import { useQuery } from "@tanstack/react-query"
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Shield,
  User,
} from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { type AuditLogEntry, AUDIT_ACTION_OPTIONS, fetchAuditLogs } from "@/api/admin"
import {
  FilterDateInput,
  FilterPanel,
  FilterSelect,
  filterFieldClass,
  filterLabelClass,
} from "@/components/FilterPanel"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const PER_PAGE = 50

function formatAuditTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    const datePart = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d)
    const timePart = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d)
    return `${datePart}, ${timePart}`
  } catch {
    return iso
  }
}

/** Local calendar day key for grouping (browser TZ). */
function dayKeyLocal(iso: string): string {
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  } catch {
    return iso.slice(0, 10)
  }
}

function formatDayHeading(dayKey: string): string {
  try {
    const [y, m, d] = dayKey.split("-").map(Number)
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(dt)
  } catch {
    return dayKey
  }
}

function formatTimeOnly(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function roleBadgeClass(role: string): string {
  if (role === "super_admin")
    return "border-violet-300/60 bg-violet-500/12 text-violet-900"
  if (role === "admin") return "border-primary/35 bg-primary/10 text-primary"
  return "border-border bg-muted/70 text-muted-foreground"
}

type DocumentCluster = {
  kind: "document"
  documentId: string
  logs: AuditLogEntry[]
}

type GeneralCluster = {
  kind: "general"
  logs: AuditLogEntry[]
}

type Cluster = DocumentCluster | GeneralCluster

type DayGroup = {
  dayKey: string
  heading: string
  clusters: Cluster[]
  totalCount: number
}

function buildDayGroups(logs: AuditLogEntry[]): DayGroup[] {
  const byDay = new Map<string, AuditLogEntry[]>()
  for (const log of logs) {
    const key = dayKeyLocal(log.created_at)
    const arr = byDay.get(key)
    if (arr) arr.push(log)
    else byDay.set(key, [log])
  }

  const sortedKeys = [...byDay.keys()].sort((a, b) => b.localeCompare(a))

  return sortedKeys.map((dayKey) => {
    const dayLogs = byDay.get(dayKey) ?? []
    const sorted = [...dayLogs].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

    const docMap = new Map<string, AuditLogEntry[]>()
    const general: AuditLogEntry[] = []

    for (const log of sorted) {
      if (log.document_id) {
        const arr = docMap.get(log.document_id) ?? []
        arr.push(log)
        docMap.set(log.document_id, arr)
      } else general.push(log)
    }

    const clusters: Cluster[] = []

    for (const [documentId, docLogs] of docMap) {
      clusters.push({
        kind: "document",
        documentId,
        logs: [...docLogs].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        ),
      })
    }

    clusters.sort(
      (a, b) =>
        new Date(b.logs[0].created_at).getTime() -
        new Date(a.logs[0].created_at).getTime(),
    )

    if (general.length > 0) {
      clusters.push({ kind: "general", logs: general })
      clusters.sort(
        (a, b) =>
          new Date(b.logs[0].created_at).getTime() -
          new Date(a.logs[0].created_at).getTime(),
      )
    }

    return {
      dayKey,
      heading: formatDayHeading(dayKey),
      clusters,
      totalCount: dayLogs.length,
    }
  })
}

function actionTone(action: string): {
  pill: string
  dot: string
} {
  const a = action.toUpperCase()
  if (a === "LOGIN" || a === "LOGOUT" || a === "LOGIN_FAILED")
    return {
      pill: "border-slate-400/35 bg-slate-500/10 text-slate-800",
      dot: "bg-slate-500",
    }
  if (
    a === "UPLOAD" ||
    a === "OCR_COMPLETE" ||
    a === "EXTRACT_COMPLETE" ||
    a === "STRUCTURED_UPDATE" ||
    a === "STRUCTURED_CONFIRM"
  )
    return {
      pill: "border-sky-400/40 bg-sky-500/10 text-sky-950",
      dot: "bg-sky-500",
    }
  if (a === "GENERATE" || a === "GENERATE_FAILED" || a === "APPROVE")
    return {
      pill: "border-emerald-400/40 bg-emerald-500/12 text-emerald-950",
      dot: "bg-emerald-500",
    }
  if (
    a === "USER_CREATE" ||
    a === "USER_DEACTIVATE" ||
    a === "SCHEME_CREATE" ||
    a === "SCHEME_UPDATE" ||
    a === "SCHEME_DELETE" ||
    a === "SETTINGS_CHANGE" ||
    a === "RETENTION_ENFORCED"
  )
    return {
      pill: "border-amber-400/45 bg-amber-500/12 text-amber-950",
      dot: "bg-amber-500",
    }
  if (a === "PDF_DOWNLOAD")
    return {
      pill: "border-violet-400/40 bg-violet-500/12 text-violet-950",
      dot: "bg-violet-500",
    }
  if (a === "DOCUMENT_DELETE")
    return {
      pill: "border-rose-400/45 bg-rose-500/12 text-rose-950",
      dot: "bg-rose-500",
    }
  return {
    pill: "border-border bg-muted/50 text-foreground",
    dot: "bg-muted-foreground",
  }
}

function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 8)}…`
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())

  const queryParams = useMemo(
    () => ({
      page,
      per_page: PER_PAGE,
      action: actionFilter || null,
      from: fromDate || null,
      to: toDate || null,
    }),
    [page, actionFilter, fromDate, toDate],
  )

  const logsQuery = useQuery({
    queryKey: ["admin", "audit-logs", queryParams],
    queryFn: () => fetchAuditLogs(queryParams),
  })

  const data = logsQuery.data
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const pageSafe = Math.min(page, totalPages)

  const dayGroups = useMemo(
    () => (data?.logs.length ? buildDayGroups(data.logs) : []),
    [data?.logs],
  )

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleDay(dayKey: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(dayKey)) next.delete(dayKey)
      else next.add(dayKey)
      return next
    })
  }

  function expandAllDays() {
    setCollapsedDays(new Set())
  }

  function collapseAllDays() {
    setCollapsedDays(new Set(dayGroups.map((d) => d.dayKey)))
  }

  function clearFilters() {
    setActionFilter("")
    setFromDate("")
    setToDate("")
    setPage(1)
  }

  const rangeStart = total === 0 ? 0 : (pageSafe - 1) * PER_PAGE + 1
  const rangeEnd = Math.min(pageSafe * PER_PAGE, total)

  const activeFilterCount =
    (actionFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0)

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <ClipboardList className="size-5" aria-hidden />
            </div>
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              Audit logs
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Immutable security trail. Entries are grouped by{" "}
            <span className="font-medium text-foreground">day</span>, then by{" "}
            <span className="font-medium text-foreground">document</span> so
            related workflow steps read as one story instead of a flat list.
          </p>
        </div>
      </div>

      <FilterPanel
        description="Results update as you change action type or the date window. Pagination resets when filters change."
        activeFilterCount={activeFilterCount}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={activeFilterCount === 0}
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        }
      >
        <div className={filterFieldClass}>
          <label htmlFor="audit-action" className={filterLabelClass}>
            Action
          </label>
          <FilterSelect
            id="audit-action"
            className="min-w-[220px]"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All actions</option>
            {AUDIT_ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className={filterFieldClass}>
          <label htmlFor="audit-from" className={filterLabelClass}>
            From date
          </label>
          <FilterDateInput
            id="audit-from"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className={filterFieldClass}>
          <label htmlFor="audit-to" className={filterLabelClass}>
            To date
          </label>
          <FilterDateInput
            id="audit-to"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </FilterPanel>

      {data && dayGroups.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Day groups:</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={expandAllDays}
          >
            Expand all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={collapseAllDays}
          >
            Collapse all
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden border-border/80 shadow-[var(--shadow-card)]">
        <CardContent className="p-0">
          <div className="p-5 sm:p-6">
            {logsQuery.isLoading ? (
              <div className="space-y-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-8 w-48 rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-xl" />
                  </div>
                ))}
              </div>
            ) : logsQuery.error ? (
              <p className="py-16 text-center text-destructive text-sm">
                Unable to load audit logs. Check permissions or try again.
              </p>
            ) : !data?.logs.length ? (
              <p className="py-16 text-center text-muted-foreground text-sm">
                No audit entries match your filters. Adjust dates or action type,
                or clear filters to see more activity.
              </p>
            ) : (
              <div className="space-y-8">
                {dayGroups.map((day) => {
                  const dayCollapsed = collapsedDays.has(day.dayKey)
                  return (
                    <section
                      key={day.dayKey}
                      aria-labelledby={`audit-day-${day.dayKey}`}
                      className="rounded-2xl border border-border/70 bg-gradient-to-b from-muted/25 to-transparent p-1 shadow-[var(--shadow-xs)]"
                    >
                      <button
                        type="button"
                        id={`audit-day-${day.dayKey}`}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                        )}
                        onClick={() => toggleDay(day.dayKey)}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background ring-1 ring-border/80">
                            <CalendarDays
                              className="size-[18px] text-primary"
                              aria-hidden
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-base text-foreground tracking-tight">
                              {day.heading}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {day.totalCount} event
                              {day.totalCount === 1 ? "" : "s"} ·{" "}
                              {day.clusters.length} group
                              {day.clusters.length === 1 ? "" : "s"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {dayCollapsed ? (
                            <ChevronRight className="size-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-5 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {!dayCollapsed ? (
                        <div className="space-y-4 px-3 pb-4 pt-1 sm:px-4">
                          {day.clusters.map((cluster, ci) => (
                            <div
                              key={
                                cluster.kind === "document"
                                  ? cluster.documentId
                                  : `general-${day.dayKey}-${ci}`
                              }
                              className="overflow-hidden rounded-xl border border-border/75 bg-background/85 shadow-[var(--shadow-xs)]"
                            >
                              {cluster.kind === "document" ? (
                                <div className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-b bg-muted/15 px-4 py-3">
                                  <div className="flex min-w-0 items-center gap-2.5">
                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/18">
                                      <FileText className="size-4" aria-hidden />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-semibold text-foreground text-sm">
                                        Document workflow
                                      </p>
                                      <p className="truncate font-mono text-muted-foreground text-[11px]">
                                        {shortId(cluster.documentId)}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-muted/80 px-2.5 py-0.5 font-medium text-muted-foreground text-[11px]">
                                      {cluster.logs.length} step
                                      {cluster.logs.length === 1 ? "" : "s"}
                                    </span>
                                    <Link
                                      to={`/documents/${cluster.documentId}`}
                                      className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs shadow-[var(--shadow-xs)] transition-opacity hover:opacity-92"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      Open document
                                    </Link>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2.5 border-border/60 border-b bg-muted/15 px-4 py-3">
                                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-700 ring-1 ring-slate-400/25">
                                    <Shield className="size-4" aria-hidden />
                                  </div>
                                  <div>
                                    <p className="font-semibold text-foreground text-sm">
                                      Platform & account
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                      Logins, admin actions, schemes — no document
                                      context.
                                    </p>
                                  </div>
                                  <span className="ml-auto rounded-full bg-muted/80 px-2.5 py-0.5 font-medium text-muted-foreground text-[11px]">
                                    {cluster.logs.length} event
                                    {cluster.logs.length === 1 ? "" : "s"}
                                  </span>
                                </div>
                              )}

                              <ul className="divide-y divide-border/55">
                                {cluster.logs.map((row, ri) => {
                                  const open = expanded.has(row.id)
                                  const tone = actionTone(row.action)
                                  const isLast = ri === cluster.logs.length - 1
                                  return (
                                    <Fragment key={row.id}>
                                      <li>
                                        <button
                                          type="button"
                                          className={cn(
                                            "flex w-full gap-3 px-4 py-3.5 text-left transition-colors sm:gap-4",
                                            open
                                              ? "bg-primary/[0.05]"
                                              : "hover:bg-muted/30",
                                          )}
                                          onClick={() => toggleRow(row.id)}
                                        >
                                          <div className="flex shrink-0 flex-col items-center pt-0.5">
                                            <span
                                              className={cn(
                                                "size-2.5 shrink-0 rounded-full ring-4 ring-background",
                                                tone.dot,
                                              )}
                                              aria-hidden
                                            />
                                            {!isLast ? (
                                              <span
                                                className="mt-1 w-px flex-1 min-h-[28px] bg-border/90"
                                                aria-hidden
                                              />
                                            ) : null}
                                          </div>

                                          <div className="min-w-0 flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                              <span className="inline-flex items-center gap-1 font-mono text-muted-foreground text-xs tabular-nums">
                                                <Clock className="size-3.5 opacity-70" />
                                                {formatTimeOnly(row.created_at)}
                                              </span>
                                              <span
                                                className={cn(
                                                  "rounded-md border px-2 py-0.5 font-mono font-semibold text-[10px] uppercase tracking-wide",
                                                  tone.pill,
                                                )}
                                              >
                                                {row.action.replace(/_/g, " ")}
                                              </span>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="inline-flex items-center gap-1.5 text-foreground text-sm">
                                                <User className="size-3.5 text-muted-foreground" />
                                                <span className="font-medium">
                                                  {row.username}
                                                </span>
                                                <span
                                                  className={cn(
                                                    "rounded-md border px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                                                    roleBadgeClass(row.role),
                                                  )}
                                                >
                                                  {row.role.replace(/_/g, " ")}
                                                </span>
                                              </span>
                                              <span className="font-mono text-muted-foreground text-[11px]">
                                                {row.ip_address}
                                              </span>
                                            </div>

                                            <p className="text-muted-foreground text-xs">
                                              {row.details
                                                ? `${Object.keys(row.details).length} detail field(s) — tap to expand`
                                                : "No JSON payload"}
                                            </p>
                                          </div>

                                          <div className="flex shrink-0 items-start pt-1">
                                            {open ? (
                                              <ChevronDown className="size-4 text-muted-foreground" />
                                            ) : (
                                              <ChevronRight className="size-4 text-muted-foreground" />
                                            )}
                                          </div>
                                        </button>
                                      </li>
                                      {open ? (
                                        <li className="bg-muted/20 px-4 py-4 pl-14 sm:pl-16">
                                          <p className="mb-2 flex items-center gap-2 font-medium text-foreground text-xs">
                                            Full timestamp:{" "}
                                            <span className="font-mono text-muted-foreground">
                                              {formatAuditTimestamp(
                                                row.created_at,
                                              )}
                                            </span>
                                          </p>
                                          {row.document_id ? (
                                            <p className="mb-2 text-xs">
                                              <Link
                                                to={`/documents/${row.document_id}`}
                                                className="font-medium text-primary underline-offset-4 hover:underline"
                                              >
                                                View linked document
                                              </Link>
                                            </p>
                                          ) : null}
                                          <p className="mb-2 font-medium text-foreground text-xs">
                                            Details (JSON)
                                          </p>
                                          <pre className="max-h-72 overflow-auto rounded-xl border border-border/70 bg-background p-4 font-mono text-[11px] leading-relaxed shadow-inner">
                                            {row.details
                                              ? JSON.stringify(
                                                  row.details,
                                                  null,
                                                  2,
                                                )
                                              : "null"}
                                          </pre>
                                        </li>
                                      ) : null}
                                    </Fragment>
                                  )
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            )}
          </div>

          {!logsQuery.isLoading && data && data.logs.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-border/55 border-t bg-muted/15 px-5 py-4 sm:px-6">
              <p className="text-muted-foreground text-xs">
                Showing{" "}
                <span className="font-medium text-foreground">{rangeStart}</span>
                –
                <span className="font-medium text-foreground">{rangeEnd}</span>{" "}
                of{" "}
                <span className="font-medium text-foreground">{total}</span>{" "}
                entries on this page · grouped view
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pageSafe <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
