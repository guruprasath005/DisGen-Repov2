import { useQuery } from "@tanstack/react-query"
import type { LucideIcon } from "lucide-react"
import {
  CalendarDays,
  CheckCircle2,
  FileStack,
  Layers2,
  ScanLine,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { type AdminAnalyticsResponse, fetchAdminAnalytics } from "@/api/admin"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const ACCENT_ORANGE = "#f97316"
const ACCENT_ORANGE_SOFT = "#fb923c"
const CHART_GRID = "#e7e5e4"
const CHART_AXIS = "#78716c"

/** Distinct hues for pipeline segments */
const STATUS_PALETTE = [
  "#f97316",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#64748b",
  "#ec4899",
]

function utcDayStrings(days: number): string[] {
  const out: string[] = []
  const now = new Date()
  const base = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  for (let i = days - 1; i >= 0; i--) {
    const t = base - i * 86400000
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function fillUploadsSeries(
  rows: { date: string; count: number }[],
): { label: string; date: string; count: number }[] {
  const map = new Map(rows.map((r) => [r.date, r.count]))
  return utcDayStrings(30).map((date) => {
    let label = date
    try {
      label = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${date}T12:00:00Z`))
    } catch {
      /* keep iso */
    }
    return { label, date, count: map.get(date) ?? 0 }
  })
}

function formatOcr(confidence: number | null | undefined): string {
  if (confidence == null) return "—"
  const pct = confidence <= 1 ? confidence * 100 : confidence
  return `${pct.toFixed(1)}%`
}

function ocrQualityLabel(pct: number): string {
  if (pct >= 92) return "Excellent"
  if (pct >= 85) return "Strong"
  if (pct >= 75) return "Fair"
  return "Review"
}

type Accent = "orange" | "emerald" | "violet" | "slate"

function InsightStat({
  title,
  value,
  subtitle,
  icon: Icon,
  loading,
  accent = "orange",
}: {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  loading: boolean
  accent?: Accent
}) {
  const ring =
    accent === "orange"
      ? "from-primary/20 via-orange-400/10 to-transparent"
      : accent === "emerald"
        ? "from-emerald-500/20 via-emerald-400/10 to-transparent"
        : accent === "violet"
          ? "from-violet-500/20 via-violet-400/10 to-transparent"
          : "from-slate-400/15 via-slate-300/10 to-transparent"

  const iconBg =
    accent === "orange"
      ? "bg-primary/12 text-primary ring-primary/20"
      : accent === "emerald"
        ? "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25"
        : accent === "violet"
          ? "bg-violet-500/12 text-violet-700 ring-violet-500/25"
          : "bg-slate-500/10 text-slate-700 ring-slate-400/25"

  return (
    <Card className="relative overflow-hidden border-border/80 shadow-[var(--shadow-card)]">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90",
          ring,
        )}
        aria-hidden
      />
      <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {title}
        </CardTitle>
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
            iconBg,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </div>
      </CardHeader>
      <CardContent className="relative">
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

function useDerived(
  data: AdminAnalyticsResponse | undefined,
  series: { label: string; date: string; count: number }[],
  statusRows: { name: string; key: string; value: number }[],
) {
  return useMemo(() => {
    const total30 = series.reduce((a, r) => a + r.count, 0)
    const last7 = series.slice(-7)
    const prev7 = series.slice(-14, -7)
    const sumLast7 = last7.reduce((a, r) => a + r.count, 0)
    const sumPrev7 = prev7.reduce((a, r) => a + r.count, 0)
    const trendPct =
      sumPrev7 > 0
        ? Math.round(((sumLast7 - sumPrev7) / sumPrev7) * 100)
        : sumLast7 > 0
          ? 100
          : null

    let peak: { label: string; count: number; date: string } | null = null
    for (const r of series) {
      if (!peak || r.count > peak.count) peak = { ...r }
    }

    const statusSum = statusRows.reduce((a, r) => a + r.value, 0)
    const terminalKeys = new Set([
      "approved",
      "generated",
      "confirmed",
      "ready",
    ])
    let terminal = 0
    for (const r of statusRows) {
      if (terminalKeys.has(r.key.toLowerCase().replace(/ /g, "_")))
        terminal += r.value
    }
    const pipelineClear =
      statusSum > 0 ? Math.round((terminal / statusSum) * 100) : null

    const docs = data?.documents_total ?? 0
    const summaries = data?.summaries_approved ?? 0
    const summaryCoverage =
      docs > 0 ? Math.min(100, Math.round((summaries / docs) * 100)) : null

    const ocrPct = data?.avg_ocr_confidence
      ? data.avg_ocr_confidence <= 1
        ? data.avg_ocr_confidence * 100
        : data.avg_ocr_confidence
      : null

    const activeDays = series.filter((r) => r.count > 0).length
    const avgPerActiveDay =
      activeDays > 0 ? Math.round((total30 / activeDays) * 10) / 10 : 0

    return {
      total30,
      sumLast7,
      sumPrev7,
      trendPct,
      peak,
      pipelineClear,
      summaryCoverage,
      ocrPct,
      avgPerActiveDay,
      activeDays,
    }
  }, [data, series, statusRows])
}

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(249,115,22,0.22)",
  background: "rgba(255,255,255,0.97)",
  boxShadow: "0 12px 40px -16px rgba(15,23,42,0.18)",
}

export default function AnalyticsPage() {
  const analyticsQuery = useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: fetchAdminAnalytics,
  })

  const loading = analyticsQuery.isLoading
  const raw = analyticsQuery.data

  const uploadsSeries = useMemo(() => {
    if (!raw?.uploads_by_date?.length) return fillUploadsSeries([])
    return fillUploadsSeries([...raw.uploads_by_date])
  }, [raw?.uploads_by_date])

  const statusRows = useMemo(() => {
    if (!raw?.status_distribution) return []
    return Object.entries(raw.status_distribution)
      .map(([key, value]) => ({
        key,
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value,
      }))
      .sort((a, b) => b.value - a.value)
  }, [raw?.status_distribution])

  const schemeRows = useMemo(() => {
    if (!raw?.scheme_distribution) return []
    return Object.entries(raw.scheme_distribution)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [raw?.scheme_distribution])

  const pieData = useMemo(
    () => statusRows.map((r) => ({ name: r.name, value: r.value })),
    [statusRows],
  )

  const derived = useDerived(raw, uploadsSeries, statusRows)

  const meanDaily =
    uploadsSeries.length > 0 ? derived.total30 / uploadsSeries.length : 0

  const schemeKeyCount = raw?.scheme_distribution
    ? Object.keys(raw.scheme_distribution).length
    : 0

  const topScheme = schemeRows[0]

  return (
    <div className="space-y-10 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              Analytics
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Live pipeline intelligence: upload cadence, OCR quality, discharge
            status mix, and scheme usage — all scoped to your hospital tenant.
          </p>
        </div>
      </div>

      <section aria-labelledby="analytics-kpi">
        <h2 id="analytics-kpi" className="sr-only">
          Key metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InsightStat
            title="Total documents"
            value={raw ? String(raw.documents_total) : "—"}
            subtitle="All-time active records in scope."
            icon={FileStack}
            loading={loading}
            accent="orange"
          />
          <InsightStat
            title="Approved summaries"
            value={raw ? String(raw.summaries_approved) : "—"}
            subtitle={
              derived.summaryCoverage != null
                ? `~${derived.summaryCoverage}% of documents have an approved summary.`
                : "Clinical summaries signed off."
            }
            icon={CheckCircle2}
            loading={loading}
            accent="emerald"
          />
          <InsightStat
            title="Avg OCR confidence"
            value={formatOcr(raw?.avg_ocr_confidence)}
            subtitle={
              derived.ocrPct != null
                ? `${ocrQualityLabel(derived.ocrPct)} · across documents with OCR.`
                : "No OCR samples yet."
            }
            icon={ScanLine}
            loading={loading}
            accent="violet"
          />
          <InsightStat
            title="Schemes in use"
            value={raw ? String(schemeKeyCount) : "—"}
            subtitle={
              topScheme
                ? `Top: ${topScheme.name} (${topScheme.value}).`
                : "Discharge scheme identifiers."
            }
            icon={Layers2}
            loading={loading}
            accent="slate"
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/80 shadow-[var(--shadow-card)] lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-heading text-base">
                  Upload volume
                </CardTitle>
                <CardDescription>
                  Daily new documents · last 30 days (UTC). Gaps filled with zero
                  for trend clarity.
                </CardDescription>
              </div>
              {!loading ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                    <CalendarDays className="size-3.5 opacity-70" />
                    Last 7d:{" "}
                    <span className="tabular-nums text-foreground">
                      {derived.sumLast7}
                    </span>
                  </span>
                  {derived.trendPct != null ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold tabular-nums",
                        derived.trendPct >= 0
                          ? "bg-emerald-500/12 text-emerald-800 ring-1 ring-emerald-500/25"
                          : "bg-rose-500/10 text-rose-800 ring-1 ring-rose-400/25",
                      )}
                    >
                      {derived.trendPct >= 0 ? (
                        <TrendingUp className="size-3.5" />
                      ) : (
                        <TrendingDown className="size-3.5" />
                      )}
                      {derived.trendPct >= 0 ? "+" : ""}
                      {derived.trendPct}% vs prior week
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            {loading ? (
              <Skeleton className="h-[300px] w-full rounded-xl" />
            ) : derived.total30 === 0 ? (
              <p className="py-20 text-center text-muted-foreground text-sm">
                No uploads in the last 30 days. Data will appear as documents
                arrive.
              </p>
            ) : (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={uploadsSeries}
                    margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="uploadFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={ACCENT_ORANGE}
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor={ACCENT_ORANGE}
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: CHART_AXIS }}
                      tickLine={false}
                      axisLine={{ stroke: CHART_GRID }}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: CHART_AXIS }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [
                        typeof v === "number" ? v : Number(v),
                        "Uploads",
                      ]}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.date
                          ? `Date · ${payload[0].payload.date}`
                          : ""
                      }
                    />
                    <ReferenceLine
                      y={meanDaily}
                      stroke={ACCENT_ORANGE_SOFT}
                      strokeDasharray="4 4"
                      label={{
                        value: "30d avg / day",
                        position: "insideTopRight",
                        fill: CHART_AXIS,
                        fontSize: 10,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke={ACCENT_ORANGE}
                      strokeWidth={2.5}
                      fill="url(#uploadFill)"
                      dot={false}
                      activeDot={{
                        r: 5,
                        strokeWidth: 2,
                        stroke: "#fff",
                        fill: ACCENT_ORANGE,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex-1 border-border/80 shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="font-heading text-base">
                Cadence insights
              </CardTitle>
              <CardDescription>
                Derived from the same 30-day upload window.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <>
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-border/70 bg-muted/25 px-4 py-3">
                    <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                      Peak day
                    </p>
                    <p className="mt-1 font-semibold text-foreground text-lg tabular-nums">
                      {derived.peak && derived.peak.count > 0
                        ? `${derived.peak.count} uploads`
                        : "—"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {derived.peak && derived.peak.count > 0
                        ? derived.peak.label
                        : "No peaks yet"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/25 px-4 py-3">
                    <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                      30-day throughput
                    </p>
                    <p className="mt-1 font-semibold text-foreground text-lg tabular-nums">
                      {derived.total30} uploads
                    </p>
                    <p className="text-muted-foreground text-xs">
                      ~{meanDaily.toFixed(1)} / day avg · {derived.activeDays}{" "}
                      active days
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                    <p className="font-medium text-[11px] text-primary uppercase tracking-wide">
                      Pipeline clarity
                    </p>
                    <p className="mt-1 font-semibold text-foreground text-lg tabular-nums">
                      {derived.pipelineClear != null
                        ? `${derived.pipelineClear}%`
                        : "—"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Share in ready / confirmed / generated / approved states.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-2">
        <Card className="border-border/80 shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              Document status mix
            </CardTitle>
            <CardDescription>
              Distribution across pipeline stages · hover segments for counts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="mx-auto aspect-square max-h-[320px] w-full max-w-[320px] rounded-full" />
            ) : pieData.length === 0 ? (
              <p className="py-16 text-center text-muted-foreground text-sm">
                No documents recorded yet.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:justify-center">
                <div className="h-[280px] w-full max-w-[280px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={108}
                        paddingAngle={2}
                        dataKey="value"
                        strokeWidth={2}
                        stroke="rgba(255,255,255,0.85)"
                      >
                        {pieData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={STATUS_PALETTE[i % STATUS_PALETTE.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex w-full max-w-sm flex-col gap-2 lg:flex-1">
                  {statusRows.map((row, i) => {
                    const sum = statusRows.reduce((a, r) => a + r.value, 0)
                    const pct = sum ? Math.round((row.value / sum) * 100) : 0
                    return (
                      <li
                        key={row.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                STATUS_PALETTE[i % STATUS_PALETTE.length],
                            }}
                          />
                          <span className="truncate font-medium text-foreground">
                            {row.name}
                          </span>
                        </div>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {row.value}
                          </span>
                          <span className="text-xs"> ({pct}%)</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              Summaries by scheme
            </CardTitle>
            <CardDescription>
              Generated summary counts grouped by scheme identifier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full rounded-xl" />
            ) : schemeRows.length === 0 ? (
              <p className="py-16 text-center text-muted-foreground text-sm">
                No scheme usage recorded yet.
              </p>
            ) : (
              <div
                className="w-full"
                style={{
                  height: Math.min(400, Math.max(200, schemeRows.length * 44)),
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={schemeRows}
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={CHART_GRID}
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: CHART_AXIS }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 11, fill: CHART_AXIS }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[0, 10, 10, 0]} barSize={22}>
                      {schemeRows.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            i === 0
                              ? ACCENT_ORANGE
                              : `color-mix(in srgb, ${ACCENT_ORANGE} ${85 - i * 12}%, white)`
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {!loading && statusRows.length > 0 ? (
        <section>
          <h2 className="mb-3 font-heading text-sm text-foreground tracking-tight">
            Quick composition
          </h2>
          <div className="flex flex-wrap gap-2">
            {statusRows.map((row, i) => {
              const sum = statusRows.reduce((a, r) => a + r.value, 0)
              const pct = sum ? Math.round((row.value / sum) * 100) : 0
              return (
                <span
                  key={row.key}
                  className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-gradient-to-r from-muted/60 to-muted/30 px-3 py-1.5 font-medium text-foreground text-xs shadow-[var(--shadow-xs)]"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor:
                        STATUS_PALETTE[i % STATUS_PALETTE.length],
                    }}
                  />
                  {row.name}
                  <span className="tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </span>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
