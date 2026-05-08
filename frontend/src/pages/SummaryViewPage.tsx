import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import {
  approveLatestSummary,
  downloadLatestSummaryPdf,
  fetchLatestSummary,
} from "@/api/documents"
import { MarkdownClinical } from "@/components/clinical/MarkdownClinical"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"

import { Collapsible } from "radix-ui"

function extractErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { detail?: unknown }
    if (typeof d?.detail === "string") return d.detail
    return e.message || "Request failed"
  }
  return e instanceof Error ? e.message : "Something went wrong"
}

function triggerPdfDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatDt(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function SummaryViewPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isDoctor = user?.role === "doctor"
  const [pdfBusy, setPdfBusy] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  const summaryQuery = useQuery({
    queryKey: ["document", id, "summary", "latest"],
    queryFn: () => fetchLatestSummary(id),
    enabled: Boolean(id),
  })

  const approveMutation = useMutation({
    mutationFn: () => approveLatestSummary(id),
    onSuccess: () => {
      toast.success("Summary approved.")
      void summaryQuery.refetch()
      void queryClient.invalidateQueries({ queryKey: ["document", id] })
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  async function handlePdf() {
    setPdfBusy(true)
    try {
      const blob = await downloadLatestSummaryPdf(id)
      const s = summaryQuery.data
      const name = s
        ? `discharge-summary-${s.scheme}-v${s.version}.pdf`
        : `discharge-summary-${id.slice(0, 8)}.pdf`
      triggerPdfDownload(blob, name)
    } catch (e: unknown) {
      toast.error(extractErr(e))
    } finally {
      setPdfBusy(false)
    }
  }

  const summary = summaryQuery.data
  const approveVisible =
    isDoctor &&
    summary &&
    summary.status.toLowerCase() === "draft"

  const validationNotesPresent =
    summary?.validation_notes &&
    Object.keys(summary.validation_notes).length > 0

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            to={`/documents/${id}`}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-primary"
          >
            ← Back to document
          </Link>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            Discharge summary
          </h1>
          <p className="text-muted-foreground text-sm">
            Read-only clinical narrative generated from confirmed structured
            data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approveVisible ? (
            <Button
              type="button"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Approving…
                </>
              ) : (
                "Approve summary"
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pdfBusy}
            onClick={() => void handlePdf()}
          >
            {pdfBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Preparing…
              </>
            ) : (
              "Download PDF"
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/documents/${id}/summary/compare`)}
          >
            Compare with structured data
          </Button>
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : summaryQuery.error ? (
        <Card className="border-destructive/25 bg-destructive/5">
          <CardContent className="p-6 text-destructive text-sm">
            {extractErr(summaryQuery.error)}
          </CardContent>
        </Card>
      ) : summary ? (
        <>
          <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
            <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
              <Meta label="Scheme">{summary.scheme}</Meta>
              <Meta label="Version">v{summary.version}</Meta>
              <Meta label="Summary status">{summary.status}</Meta>
              <Meta label="Generated by (user id)">{summary.generated_by}</Meta>
              <Meta label="Approved by">{summary.approved_by ?? "—"}</Meta>
              <Meta label="Approved at">{formatDt(summary.approved_at)}</Meta>
              <Meta label="Created at">{formatDt(summary.created_at)}</Meta>
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
            <CardContent className="p-6">
              <MarkdownClinical markdown={summary.summary_text ?? ""} />

              {validationNotesPresent ? (
                <Collapsible.Root
                  open={notesOpen}
                  onOpenChange={setNotesOpen}
                  className="mt-6 rounded-xl border border-amber-200/70 bg-amber-50/70"
                >
                  <Collapsible.Trigger className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-amber-950 text-sm outline-none">
                    Validation notes
                    {notesOpen ? (
                      <ChevronDown className="size-4 shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0" />
                    )}
                  </Collapsible.Trigger>
                  <Collapsible.Content className="data-[state=closed]:hidden px-4 pb-4">
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 font-mono text-xs">
                      {JSON.stringify(summary.validation_notes, null, 2)}
                    </pre>
                  </Collapsible.Content>
                </Collapsible.Root>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-medium text-sm">{children}</p>
    </div>
  )
}
