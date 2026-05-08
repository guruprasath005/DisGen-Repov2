import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Archive, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import {
  fetchRetentionSettings,
  updateRetentionSettings,
  type RetentionSettingsUpdateBody,
} from "@/api/superadmin"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

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

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

const inputClass =
  "h-10 max-w-xs rounded-xl border-input/95 bg-background shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)]"

const toggleCardClass =
  "flex cursor-pointer items-start gap-3 rounded-xl border border-border/75 bg-muted/[0.35] p-4 transition-colors hover:bg-muted/45 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/35"

export default function RetentionPage() {
  const qc = useQueryClient()
  const retentionQuery = useQuery({
    queryKey: ["superadmin", "retention"],
    queryFn: fetchRetentionSettings,
  })

  const cfg = retentionQuery.data

  return (
    <div className="space-y-10 pb-12">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <Archive className="size-5" aria-hidden />
          </div>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            Data retention
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
          Governance-aligned lifecycle controls for clinical documents held in this
          tenant. Configure retention duration and automated disposition behaviour in
          line with hospital legal review — irreversible deletion paths require
          deliberate confirmation below.
        </p>
      </div>

      {retentionQuery.isLoading || !cfg ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-[420px] w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl lg:sticky lg:top-24 lg:self-start" />
        </div>
      ) : retentionQuery.error ? (
        <Card className="border-destructive/30 bg-destructive/[0.04] shadow-[var(--shadow-card)]">
          <CardContent className="p-6 text-destructive text-sm">
            Unable to load retention settings.
          </CardContent>
        </Card>
      ) : (
        <RetentionForm key={cfg.updated_at} initial={cfg} qc={qc} />
      )}
    </div>
  )
}

function RetentionForm({
  initial,
  qc,
}: {
  initial: {
    retention_days: number
    auto_delete: boolean
    anonymize_on_expiry: boolean
    updated_at: string
  }
  qc: ReturnType<typeof useQueryClient>
}) {
  const [retentionDays, setRetentionDays] = React.useState(
    initial.retention_days,
  )
  const [autoDelete, setAutoDelete] = React.useState(initial.auto_delete)
  const [anonymize, setAnonymize] = React.useState(initial.anonymize_on_expiry)

  const saveMutation = useMutation({
    mutationFn: (body: RetentionSettingsUpdateBody) =>
      updateRetentionSettings(body),
    onSuccess: async () => {
      toast.success("Retention settings saved.")
      await qc.invalidateQueries({ queryKey: ["superadmin", "retention"] })
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const days = Number(retentionDays)
    if (!Number.isFinite(days) || days < 365) {
      toast.error("Retention period must be at least 365 days.")
      return
    }
    saveMutation.mutate({
      retention_days: Math.floor(days),
      auto_delete: autoDelete,
      anonymize_on_expiry: anonymize,
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
      <form className="contents" onSubmit={submit}>
        <Card className="border-border/80 shadow-[var(--shadow-card)]">
          <CardHeader className="border-border/55 border-b pb-4">
            <CardTitle className="font-heading">Retention policy</CardTitle>
            <CardDescription>
              Minimum horizon reflects statutory baseline; escalation paths remain
              in audit logs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {autoDelete ? (
              <div
                className="rounded-xl border border-border bg-muted/80 px-4 py-4 text-sm shadow-[var(--shadow-xs)]"
                role="status"
              >
                <p className="font-semibold text-foreground">
                  Automated deletion is enabled.
                </p>
                <p className="mt-2 leading-relaxed text-muted-foreground">
                  Documents past the retention window may be permanently removed.
                  Verify backups and court-hold procedures before saving.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
            <Label htmlFor="retention-days">Retention period (days)</Label>
            <Input
              id="retention-days"
              type="number"
              min={365}
              step={1}
              required
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className={inputClass}
            />
            <p className="max-w-md text-muted-foreground text-xs leading-relaxed">
              Minimum one year is enforced to align with prevailing data-protection
              expectations for healthcare records.
            </p>
            </div>

            <label className={toggleCardClass}>
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 rounded border-input accent-primary"
              checked={autoDelete}
              onChange={(e) => setAutoDelete(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground text-sm">
                Automatically delete after retention expires
              </span>
              <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                Schedules irreversible removal when documents exceed the configured
                horizon and no legal hold applies.
              </span>
            </span>
            </label>

            <label className={toggleCardClass}>
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 rounded border-input accent-primary"
              checked={anonymize}
              onChange={(e) => setAnonymize(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground text-sm">
                Prefer anonymisation of PHI at expiry
              </span>
              <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
                Where supported, replaces direct identifiers before physical
                deletion — subject to backend capability and policy review.
              </span>
            </span>
            </label>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 border-border/55 bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              Last policy update{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatUpdated(initial.updated_at)}
              </span>
            </p>
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="w-full shadow-[var(--shadow-sm)] sm:w-auto"
            >
              {saveMutation.isPending ? "Saving…" : "Save retention policy"}
            </Button>
          </CardFooter>
        </Card>
      </form>

      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="border-border/80 bg-gradient-to-b from-muted/40 to-card shadow-[var(--shadow-card)]">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              <CardTitle className="font-heading text-base">
                Policy snapshot
              </CardTitle>
            </div>
            <CardDescription>
              Effective values after your next save — for quick verification.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 border-border/50 border-t bg-background/60 py-5">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-border/40 border-b pb-3">
                <dt className="text-muted-foreground">Retention window</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {retentionDays} days
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-border/40 border-b pb-3">
                <dt className="text-muted-foreground">Auto-delete</dt>
                <dd
                  className={cn(
                    autoDelete
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {autoDelete ? "On" : "Off"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Anonymise at expiry</dt>
                <dd className="font-medium text-foreground">
                  {anonymize ? "Yes" : "No"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <p className="px-1 text-muted-foreground text-[11px] leading-relaxed">
          Changes here are audited. Consult your Data Protection Officer before
          enabling automated deletion in production environments.
        </p>
      </div>

    </div>
  )
}
