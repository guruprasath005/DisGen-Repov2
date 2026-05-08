import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  PieChart,
  ScanLine,
  Shield,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react"
import { useMemo } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  fetchDocumentStats,
  fetchDocuments,
  type StatsResponse,
} from "@/api/documents"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

const DASHBOARD_STATUS_ORDER = [
  "pending",
  "processing",
  "ready",
  "confirmed",
  "generating",
  "generated",
  "approved",
  "failed",
] as const

const CHART_BAR = "#f97316"
const CHART_GRID = "#e2e8f0"

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function formatUploadedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function utcWeekSeries(
  rows: { date: string; count: number }[],
): { label: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.date, r.count]))
  const out: { label: string; count: number }[] = []
  const now = new Date()
  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  for (let i = 6; i >= 0; i--) {
    const t = base - i * 86400000
    const iso = new Date(t).toISOString().slice(0, 10)
    let label = iso
    try {
      label = new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
      }).format(new Date(`${iso}T12:00:00Z`))
    } catch {
      /* keep iso */
    }
    out.push({ label, count: map.get(iso) ?? 0 })
  }
  return out
}

function statusSegmentClass(status: string): string {
  const s = status.toLowerCase()
  if (s === "approved") return "bg-emerald-600"
  if (s === "failed" || s === "ocr_failed") return "bg-rose-600"
  if (s === "generated" || s === "generating") return "bg-violet-600"
  if (s === "ready" || s === "confirmed") return "bg-sky-600"
  if (s === "pending" || s === "processing") return "bg-slate-500"
  return "bg-muted-foreground/70"
}

function rowStatusClass(status: string): string {
  const s = status.toLowerCase()
  if (s === "approved")
    return "border-transparent bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-800/40 dark:bg-emerald-600"
  if (s === "failed" || s === "ocr_failed")
    return "border-transparent bg-rose-700 text-white shadow-sm ring-1 ring-rose-800/40 dark:bg-rose-600"
  if (s === "generated" || s === "generating")
    return "border-transparent bg-violet-700 text-white shadow-sm ring-1 ring-violet-800/40 dark:bg-violet-600"
  if (s === "ready" || s === "confirmed")
    return "border-transparent bg-sky-700 text-white shadow-sm ring-1 ring-sky-800/40 dark:bg-sky-600"
  if (s === "pending" || s === "processing")
    return "border-transparent bg-slate-600 text-white shadow-sm ring-1 ring-slate-700/40 dark:bg-slate-500"
  if (s === "ocr_complete" || s === "extracting")
    return "border-transparent bg-amber-700 text-white shadow-sm ring-1 ring-amber-800/40 dark:bg-amber-600"
  return "border-border bg-muted font-medium text-foreground"
}

type Accent = "slate" | "emerald" | "violet" | "sky"

