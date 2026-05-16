import { useState } from "react"
import { toast } from "sonner"

import { reextractDocument, reprocessDocument } from "@/api/documents"
import { Button } from "@/components/ui/button"
import { useStateMachine } from "@/hooks/useStateMachine"

interface ExtractionMeta {
  needs_doctor_review?: boolean
  pages_total?: number
  pages_empty?: number[]
  truncated_chunks?: string[]
  low_ocr_confidence?: boolean
  failed_pages?: number[]
}

interface Props {
  documentId: string
  status: string | undefined
  /** Decrypted structured `data` object (may contain extraction_meta). */
  structuredData: Record<string, unknown> | undefined
  isDoctor: boolean
  onChanged: () => void
}

/**
 * Surfaces the two things Phases 2 + 4 added that the doctor must see:
 *  - manual recovery actions (re-run OCR / re-run extraction) when the
 *    document is in a recoverable state, driven by the canonical contract; and
 *  - the long-document extraction coverage warning so a doc that needed
 *    truncation-splitting or had blank/low-confidence pages is reviewed.
 *
 * Renders nothing when there is no action and no warning — safe to mount
 * unconditionally at the top of the document view.
 */
export function DocumentRecoveryPanel({
  documentId,
  status,
  structuredData,
  isDoctor,
  onChanged,
}: Props) {
  const sm = useStateMachine()
  const [busy, setBusy] = useState(false)

  const canReprocess = isDoctor && !!status && sm.reprocessable.includes(status)
  const canReextract = isDoctor && !!status && sm.reextractable.includes(status)

  const meta = (structuredData?.extraction_meta ?? undefined) as
    | ExtractionMeta
    | undefined
  const showReview = !!meta?.needs_doctor_review

  if (!canReprocess && !canReextract && !showReview) return null

  async function run(kind: "ocr" | "extract") {
    setBusy(true)
    try {
      if (kind === "ocr") {
        await reprocessDocument(documentId)
        toast.success("Re-running OCR — this document will reprocess.")
      } else {
        await reextractDocument(documentId)
        toast.success(
          "Re-running extraction. You will need to re-confirm the data.",
        )
      }
      onChanged()
    } catch {
      toast.error("Could not start recovery. Please retry in a moment.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {showReview ? (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          <p className="font-medium">Review recommended before confirming</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-800">
            {meta?.pages_empty && meta.pages_empty.length > 0 ? (
              <li>
                No data extracted from page(s){" "}
                {meta.pages_empty.join(", ")} — check these manually.
              </li>
            ) : null}
            {meta?.truncated_chunks && meta.truncated_chunks.length > 0 ? (
              <li>
                Large document — pages {meta.truncated_chunks.join("; ")} were
                split during extraction. Verify long lists (labs, medications).
              </li>
            ) : null}
            {meta?.low_ocr_confidence ? (
              <li>
                Low OCR confidence — the scan quality is poor; verify values
                against the source.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {canReprocess || canReextract ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-white/55 px-4 py-3 text-sm backdrop-blur-sm">
          <span className="text-muted-foreground">
            {canReprocess
              ? "OCR failed for this document."
              : "Extraction looks incomplete?"}
          </span>
          {canReprocess ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run("ocr")}
            >
              {busy ? "Starting…" : "Re-run OCR"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run("extract")}
            >
              {busy ? "Starting…" : "Re-run extraction"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
