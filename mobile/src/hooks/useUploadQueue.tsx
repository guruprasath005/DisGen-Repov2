import NetInfo from "@react-native-community/netinfo"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { uploadDischargeDocument } from "../api/documents"
import { useAuth } from "../contexts/AuthContext"
import {
  type QueuedUpload,
  MAX_UPLOAD_RETRIES,
  bumpRetry,
  dequeue,
  dismissFailed as dismissFailedFromStore,
  enqueue as enqueueToStorage,
  loadFailed,
  loadQueue,
  moveToFailed,
  retryAllFailed,
} from "../utils/uploadQueue"

// Drives backoff retries even when connectivity/foreground don't change.
const TICK_MS = 15_000

function isDue(item: QueuedUpload): boolean {
  return !item.nextRetryAt || Date.parse(item.nextRetryAt) <= Date.now()
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message)
  }
  return "Upload failed"
}

export interface UploadQueueContextValue {
  queue: QueuedUpload[]
  pendingCount: number
  failed: QueuedUpload[]
  failedCount: number
  isProcessing: boolean
  refreshQueue: () => Promise<void>
  retryFailed: () => Promise<void>
  dismissFailed: (id: string) => Promise<void>
  enqueue: typeof enqueueToStorage
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [queue, setQueue] = useState<QueuedUpload[]>([])
  const [failed, setFailed] = useState<QueuedUpload[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const processingRef = useRef(false)

  const refreshQueue = useCallback(async () => {
    const [q, f] = await Promise.all([loadQueue(), loadFailed()])
    setQueue(q)
    setFailed(f)
  }, [])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  const processQueue = useCallback(async () => {
    if (!user || processingRef.current) return
    processingRef.current = true
    setIsProcessing(true)
    try {
      let items = await loadQueue()
      setQueue(items)

      while (items.length > 0) {
        const net = await NetInfo.fetch()
        if (!net.isConnected) break

        // Respect exponential backoff — only attempt items whose retry
        // window has arrived. If none are due, stop; the interval tick
        // will come back when they are.
        const item = items.find(isDue)
        if (!item) break

        try {
          await uploadDischargeDocument({
            patientName: item.patientName,
            fileUri: item.fileUri,
            fileName: item.fileName,
            mimeType: item.mimeType,
            consentGiven: item.consentGiven,
            consentMethod: item.consentMethod,
          })
          await dequeue(item.id)
        } catch (e) {
          // Terminal failures are SURFACED, never silently dropped.
          if (item.retries + 1 >= MAX_UPLOAD_RETRIES) {
            await moveToFailed(item.id, errMessage(e))
          } else {
            await bumpRetry(item.id, errMessage(e))
          }
        }

        items = await loadQueue()
        setQueue(items)
        setFailed(await loadFailed())
      }
    } finally {
      processingRef.current = false
      setIsProcessing(false)
      await refreshQueue()
    }
  }, [user, refreshQueue])

  // Retry when connectivity is regained.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && user) void processQueue()
    })
    return () => unsub()
  }, [processQueue, user])

  // Kick once on login + a steady tick so backed-off items eventually retry.
  useEffect(() => {
    if (!user) return
    void NetInfo.fetch().then((n) => {
      if (n.isConnected) void processQueue()
    })
    const id = setInterval(() => void processQueue(), TICK_MS)
    return () => clearInterval(id)
  }, [user, processQueue])

  const retryFailed = useCallback(async () => {
    await retryAllFailed()
    await refreshQueue()
    void processQueue()
  }, [refreshQueue, processQueue])

  const dismissFailed = useCallback(
    async (id: string) => {
      await dismissFailedFromStore(id)
      setFailed(await loadFailed())
    },
    [],
  )

  const value: UploadQueueContextValue = {
    queue,
    pendingCount: queue.length,
    failed,
    failedCount: failed.length,
    isProcessing,
    refreshQueue,
    retryFailed,
    dismissFailed,
    enqueue: enqueueToStorage,
  }

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  )
}

export function useUploadQueue(): UploadQueueContextValue {
  const ctx = useContext(UploadQueueContext)
  if (!ctx) {
    throw new Error("useUploadQueue must be used within UploadQueueProvider")
  }
  return ctx
}