function DashMetric({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  accent,
}: {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  loading: boolean
  accent: Accent
}) {
  const ring =
    accent === "slate"
      ? "from-slate-400/18 via-slate-300/10 to-transparent"
      : accent === "emerald"
        ? "from-emerald-500/18 via-emerald-400/10 to-transparent"
        : accent === "violet"
          ? "from-violet-500/18 via-violet-400/10 to-transparent"
          : "from-sky-500/18 via-sky-400/10 to-transparent"

  const iconWrap =
    accent === "slate"
      ? "bg-slate-600/16 text-slate-900 shadow-sm ring-2 ring-slate-600/35 dark:bg-slate-500/22 dark:text-slate-50 dark:ring-slate-400/45"
      : accent === "emerald"
        ? "bg-emerald-600/16 text-emerald-950 shadow-sm ring-2 ring-emerald-600/35 dark:bg-emerald-500/22 dark:text-emerald-50 dark:ring-emerald-400/45"
        : accent === "violet"
          ? "bg-violet-600/16 text-violet-950 shadow-sm ring-2 ring-violet-600/35 dark:bg-violet-500/22 dark:text-violet-50 dark:ring-violet-400/45"
          : "bg-sky-600/16 text-sky-950 shadow-sm ring-2 ring-sky-600/35 dark:bg-sky-500/22 dark:text-sky-50 dark:ring-sky-400/45"

  return (
    <Card className="relative overflow-hidden border-border/80 shadow-[var(--shadow-card)]">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-95",
          ring,
        )}
        aria-hidden
      />
      <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
          {title}
        </CardTitle>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            iconWrap,
          )}
        >
          <Icon className="size-[18px] stroke-[2.25px]" aria-hidden />
        </div>
      </CardHeader>
      <CardContent className="relative pb-5">
        {loading ? (
          <Skeleton className="h-9 w-28 rounded-md" />
        ) : (
          <>
            <p className="font-semibold text-3xl text-foreground tabular-nums tracking-tight">
              {value}
            </p>
            {subtitle ? (
              <p className="mt-2 text-muted-foreground text-xs leading-snug">
                {subtitle}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

const tooltipStyle = {
  borderRadius: 10,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  boxShadow: "var(--shadow-md)",
}

/** Outline quick links: Lucide inherits faint grey — force primary stroke + weight. */
const quickLinkClass =
  "gap-2 text-foreground shadow-[var(--shadow-xs)] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary [&_svg]:stroke-[2.25px]"

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canViewStats = Boolean(user)

  // Poll every 4 s while any document is actively processing or generating,
  // stop automatically once all jobs are done.
  const ACTIVE_STATUSES = new Set(["processing", "extracting", "generating"])

  const documentsQuery = useQuery({
    queryKey: ["documents", "list", 1, 10],
    queryFn: () => fetchDocuments({ page: 1, per_page: 10 }),
    refetchInterval: (query) =>
      query.state.data?.documents.some((d) => ACTIVE_STATUSES.has(String(d.status)))
        ? 4000
        : false,
  })

  const hasActiveJobs = documentsQuery.data?.documents.some((d) =>
    ACTIVE_STATUSES.has(String(d.status)),
  )

  const statsQuery = useQuery({
    queryKey: ["documents", "stats"],
    queryFn: fetchDocumentStats,
    enabled: Boolean(canViewStats),
    refetchInterval: hasActiveJobs ? 4000 : false,
  })

  const stats = statsQuery.data
  const statsLoading = canViewStats && statsQuery.isLoading

  const uploadsWeekSum = (s: StatsResponse | undefined) =>
    s?.uploads_last_7_days.reduce((acc, d) => acc + d.count, 0) ?? 0

  const statTotalDisplay = (): string => {
    if (canViewStats && stats) return String(stats.total_documents)
    if (!canViewStats && documentsQuery.data)
      return String(documentsQuery.data.total)
    return "—"
  }

  const statApprovedDisplay = (): string => {
    if (stats) return String(stats.by_status.approved ?? 0)
    return "—"
  }

  const statOcrDisplay = (): string => {
    const v = stats?.avg_ocr_confidence
    if (v == null) return "—"
    const pct = v <= 1 ? v * 100 : v
    return `${pct.toFixed(1)}%`
  }

  const statUploadsWeekDisplay = (): string => {
    if (!stats) return "—"
    return String(uploadsWeekSum(stats))
  }

  const ocrSubtitle = (): string | undefined => {
    const v = stats?.avg_ocr_confidence
    if (v == null) return "Across documents with OCR scores."
    const pct = v <= 1 ? v * 100 : v
    if (pct >= 92) return "Excellent signal quality across OCR samples."
    if (pct >= 85) return "Strong extraction confidence."
    if (pct >= 75) return "Review edge-case scans if summaries drift."
    return "Consider rescanning low-legibility uploads."
  }

  const statsRowLoading =
    statsLoading || (!canViewStats && documentsQuery.isLoading)

  const byStatusForPills: Record<string, number> | undefined = stats?.by_status

  const pipelineSegments = useMemo(() => {
    if (!byStatusForPills) return []
    const ordered = DASHBOARD_STATUS_ORDER.filter(
      (key) => (byStatusForPills[key] ?? 0) > 0,
    )
    const extra = Object.keys(byStatusForPills).filter(
      (k) =>
        !DASHBOARD_STATUS_ORDER.includes(
          k as (typeof DASHBOARD_STATUS_ORDER)[number],
        ) &&
        (byStatusForPills[k] ?? 0) > 0,
    )
    const keys = [...ordered, ...extra] as string[]
    const total = Object.values(byStatusForPills).reduce((a, n) => a + n, 0)
    return keys.map((key) => ({
      key,
      count: byStatusForPills[key] ?? 0,
      pct: total > 0 ? Math.round(((byStatusForPills[key] ?? 0) / total) * 100) : 0,
    }))
  }, [byStatusForPills])

  const statusTotal = pipelineSegments.reduce((a, s) => a + s.count, 0)

  const chartData = useMemo(
    () =>
      stats?.uploads_last_7_days
        ? utcWeekSeries(stats.uploads_last_7_days)
        : utcWeekSeries([]),
    [stats?.uploads_last_7_days],
  )

  const docs = documentsQuery.data?.documents ?? []
  const tableLoading = documentsQuery.isLoading

  const approvedCount = stats?.by_status.approved ?? 0
  const totalForRate = stats?.total_documents ?? 0
  const approvalHint =
    canViewStats && totalForRate > 0
      ? `${Math.min(100, Math.round((approvedCount / totalForRate) * 100))}% of corpus carries an approved summary.`
      : undefined

  return (
    <div className="space-y-10 pb-12">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/14 text-primary shadow-sm ring-2 ring-primary/35">
              <LayoutDashboard className="size-[22px] stroke-[2.25px]" aria-hidden />
            </div>
            <div>
              <h1 className="font-semibold text-2xl text-foreground tracking-tight">
                <span className="block">{greeting()}</span>
                {user?.full_name ? (
                  <span className="mt-1 block font-normal text-muted-foreground text-base tracking-normal">
                    {user.full_name}
                  </span>
                ) : null}
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Operational overview of the discharge document pipeline — ingestion
            throughput, pipeline distribution, and the latest records requiring
            clinical attention.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
          <Button asChild variant="outline" size="sm" className={quickLinkClass}>
            <Link to="/upload">
              <Upload aria-hidden />
              Upload
            </Link>
          </Button>
          {(user?.role === "admin" || user?.role === "super_admin") ? (
            <>
              <Button asChild variant="outline" size="sm" className={quickLinkClass}>
                <Link to="/admin/analytics">
                  <PieChart aria-hidden />
                  Analytics
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={quickLinkClass}>
                <Link to="/admin/audit-logs">
                  <ClipboardList aria-hidden />
                  Audit
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={quickLinkClass}>
                <Link to="/admin/health">
                  <Activity aria-hidden />
                  Health
                </Link>
              </Button>
            </>
          ) : null}
          {user?.role === "super_admin" ? (
            <>
              <Button asChild variant="outline" size="sm" className={quickLinkClass}>
                <Link to="/superadmin/users">
                  <Users aria-hidden />
                  Users
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className={quickLinkClass}>
                <Link to="/superadmin/hospital">
                  <Building2 aria-hidden />
                  Hospital
                </Link>
              </Button>
            </>
          ) : null}
          <Button asChild variant="outline" size="sm" className={quickLinkClass}>
            <Link to="/profile">
              <Shield aria-hidden />
              Profile
            </Link>
          </Button>
        </div>
      </div>

      {user?.role === "doctor" ? (
        <Card className="border-border/80 bg-muted/30 shadow-[var(--shadow-card)]">
          <CardContent className="flex gap-3 py-4">
            <BarChart3 className="mt-0.5 size-5 shrink-0 text-primary stroke-[2.25px]" aria-hidden />
            <p className="text-muted-foreground text-sm leading-relaxed">
              Metrics below reflect your own documents and submissions.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="dash-stats-heading">
        <h2 id="dash-stats-heading" className="sr-only">
          Summary statistics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashMetric
            title="Documents in corpus"
            value={statTotalDisplay()}
            subtitle={
              user?.role === "doctor"
                ? "Documents uploaded by you."
                : "Active records excluding soft-deleted artefacts."
            }
            icon={FileStack}
            loading={statsRowLoading}
            accent="slate"
          />
          <DashMetric
            title="Approved summaries"
            value={statApprovedDisplay()}
            subtitle={approvalHint}
            icon={CheckCircle2}
            loading={statsRowLoading}
            accent="emerald"
          />
          <DashMetric
            title="Mean OCR confidence"
            value={statOcrDisplay()}
            subtitle={ocrSubtitle()}
            icon={ScanLine}
            loading={statsRowLoading}
            accent="violet"
          />
          <DashMetric
            title="Uploads · 7 days"
            value={statUploadsWeekDisplay()}
            subtitle={
              canViewStats && stats
                ? "Rolling UTC window aligned with analytics."
                : undefined
            }
            icon={TrendingUp}
            loading={statsRowLoading}
            accent="sky"
          />
        </div>
      </section>

      {canViewStats ? (
        <section aria-labelledby="dash-activity-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2
                id="dash-activity-heading"
                className="font-heading font-semibold text-base text-foreground tracking-tight"
              >
                Weekly ingestion cadence
              </h2>
              <p className="mt-1 text-muted-foreground text-xs">
                Net-new documents stamped per calendar day (UTC).
              </p>
            </div>
          </div>
          <Card className="border-border/80 shadow-[var(--shadow-card)]">
            <CardContent className="px-4 pb-6 pt-6 sm:px-6">
              {statsLoading ? (
                <Skeleton className="h-[200px] w-full rounded-xl" />
              ) : chartData.every((d) => d.count === 0) ? (
                <p className="py-14 text-center text-muted-foreground text-sm">
                  No uploads recorded in the last seven days.
                </p>
              ) : (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={CHART_GRID}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={{ stroke: CHART_GRID }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={false}
                        contentStyle={tooltipStyle}
                        formatter={(v) => [
                          typeof v === "number" ? v : Number(v),
                          "Uploads",
                        ]}
                      />
                      <Bar
                        dataKey="count"
                        fill={CHART_BAR}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="dash-status-heading">
        <div className="mb-4">
          <h2
            id="dash-status-heading"
            className="font-heading font-semibold text-base text-foreground tracking-tight"
          >
            Pipeline distribution
          </h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Relative mix of discharge artefacts by workflow state.
          </p>
        </div>

        {statsLoading ? (
          <Skeleton className="h-36 w-full rounded-xl" />
        ) : pipelineSegments.length === 0 ? (
          <Card className="border-border/80 shadow-[var(--shadow-card)]">
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No documents recorded yet. Upload a discharge PDF to initialise the
              pipeline.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/80 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-5 px-4 py-6 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-muted-foreground uppercase tracking-wide">
                  Composition
                </span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{statusTotal}</span>{" "}
                  documents
                </span>
              </div>
              <div
                className="flex h-4 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border/60"
                role="img"
                aria-label="Document status distribution"
              >
                {pipelineSegments.map((seg) =>
                  seg.count > 0 ? (
                    <div
                      key={seg.key}
                      className={cn(
                        "min-w-px transition-[flex-grow] duration-300 first:rounded-l-full last:rounded-r-full",
                        statusSegmentClass(seg.key),
                      )}
                      style={{
                        flexGrow: seg.count,
                        flexBasis: 0,
                      }}
                      title={`${formatStatusLabel(seg.key)}: ${seg.count} (${seg.pct}%)`}
                    />
                  ) : null,
                )}
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {pipelineSegments.map((seg) => (
                  <li
                    key={seg.key}
                    className="flex items-center gap-2 text-foreground text-sm"
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full ring-1 ring-black/10",
                        statusSegmentClass(seg.key),
                      )}
                    />
                    <span className="font-semibold">
                      {formatStatusLabel(seg.key)}
                    </span>
                    <span className="tabular-nums">
                      <span className="font-medium">{seg.count}</span>
                      <span className="text-muted-foreground"> ({seg.pct}%)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="dash-recent-heading">
        <Card className="overflow-hidden border-border/80 shadow-[var(--shadow-card)]">
          <CardHeader className="border-border/55 flex flex-row flex-wrap items-start justify-between gap-4 border-b bg-muted/[0.35] pb-4">
            <div>
              <CardTitle
                id="dash-recent-heading"
                className="font-heading text-lg tracking-tight"
              >
                Recent documents
              </CardTitle>
              <CardDescription className="mt-1 max-w-xl">
                Latest submissions across the tenant. Select a row to open the case
                workspace.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-border/55 border-b bg-muted/25 text-left">
                    <th className="px-5 py-3.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                      Filename
                    </th>
                    <th className="px-5 py-3.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                      Status
                    </th>
                    <th className="px-5 py-3.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                      Pages
                    </th>
                    <th className="px-5 py-3.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                      OCR
                    </th>
                    <th className="px-5 py-3.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                      Uploaded
                    </th>
                    <th className="w-12 px-3 py-3.5" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {tableLoading
                    ? Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-border/40 border-b">
                          <td className="px-5 py-3" colSpan={6}>
                            <Skeleton className="h-10 w-full rounded-lg" />
                          </td>
                        </tr>
                      ))
                    : docs.length === 0
                      ? (
                        <tr>
                          <td
                            className="px-5 py-14 text-center text-muted-foreground"
                            colSpan={6}
                          >
                            No documents yet. Start by uploading a discharge PDF from
                            the upload workspace.
                          </td>
                        </tr>
                      )
                      : docs.map((doc) => (
                          <tr
                            key={doc.id}
                            className="cursor-pointer border-border/40 border-b transition-colors hover:bg-muted/40"
                            onClick={() => navigate(`/documents/${doc.id}`)}
                          >
                            <td className="max-w-[240px] truncate px-5 py-3.5 font-medium text-foreground">
                              {doc.filename}
                            </td>
                            <td className="px-5 py-3.5">
                              <span
                                className={cn(
                                  "inline-flex rounded-lg border px-2.5 py-1 font-semibold text-[11px] uppercase tracking-wide",
                                  rowStatusClass(String(doc.status)),
                                )}
                              >
                                {formatStatusLabel(String(doc.status))}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                              {doc.pages ?? "—"}
                            </td>
                            <td className="px-5 py-3.5 tabular-nums text-muted-foreground">
                              {doc.ocr_confidence == null
                                ? "—"
                                : `${(doc.ocr_confidence <= 1 ? doc.ocr_confidence * 100 : doc.ocr_confidence).toFixed(1)}%`}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3.5 tabular-nums text-muted-foreground">
                              {formatUploadedAt(doc.created_at)}
                            </td>
                            <td className="px-3 py-3.5 text-muted-foreground">
                              <ChevronRight className="size-4 text-primary stroke-[2.25px] opacity-90" aria-hidden />
                            </td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>

      {!tableLoading && docs.length > 0 ? (
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <ArrowRight className="size-3.5 shrink-0 text-primary stroke-[2.25px] opacity-90" aria-hidden />
          Tip: open any document to review structured fields, generate summaries,
          and track approval status.
        </p>
      ) : null}
    </div>
  )
}
