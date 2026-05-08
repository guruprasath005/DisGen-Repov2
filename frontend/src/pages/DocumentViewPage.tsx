import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import {
  ChevronDown,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  Pencil,
  Sparkles,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import {
  approveLatestSummary,
  confirmStructuredData,
  downloadLatestSummaryPdf,
  fetchDocument,
  fetchLatestSummary,
  fetchStructuredData,
  generateDocumentSummary,
  type StructuredDataResponse,
  type SummaryLatestResponse,
} from "@/api/documents"
import { fetchSchemes, type SchemeFieldItem } from "@/api/schemes"
import { MarkdownClinical } from "@/components/clinical/MarkdownClinical"
import { SchemeFieldEditor } from "@/components/clinical/SchemeFieldEditor"
import { StructuredReadOnly } from "@/components/clinical/StructuredReadOnly"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useDocumentPolling } from "@/hooks/useDocumentPolling"
import { cn } from "@/lib/utils"

import { Collapsible, Dialog, Tabs, Tooltip } from "radix-ui"

const STRUCTURED_TAB_STATUSES = new Set([
  "ready",
  "confirmed",
  "generating",
  "generated",
  "approved",
  "validation_failed",
])

const SUMMARY_TAB_DOC_STATUSES = new Set(["generated", "approved"])

const GENERATE_VISIBLE_STATUSES = new Set([
  "confirmed",
  "generated",
  "validation_failed",
])

function formatOcr(confidence: number | null | undefined): string {
  if (confidence == null) return "—"
  const pct = confidence <= 1 ? confidence * 100 : confidence
  return `${pct.toFixed(1)}%`
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ")
}

function triggerPdfDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function DocumentViewPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isDoctor = user?.role === "doctor"

  const [tab, setTab] = useState("ocr")
  const prevStatusRef = useRef<string | undefined>(undefined)
  const didInitTabRef = useRef(false)

  const [schemeModalOpen, setSchemeModalOpen] = useState(false)
  const [schemeManualPick, setSchemeManualPick] = useState<string | null>(
    null,
  )

  const docQuery = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id),
    enabled: Boolean(id),
  })

  const doc = docQuery.data
  const { isPolling } = useDocumentPolling(id, doc?.status)

  // Auto-switch tabs when document status changes:
  // - On first load: jump to the most relevant tab for current status
  // - processing/extracting → ready: reveal structured data tab
  // - generating → generated/approved: reveal summary tab
  useEffect(() => {
    if (!doc?.status) return
    const status = String(doc.status)

    if (!didInitTabRef.current) {
      didInitTabRef.current = true
      if (status === "generated" || status === "approved") {
        setTab("summary")
      } else if (STRUCTURED_TAB_STATUSES.has(status)) {
        setTab("structured")
      }
      prevStatusRef.current = status
      return
    }

    const prev = prevStatusRef.current
    prevStatusRef.current = status

    if (
      (prev === "processing" || prev === "extracting") &&
      STRUCTURED_TAB_STATUSES.has(status)
    ) {
      setTab("structured")
    }
    if (prev === "generating" && (status === "generated" || status === "approved")) {
      setTab("summary")
    }
  }, [doc?.status])

  const structuredAllowed =
    doc?.status != null && STRUCTURED_TAB_STATUSES.has(String(doc.status))
  const summaryAllowed =
    doc?.status != null && SUMMARY_TAB_DOC_STATUSES.has(String(doc.status))

  const structuredQuery = useQuery({
    queryKey: ["document", id, "structured"],
    queryFn: () => fetchStructuredData(id),
    enabled: Boolean(id && structuredAllowed),
  })

  const summaryQuery = useQuery({
    queryKey: ["document", id, "summary", "latest"],
    queryFn: () => fetchLatestSummary(id),
    enabled: Boolean(id && summaryAllowed && tab === "summary"),
  })

  const schemesQuery = useQuery({
    queryKey: ["schemes"],
    queryFn: fetchSchemes,
    enabled: Boolean(id),
  })

  const confirmMutation = useMutation({
    mutationFn: () => confirmStructuredData(id),
    onSuccess: () => {
      toast.success("Structured data confirmed.")
      void queryClient.invalidateQueries({ queryKey: ["document", id] })
      void queryClient.invalidateQueries({
        queryKey: ["document", id, "structured"],
      })
    },
    onError: (e: unknown) => {
      toast.error(extractErr(e))
    },
  })

  const generateMutation = useMutation({
    mutationFn: (scheme_id: string) =>
      generateDocumentSummary(id, { scheme_id }),
    onSuccess: () => {
      toast.success("Generation queued")
      setSchemeModalOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["document", id] })
      void queryClient.invalidateQueries({
        queryKey: ["document", id, "structured"],
      })
      void queryClient.invalidateQueries({
        queryKey: ["document", id, "summary", "latest"],
      })
    },
    onError: (e: unknown) => {
      toast.error(extractErr(e))
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => approveLatestSummary(id),
    onSuccess: () => {
      toast.success("Summary approved.")
      void queryClient.invalidateQueries({
        queryKey: ["document", id, "summary", "latest"],
      })
      void queryClient.invalidateQueries({ queryKey: ["document", id] })
    },
    onError: (e: unknown) => {
      toast.error(extractErr(e))
    },
  })

  function handleFieldsSaved(updated: SummaryLatestResponse) {
    queryClient.setQueryData(["document", id, "summary", "latest"], updated)
  }

  const summaryScheme =
    schemesQuery.data?.find((s) => s.id === summaryQuery.data?.scheme) ?? null

  const [pdfBusy, setPdfBusy] = useState(false)

  async function handlePdfDownload() {
    setPdfBusy(true)
    try {
      const blob = await downloadLatestSummaryPdf(id)
      const summary = summaryQuery.data
      const name = summary
        ? `discharge-summary-${summary.scheme}-v${summary.version}.pdf`
        : `discharge-summary-${id.slice(0, 8)}.pdf`
      triggerPdfDownload(blob, name)
    } catch (e: unknown) {
      toast.error(extractErr(e))
    } finally {
      setPdfBusy(false)
    }
  }

  const showConfirm =
    isDoctor &&
    structuredQuery.data &&
    structuredQuery.data.data_confirmed === false &&
    (doc?.status === "ready" || doc?.status === "confirmed")

  const showEdit =
    isDoctor && (doc?.status === "ready" || doc?.status === "confirmed")

  const generateVisible =
    isDoctor &&
    doc?.status != null &&
    GENERATE_VISIBLE_STATUSES.has(String(doc.status))

  const generateDisabled =
    structuredQuery.data != null && !structuredQuery.data.data_confirmed

  const summaryApproveVisible =
    isDoctor &&
    summaryQuery.data &&
    summaryQuery.data.status.toLowerCase() === "draft"

  const validationNotesPresent =
    summaryQuery.data?.validation_notes &&
    Object.keys(summaryQuery.data.validation_notes).length > 0

  const processingUi =
    doc?.status === "processing" || doc?.status === "extracting"

  const schemesList = schemesQuery.data ?? []
  const resolvedSchemeId =
    schemeManualPick ?? schemesList[0]?.id ?? null

  function handleSchemeModalChange(open: boolean) {
    setSchemeModalOpen(open)
    if (!open) setSchemeManualPick(null)
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {docQuery.isLoading ? (
            <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
          ) : doc ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate font-semibold text-2xl text-foreground tracking-tight">
                  {doc.filename}
                </h1>
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs capitalize">
                  {formatStatusLabel(String(doc.status))}
                </span>
                {isPolling ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-white/55 px-2.5 py-0.5 text-muted-foreground text-xs backdrop-blur-sm">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/55 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    Syncing status…
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-sm">
                Uploaded{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(doc.created_at))}
              </p>
            </>
          ) : (
            <p className="text-destructive text-sm">Document not found.</p>
          )}
        </div>
      </div>

      {!docQuery.isLoading && doc && (
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="flex flex-wrap gap-1 rounded-xl border border-white/60 bg-white/55 p-1 shadow-sm backdrop-blur-md">
            <Tabs.Trigger
              value="ocr"
              className={cn(
                "rounded-lg px-4 py-2 font-medium text-muted-foreground text-sm transition-colors",
                "data-[state=active]:bg-primary/12 data-[state=active]:text-primary data-[state=active]:shadow-sm",
              )}
            >
              OCR Text
            </Tabs.Trigger>
            <Tabs.Trigger
              value="structured"
              disabled={!structuredAllowed}
              className={cn(
                "rounded-lg px-4 py-2 font-medium text-muted-foreground text-sm transition-colors",
                "disabled:pointer-events-none disabled:opacity-45",
                "data-[state=active]:bg-primary/12 data-[state=active]:text-primary data-[state=active]:shadow-sm",
              )}
            >
              Structured Data
            </Tabs.Trigger>
            <Tabs.Trigger
              value="summary"
              disabled={!summaryAllowed}
              className={cn(
                "rounded-lg px-4 py-2 font-medium text-muted-foreground text-sm transition-colors",
                "disabled:pointer-events-none disabled:opacity-45",
                "data-[state=active]:bg-primary/12 data-[state=active]:text-primary data-[state=active]:shadow-sm",
              )}
            >
              Summary
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="ocr" className="mt-6 outline-none">
            <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-wrap gap-6 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                      Filename
                    </p>
                    <p className="font-medium">{doc.filename}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                      Pages
                    </p>
                    <p className="font-medium tabular-nums">
                      {doc.pages ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide">
                      OCR confidence
                    </p>
                    <p className="font-medium tabular-nums">
                      {formatOcr(doc.ocr_confidence)}
                    </p>
                  </div>
                </div>

                {processingUi ? (
                  <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-6">
                    <div className="flex items-center gap-3">
                      <Loader2 className="size-5 animate-spin text-primary" />
                      <p className="font-medium text-foreground text-sm">
                        Processing document…
                      </p>
                    </div>
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/50 bg-muted/20 px-5 py-6 text-muted-foreground text-sm leading-relaxed">
                    OCR text is processed server-side and stored encrypted.
                    Structured data is available in the next tab once processing
                    completes.
                  </div>
                )}
              </CardContent>
            </Card>
          </Tabs.Content>

          <Tabs.Content value="structured" className="mt-6 outline-none">
            {!structuredAllowed ? (
              <LockedTab message="Structured fields unlock once extraction completes." />
            ) : structuredQuery.isLoading ? (
              <StructuredSkeleton />
            ) : structuredQuery.data ? (
              <StructuredTabBody
                structured={structuredQuery.data}
                docStatus={String(doc.status)}
                showConfirm={Boolean(showConfirm)}
                showEdit={Boolean(showEdit)}
                generateVisible={Boolean(generateVisible)}
                generateDisabled={Boolean(generateDisabled)}
                confirming={confirmMutation.isPending}
                generating={generateMutation.isPending}
                onConfirm={() => confirmMutation.mutate()}
                onEdit={() => navigate(`/documents/${id}/edit`)}
                onOpenGenerate={() => setSchemeModalOpen(true)}
              />
            ) : (
              <LockedTab
                message={
                  structuredQuery.error
                    ? extractErr(structuredQuery.error)
                    : "Structured data unavailable."
                }
              />
            )}
          </Tabs.Content>

          <Tabs.Content value="summary" className="mt-6 outline-none">
            {!summaryAllowed ? (
              <LockedTab message="Summary unlocks after generation completes." />
            ) : summaryQuery.isLoading ? (
              <SummarySkeleton />
            ) : summaryQuery.data ? (
              <SummaryTabBody
                summary={summaryQuery.data}
                structuredData={structuredQuery.data?.data ?? null}
                approveVisible={Boolean(summaryApproveVisible)}
                approving={approveMutation.isPending}
                pdfBusy={pdfBusy}
                validationNotesPresent={Boolean(validationNotesPresent)}
                requiredFields={summaryScheme?.required_fields ?? []}
                optionalFields={summaryScheme?.optional_fields ?? []}
                isDoctor={isDoctor}
                onApprove={() => approveMutation.mutate()}
                onPdf={() => void handlePdfDownload()}
                onCompare={() =>
                  navigate(`/documents/${id}/summary/compare`)
                }
                onFieldsSaved={handleFieldsSaved}
              />
            ) : (
              <LockedTab
                message={
                  summaryQuery.error
                    ? extractErr(summaryQuery.error)
                    : "Summary unavailable."
                }
              />
            )}
          </Tabs.Content>
        </Tabs.Root>
      )}

      <Dialog.Root
        open={schemeModalOpen}
        onOpenChange={handleSchemeModalChange}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/95 p-6 shadow-xl backdrop-blur-xl outline-none">
            <Dialog.Title className="font-semibold text-foreground text-lg">
              Choose scheme
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-muted-foreground text-sm">
              Generation follows confirmed structured data and scheme-specific
              rules.
            </Dialog.Description>
            <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
              {schemesList.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    resolvedSchemeId === s.id
                      ? "border-primary/45 bg-primary/8"
                      : "border-border/60 bg-white/60 hover:bg-muted/40",
                  )}
                >
                  <input
                    type="radio"
                    name="scheme"
                    value={s.id}
                    checked={resolvedSchemeId === s.id}
                    onChange={() => setSchemeManualPick(s.id)}
                    className="accent-primary"
                  />
                  <span
                    className="size-3 shrink-0 rounded-full shadow-inner ring-2 ring-white"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-medium text-sm">{s.label}</span>
                </label>
              ))}
              {schemesList.length === 0 && schemesQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                disabled={
                  !resolvedSchemeId || generateMutation.isPending
                }
                onClick={() => {
                  if (resolvedSchemeId) {
                    generateMutation.mutate(resolvedSchemeId)
                  }
                }}
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Queueing…
                  </>
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function extractErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { detail?: unknown }
    if (typeof d?.detail === "string") return d.detail
    return e.message || "Request failed"
  }
  return e instanceof Error ? e.message : "Something went wrong"
}

