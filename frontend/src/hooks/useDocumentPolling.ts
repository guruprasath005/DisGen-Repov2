import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { fetchDocumentStatus } from "@/api/documents"
import { useStateMachine } from "@/hooks/useStateMachine"

/**
 * Polls GET /documents/:id/status while the document is in any in-flight state
 * (processing, ocr_complete, extracting, generating) — derived from the
 * canonical backend contract, not a hard-coded list. Previously this only
 * polled on `processing`/`generating`, so the UI silently froze for the entire
 * OCR→extract→ready stretch. Invalidates `["document", documentId]` after each
 * poll so metadata stays fresh, and stops once the document reaches a stable
 * or failure state.
 */
export function useDocumentPolling(
  documentId: string | undefined,
  seedStatus: string | undefined,
): { status: string | undefined; isPolling: boolean } {
  const queryClient = useQueryClient()
  const sm = useStateMachine()

  const inFlight = new Set(sm.in_flight)
  const isActive = Boolean(
    documentId && seedStatus && inFlight.has(seedStatus),
  )

  useEffect(() => {
    if (!documentId || !seedStatus || !inFlight.has(seedStatus)) return

    let cancelled = false

    const tick = async () => {
      try {
        await fetchDocumentStatus(documentId)
        if (cancelled) return
        await queryClient.invalidateQueries({
          queryKey: ["document", documentId],
        })
      } catch {
        /* transient errors — keep polling until unmount or gate changes */
      }
    }

    void tick()
    const id = window.setInterval(tick, sm.poll_interval_ms)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, seedStatus, queryClient, sm.poll_interval_ms])

  return { status: seedStatus, isPolling: isActive }
}
