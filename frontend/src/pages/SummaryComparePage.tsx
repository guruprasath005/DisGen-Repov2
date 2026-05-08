import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"

import {
  approveLatestSummary,
  downloadLatestSummaryPdf,
  fetchLatestSummary,
  fetchStructuredData,
} from "@/api/documents"
import { MarkdownClinical } from "@/components/clinical/MarkdownClinical"
import { StructuredReadOnly } from "@/components/clinical/StructuredReadOnly"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"

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

export default function SummaryComparePage() {
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isDoctor = user?.role === "doctor"
  const [pdfBusy, setPdfBusy] = useState(false)

  const structuredQuery = useQuery({
    queryKey: ["document", id, "structured"],
    queryFn: () => fetchStructuredData(id),
    enabled: Boolean(id),
  })

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

  const structuredData =
    structuredQuery.data?.data != null &&
    typeof structuredQuery.data.data === "object"
      ? (structuredQuery.data.data as Record<string, unknown>)
      : null

  const loading = structuredQuery.isLoading || summaryQuery.isLoading

  return (
    <div className="space-y-8 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            to={`/documents/${id}/summary`}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-primary"
          >
            ← Back to summary
          </Link>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            Compare structured data & summary
          </h1>
          <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Verify that narrative discharge language aligns with extracted
            clinical facts before approval or hand-off.
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
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[420px] w-full rounded-2xl" />
          <Skeleton className="h-[420px] w-full rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
            <CardContent className="p-6">
              <h2 className="font-semibold text-foreground text-sm tracking-tight">
                Structured clinical data
              </h2>
              <p className="mt-1 text-muted-foreground text-xs">
                Source-of-truth fields extracted from the record (version{" "}
                {structuredQuery.data?.version ?? "—"}).
              </p>
              <div className="mt-4 max-h-[min(70vh,720px)] overflow-y-auto pr-1">
                {structuredData ? (
                  <StructuredReadOnly data={structuredData} />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {structuredQuery.error
                      ? extractErr(structuredQuery.error)
                      : "Structured data unavailable."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
            <CardContent className="p-6">
              <h2 className="font-semibold text-foreground text-sm tracking-tight">
                Generated summary
              </h2>
              <p className="mt-1 text-muted-foreground text-xs">
                {summary
                  ? `${summary.scheme} · v${summary.version} · ${summary.status}`
                  : "—"}
              </p>
              <div className="mt-4 max-h-[min(70vh,720px)] overflow-y-auto pr-1">
                {summary ? (
                  summary.summary_fields != null ? (
                    <SummaryFieldsReadOnly fields={summary.summary_fields} />
                  ) : (
                    <MarkdownClinical markdown={summary.summary_text ?? ""} />
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {summaryQuery.error
                      ? extractErr(summaryQuery.error)
                      : "Summary unavailable."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function SummaryFieldsReadOnly({
  fields,
}: {
  fields: Record<string, string | null>
}) {
  const entries = Object.entries(fields)
  if (entries.length === 0)
    return <p className="text-muted-foreground text-sm">No fields recorded.</p>

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="rounded-lg border border-border/40 bg-white/40 px-3 py-2 shadow-sm"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {key.replace(/_/g, " ")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-foreground">
            {value ?? "—"}
          </p>
        </div>
      ))}
    </div>
  )
}