function LockedTab({ message }: { message: string }) {
  return (
    <Card className="border-white/60 bg-white/55 backdrop-blur-md">
      <CardContent className="p-8 text-center text-muted-foreground text-sm">
        {message}
      </CardContent>
    </Card>
  )
}

function StructuredSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}

function ClinicalSummaryPanel({ data }: { data: Record<string, unknown> }) {
  function strVal(v: unknown): string {
    if (!v) return ""
    if (typeof v === "string") return v
    if (typeof v === "number") return String(v)
    return ""
  }

  function diagLabel(d: unknown): string {
    if (!d) return ""
    if (typeof d === "string") return d
    if (typeof d === "object" && d !== null) {
      const o = d as Record<string, unknown>
      const name = strVal(o.name ?? o.diagnosis)
      const code = strVal(o.icd10_code)
      return code ? `${name} (${code})` : name
    }
    return ""
  }

  function medLabel(m: unknown): { name: string; detail: string } {
    if (typeof m === "string") return { name: m, detail: "" }
    if (typeof m === "object" && m !== null) {
      const o = m as Record<string, unknown>
      const name = strVal(o.name ?? o.drug ?? o.generic_name)
      const parts = [
        strVal(o.dose ?? o.dosage),
        strVal(o.route),
        strVal(o.frequency),
        strVal(o.duration),
      ].filter(Boolean)
      return { name, detail: parts.join(" · ") }
    }
    return { name: "", detail: "" }
  }

  const pd = diagLabel(data.primary_diagnosis)
  const secList = Array.isArray(data.secondary_diagnoses)
    ? (data.secondary_diagnoses as unknown[]).map(diagLabel).filter(Boolean)
    : []
  const complaints = Array.isArray(data.presenting_complaints)
    ? (data.presenting_complaints as unknown[]).map(strVal).filter(Boolean)
    : []
  const dcMeds = Array.isArray(data.discharge_medications)
    ? (data.discharge_medications as unknown[]).map(medLabel).filter((m) => m.name)
    : []
  const stayMeds = Array.isArray(data.medications_during_stay)
    ? (data.medications_during_stay as unknown[]).map(medLabel).filter((m) => m.name)
    : []
  const procs = Array.isArray(data.procedures)
    ? (data.procedures as unknown[])
        .map((p) => {
          if (typeof p === "string") return p
          if (typeof p === "object" && p !== null) {
            const o = p as Record<string, unknown>
            return strVal(o.name ?? o.procedure)
          }
          return ""
        })
        .filter(Boolean)
    : []
  const followUp = strVal(data.follow_up_instructions)
  const followUpDate = strVal(data.follow_up_date)
  const diet = strVal(data.diet_advice)
  const allergies = strVal(data.allergies)
  const consultant = strVal(data.consultant ?? data.surgeon)

  const hasAnything =
    pd ||
    secList.length > 0 ||
    complaints.length > 0 ||
    dcMeds.length > 0 ||
    stayMeds.length > 0 ||
    procs.length > 0 ||
    followUp ||
    followUpDate

  if (!hasAnything) return null

  return (
    <div className="space-y-4">
      {/* Patient meta row */}
      {(strVal(data.patient_name) ||
        strVal(data.uhid) ||
        strVal(data.age) ||
        strVal(data.admission_date)) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Patient", strVal(data.patient_name)],
            ["UHID", strVal(data.uhid)],
            ["Age / Gender", [strVal(data.age), strVal(data.gender)].filter(Boolean).join(" · ")],
            ["Admission → Discharge", [strVal(data.admission_date), strVal(data.discharge_date)].filter(Boolean).join(" → ")],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-border/40 bg-white/40 px-3 py-2 shadow-sm backdrop-blur-sm"
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-sm font-medium leading-snug">{value}</p>
              </div>
            ))}
        </div>
      )}

      {/* Diagnosis */}
      {(pd || secList.length > 0 || complaints.length > 0) && (
        <div className="rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Diagnosis
          </p>
          <div className="mt-1.5 space-y-1">
            {pd && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70">Primary</span>
                <span>{pd}</span>
              </div>
            )}
            {secList.map((s, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70">
                  {i === 0 ? "Secondary" : ""}
                </span>
                <span>{s}</span>
              </div>
            ))}
            {complaints.length > 0 && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70">Complaints</span>
                <span>{complaints.join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stay medications */}
      {stayMeds.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Treatment During Stay
          </p>
          <div className="mt-1.5 divide-y divide-border/30">
            {stayMeds.map((m, i) => (
              <div key={i} className="flex items-baseline gap-2 py-1 text-sm">
                <span className="font-medium">{m.name}</span>
                {m.detail && (
                  <span className="text-muted-foreground text-xs">{m.detail}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Procedures */}
      {procs.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Procedures
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {procs.map((p, i) => (
              <li key={i}>{p as string}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Discharge medications */}
      {dcMeds.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Discharge Medications
          </p>
          <div className="mt-1.5 divide-y divide-border/30">
            {dcMeds.map((m, i) => (
              <div key={i} className="flex items-baseline gap-2 py-1 text-sm">
                <span className="font-medium">{m.name}</span>
                {m.detail && (
                  <span className="text-muted-foreground text-xs">{m.detail}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-up + misc */}
      {(followUp || followUpDate || diet || allergies || consultant) && (
        <div className="rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Follow-up & Notes
          </p>
          <div className="mt-1.5 space-y-1">
            {followUpDate && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70 w-24">Date</span>
                <span>{followUpDate}</span>
              </div>
            )}
            {followUp && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70 w-24">Instructions</span>
                <span className="whitespace-pre-wrap">{followUp}</span>
              </div>
            )}
            {diet && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70 w-24">Diet</span>
                <span>{diet}</span>
              </div>
            )}
            {allergies && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70 w-24">Allergies</span>
                <span>{allergies}</span>
              </div>
            )}
            {consultant && (
              <div className="flex gap-2 text-sm">
                <span className="shrink-0 font-medium text-foreground/70 w-24">Consultant</span>
                <span>{consultant}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

function StructuredTabBody({
  structured,
  docStatus,
  showConfirm,
  showEdit,
  generateVisible,
  generateDisabled,
  confirming,
  generating,
  onConfirm,
  onEdit,
  onOpenGenerate,
}: {
  structured: StructuredDataResponse
  docStatus: string
  showConfirm: boolean
  showEdit: boolean
  generateVisible: boolean
  generateDisabled: boolean
  confirming: boolean
  generating: boolean
  onConfirm: () => void
  onEdit: () => void
  onOpenGenerate: () => void
}) {
  const data = structured.data as Record<string, unknown>

  return (
    <div className="space-y-4">
      {!structured.data_confirmed ? (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/90 px-4 py-3 text-amber-950 text-sm shadow-sm backdrop-blur-sm">
          Review and confirm this data before generating a summary
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-300/55 bg-emerald-50/90 px-4 py-3 text-emerald-950 text-sm shadow-sm backdrop-blur-sm">
          Data confirmed
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showConfirm ? (
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Confirming…
              </>
            ) : (
              "Confirm structured data"
            )}
          </Button>
        ) : null}
        {showEdit ? (
          <Button type="button" variant="outline" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </Button>
        ) : null}
        {generateVisible ? (
          generateDisabled ? (
            <Tooltip.Provider delayDuration={200}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className="inline-flex">
                    <Button type="button" variant="secondary" disabled>
                      <Sparkles className="size-4" aria-hidden />
                      Generate summary
                    </Button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="z-[60] max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-md">
                    Confirm structured data first
                    <Tooltip.Arrow className="fill-popover" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={generating}
              onClick={onOpenGenerate}
            >
              <Sparkles className="size-4" aria-hidden />
              Generate summary
            </Button>
          )
        ) : null}
      </div>

      <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
        <CardContent className="p-6">
          <StructuredReadOnly data={data} />
          <p className="mt-6 border-border/40 border-t pt-4 text-muted-foreground text-xs">
            Version {structured.version} · Updated{" "}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(structured.updated_at))}{" "}
            · Document status {docStatus}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryTabBody({
  summary,
  structuredData,
  approveVisible,
  approving,
  pdfBusy,
  validationNotesPresent,
  requiredFields,
  optionalFields,
  isDoctor,
  onApprove,
  onPdf,
  onCompare,
  onFieldsSaved,
}: {
  summary: SummaryLatestResponse
  structuredData: Record<string, unknown> | null
  approveVisible: boolean
  approving: boolean
  pdfBusy: boolean
  validationNotesPresent: boolean
  requiredFields: SchemeFieldItem[]
  optionalFields: SchemeFieldItem[]
  isDoctor: boolean
  onApprove: () => void
  onPdf: () => void
  onCompare: () => void
  onFieldsSaved: (updated: SummaryLatestResponse) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)

  const isLocked = !isDoctor || summary.status === "approved"

  const emptyRequired = Array.isArray(
    summary.validation_notes?.empty_required_fields,
  )
    ? (summary.validation_notes!.empty_required_fields as string[])
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 font-medium text-xs">
          {summary.scheme}
        </span>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs">
          v{summary.version}
        </span>
        <span className="rounded-full border border-border px-2.5 py-0.5 font-medium text-xs capitalize">
          {summary.status}
        </span>
        {emptyRequired.length > 0 && (
          <span className="rounded-full border border-red-300/70 bg-red-50 px-2.5 py-0.5 font-medium text-red-700 text-xs">
            {emptyRequired.length} required field
            {emptyRequired.length !== 1 ? "s" : ""} empty
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {approveVisible ? (
          <Button type="button" onClick={onApprove} disabled={approving}>
            {approving ? (
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
          onClick={onPdf}
          disabled={pdfBusy}
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
        <Button type="button" variant="outline" onClick={onCompare}>
          <GitCompareArrows className="size-4" aria-hidden />
          Compare
        </Button>
      </div>

      <Card className="border-white/60 bg-white/65 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
        <CardContent className="p-6 space-y-6">
          {structuredData && <ClinicalSummaryPanel data={structuredData} />}

          {summary.summary_fields != null ? (
            <>
              {(requiredFields.length > 0 || optionalFields.length > 0) && (
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-t border-border/40 pt-4">
                  {summary.scheme.toUpperCase()} Fields
                </p>
              )}
              <SchemeFieldEditor
                documentId={summary.document_id}
                scheme={summary.scheme}
                summaryFields={summary.summary_fields}
                requiredFields={requiredFields}
                optionalFields={optionalFields}
                isLocked={isLocked}
                onSaved={onFieldsSaved}
              />
            </>
          ) : summary.summary_text ? (
            <MarkdownClinical markdown={summary.summary_text} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No summary content available.
            </p>
          )}

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
    </div>
  )
}
