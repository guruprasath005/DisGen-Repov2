import axios from "axios"
import { FileUp } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { uploadDocument } from "@/api/documents"
import { DoctorGate } from "@/components/DoctorGate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

const MAX_BYTES = 25 * 1024 * 1024
const ACCEPT =
  "application/pdf,image/jpeg,image/png,image/tiff,.pdf,.jpg,.jpeg,.png,.tif,.tiff"

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export default function UploadPage() {
  return (
    <DoctorGate>
      <UploadInner />
    </DoctorGate>
  )
}

function UploadInner() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [patientName, setPatientName] = useState("")
  const [consentGiven, setConsentGiven] = useState(false)
  const [consentMethod, setConsentMethod] = useState<
    "written" | "verbal" | "digital"
  >("written")
  const [consentDate, setConsentDate] = useState(todayISO)
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)

  const canSubmit = useMemo(() => {
    return Boolean(
      file &&
        patientName.trim() &&
        consentGiven &&
        consentMethod &&
        file.size <= MAX_BYTES,
    )
  }, [file, patientName, consentGiven, consentMethod])

  const pickFile = useCallback((f: File | undefined | null) => {
    if (!f) return
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds the maximum size of 25 MB.")
      return
    }
    setFile(f)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      pickFile(e.dataTransfer.files[0])
    },
    [pickFile],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !canSubmit || uploading) return

    setUploading(true)
    setProgress(0)

    try {
      const { data, httpStatus } = await uploadDocument({
        file,
        patient_name: patientName.trim(),
        consent_given: consentGiven,
        consent_method: consentMethod,
        consent_date: consentDate || undefined,
        onUploadProgress: setProgress,
      })

      if (httpStatus === 201) {
        toast.success("Upload received — processing started.")
        navigate(`/documents/${data.document_id}`)
      } else if (httpStatus === 200 && data.duplicate) {
        toast.warning("This file was already uploaded.")
        navigate(`/documents/${data.document_id}`)
      } else {
        toast.success("Upload complete.")
        navigate(`/documents/${data.document_id}`)
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        toast.error("Upload limit reached. Max 10 per minute.")
      } else if (axios.isAxiosError(err)) {
        const detail = err.response?.data as { detail?: string } | undefined
        toast.error(
          typeof detail?.detail === "string"
            ? detail.detail
            : "Upload failed — please try again.",
        )
      } else {
        toast.error("Upload failed — please try again.")
      }
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <div>
        <p className="font-medium text-[11px] text-primary uppercase tracking-[0.14em]">
          Clinical intake
        </p>
        <h1 className="font-semibold text-2xl text-foreground tracking-tight">
          Upload discharge record
        </h1>
        <p className="mt-2 text-pretty text-muted-foreground text-sm leading-relaxed">
          Secure intake with consent capture. Files are scanned server-side and
          encrypted at rest.
        </p>
      </div>

      <form className="space-y-8" onSubmit={(e) => void handleSubmit(e)}>
        <section className="glass-panel p-6 sm:p-7">
          <Label className="font-medium text-foreground text-sm">
            Clinical document
          </Label>
          <div
            role="presentation"
            className={cn(
              "mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 transition-[border-color,background-color,box-shadow] duration-200",
              dragActive
                ? "border-primary/55 bg-primary/[0.07] shadow-[0_0_0_3px_rgb(249_115_22_/_0.12)]"
                : "border-border/65 bg-white/35 hover:border-primary/38 hover:bg-primary/[0.035] hover:shadow-[var(--shadow-xs)]",
            )}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              setDragActive(false)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => document.getElementById("upload-file-input")?.click()}
          >
            <input
              id="upload-file-input"
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/12 text-primary shadow-inner">
              <FileUp className="size-7" aria-hidden />
            </div>
            <p className="mt-4 text-center font-medium text-foreground text-sm">
              Drag & drop or click to browse
            </p>
            <p className="mt-1 text-center text-muted-foreground text-xs">
              PDF, JPEG, PNG, or TIFF · Max 25 MB
            </p>
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-primary/18 bg-primary/[0.06] px-4 py-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.6)]">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm">
                  {file.name}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatBytes(file.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFile(null)}
              >
                Remove
              </Button>
            </div>
          )}

          {uploading && (
            <div className="mt-4 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-center text-muted-foreground text-xs">
                Uploading… {progress}%
              </p>
            </div>
          )}
        </section>

        <section className="glass-panel p-6 sm:p-7">
          <h2 className="font-semibold text-foreground text-sm tracking-tight">
            Patient & consent
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="patient-name">Patient name</Label>
              <Input
                id="patient-name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Full legal name"
                required
                autoComplete="name"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="consent-method">Consent method</Label>
              <select
                id="consent-method"
                className={cn(
                  "h-9 w-full rounded-xl border border-input/90 bg-background/90 px-3 text-sm shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.03)] outline-none transition-[border-color,box-shadow]",
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/38",
                )}
                value={consentMethod}
                onChange={(e) =>
                  setConsentMethod(e.target.value as typeof consentMethod)
                }
                required
              >
                <option value="written">Written</option>
                <option value="verbal">Verbal</option>
                <option value="digital">Digital</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="consent-date">Consent date (optional)</Label>
              <Input
                id="consent-date"
                type="date"
                value={consentDate}
                onChange={(e) => setConsentDate(e.target.value)}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/65 bg-white/40 px-4 py-3.5 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.65)] sm:col-span-2">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-1 size-4 rounded border-input accent-primary"
                required
              />
              <span>
                <span className="font-medium text-foreground text-sm">
                  Consent obtained
                </span>
                <span className="mt-0.5 block text-muted-foreground text-xs leading-snug">
                  I confirm informed consent was documented for processing this
                  clinical record under hospital policy.
                </span>
              </span>
            </label>
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <Button
            type="submit"
            size="lg"
            className="h-10 min-w-[10rem] rounded-xl px-6 shadow-[var(--shadow-sm)] shadow-primary/18"
            disabled={!canSubmit || uploading}
          >
            {uploading ? "Uploading…" : "Submit upload"}
          </Button>
        </div>
      </form>
    </div>
  )
}
