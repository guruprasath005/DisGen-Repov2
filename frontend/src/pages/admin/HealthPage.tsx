import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Loader2,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react"

import type { ServiceHealth } from "@/api/admin"
import { fetchAdminHealth } from "@/api/admin"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const SERVICE_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  redis: "Redis",
  minio: "MinIO",
  chromadb: "ChromaDB",
  celery: "Celery Worker",
  azure_document_intelligence: "Azure Document Intelligence",
  azure_openai: "Azure OpenAI",
}

function formatServiceTitle(key: string): string {
  return (
    SERVICE_LABELS[key] ??
    key
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  )
}

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (h || d) parts.push(`${h}h`)
  parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(" ")
}

function formatChecked(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(ts))
  } catch {
    return "—"
  }
}

function StatusGlyph({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === "ok")
    return <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
  if (s === "degraded")
    return <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />
  if (s === "error")
    return <XCircle className="size-5 shrink-0 text-red-600" aria-hidden />
  return <CircleSlash className="size-5 shrink-0 text-muted-foreground" aria-hidden />
}

function overallDescription(overall: string): string {
  if (overall === "ok")
    return "All monitored dependencies responded within thresholds."
  if (overall === "degraded")
    return "One or more non-critical services reported latency or partial availability."
  return "A critical dependency failed its health probe — escalate immediately."
}

export default function HealthPage() {
  const healthQuery = useQuery({
    queryKey: ["admin", "health"],
    queryFn: fetchAdminHealth,
    refetchInterval: 30_000,
  })

  const loading = healthQuery.isLoading
  const health = healthQuery.data

  const serviceEntries = health?.services
    ? Object.entries(health.services).sort(([a], [b]) =>
        formatServiceTitle(a).localeCompare(formatServiceTitle(b)),
      )
    : []

  const overall = health?.overall ?? "error"

  const bannerTint =
    overall === "ok"
      ? "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.07] via-emerald-500/[0.02] to-transparent"
      : overall === "degraded"
        ? "border-amber-500/25 bg-gradient-to-br from-amber-500/[0.09] via-amber-500/[0.03] to-transparent"
        : "border-red-500/25 bg-gradient-to-br from-red-500/[0.08] via-red-500/[0.03] to-transparent"

  return (
    <div className="space-y-10 pb-12">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <Activity className="size-5" aria-hidden />
            </div>
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              System health
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Operational status of platform dependencies used for ingestion,
            inference, and storage. Results refresh automatically every 30
            seconds; manual refresh does not interrupt clinical workflows.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-2 shadow-[var(--shadow-xs)]"
          disabled={healthQuery.isFetching}
          onClick={() => void healthQuery.refetch()}
        >
          {healthQuery.isFetching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          Refresh now
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-36 w-full rounded-2xl" />
      ) : (
        <Card
          className={cn(
            "overflow-hidden border shadow-[var(--shadow-card)]",
            bannerTint,
          )}
          role="status"
        >
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-start gap-4">
                <StatusGlyph
                  status={
                    overall === "ok"
                      ? "ok"
                      : overall === "degraded"
                        ? "degraded"
                        : "error"
                  }
                />
                <div className="min-w-0">
                  <p className="font-heading font-semibold text-foreground text-lg tracking-tight">
                    Operational posture:{" "}
                    <span className="uppercase tracking-wide">{overall}</span>
                  </p>
                  <p className="mt-1 max-w-xl text-muted-foreground text-sm leading-relaxed">
                    {overallDescription(overall)}
                  </p>
                </div>
              </div>
              <dl className="grid gap-4 sm:grid-cols-3 lg:flex lg:shrink-0 lg:gap-8">
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-sm">
                  <dt className="flex items-center gap-1.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                    <Clock className="size-3 opacity-70" aria-hidden />
                    Last probe
                  </dt>
                  <dd className="mt-1 font-medium text-foreground text-sm tabular-nums">
                    {healthQuery.dataUpdatedAt
                      ? formatChecked(healthQuery.dataUpdatedAt)
                      : "—"}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-sm">
                  <dt className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                    API uptime
                  </dt>
                  <dd className="mt-1 font-semibold text-foreground text-sm tabular-nums tracking-tight">
                    {health ? formatUptime(health.uptime_seconds) : "—"}
                  </dd>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-sm">
                  <dt className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide">
                    Dependencies
                  </dt>
                  <dd className="mt-1 font-semibold text-foreground text-sm tabular-nums">
                    {serviceEntries.length}
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>
      )}

      {healthQuery.isFetching && !loading ? (
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
          Updating probe results…
        </p>
      ) : null}

      <section>
        <div className="mb-5 flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground ring-1 ring-border/70">
            <Server className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-foreground text-base tracking-tight">
              Dependency checks
            </h2>
            <p className="text-muted-foreground text-xs">
              Latency reflects the health-check round-trip from this API layer.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))
            : serviceEntries.map(([key, svc]) => (
                <ServiceCard key={key} nameKey={key} svc={svc} />
              ))}
        </div>
      </section>
    </div>
  )
}

function ServiceCard({
  nameKey,
  svc,
}: {
  nameKey: string
  svc: ServiceHealth
}) {
  const label = svc.status.toLowerCase()

  const accent =
    label === "ok"
      ? "border-l-emerald-500"
      : label === "degraded"
        ? "border-l-amber-500"
        : label === "error"
          ? "border-l-red-500"
          : "border-l-muted-foreground"

  return (
    <Card
      className={cn(
        "border-border/80 border-l-4 bg-card shadow-[var(--shadow-card)] transition-shadow hover:shadow-md",
        accent,
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="font-heading text-[15px] leading-snug">
          {formatServiceTitle(nameKey)}
        </CardTitle>
        <CardDescription className="flex items-center gap-2 pt-1 font-medium capitalize">
          <StatusGlyph status={svc.status} />
          <span>{svc.status}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 border-border/40 border-t bg-muted/[0.35] pt-4 pb-5">
        <p className="text-xs">
          <span className="text-muted-foreground">Latency </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {svc.latency_ms != null ? `${svc.latency_ms} ms` : "—"}
          </span>
        </p>
        {svc.detail ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {svc.detail}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs italic opacity-80">
            No additional diagnostic text.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
