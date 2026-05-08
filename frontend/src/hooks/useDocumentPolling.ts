import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { fetchDocumentStatus } from "@/api/documents"

const POLL_INTERVAL_MS = 3000

function isPollActive(status: string | undefined): boolean {
  return status === "processing" || status === "generating"
}

/**
 * Polls GET /documents/:id/status every 3s while status is `processing` or `generating`.
 * Invalidates `["document", documentId]` after each poll so metadata stays fresh.
 */
export function useDocumentPolling(
  documentId: string | undefined,
  seedStatus: string | undefined,
): { status: string | undefined; isPolling: boolean } {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!documentId || !seedStatus || !isPollActive(seedStatus)) return

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
    const id = window.setInterval(tick, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [documentId, seedStatus, queryClient])

  return {
    status: seedStatus,
    isPolling: Boolean(
      documentId && seedStatus && isPollActive(seedStatus),
    ),
  }
}
