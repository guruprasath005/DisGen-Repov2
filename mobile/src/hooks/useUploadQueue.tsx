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
  bumpRetry,
  dequeue,
  enqueue as enqueueToStorage,
  loadQueue,
} from "../utils/uploadQueue"

export interface UploadQueueContextValue {
  queue: QueuedUpload[]
  pendingCount: number
  refreshQueue: () => Promise<void>
  enqueue: typeof enqueueToStorage
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [queue, setQueue] = useState<QueuedUpload[]>([])
  const processingRef = useRef(false)

  const refreshQueue = useCallback(async () => {
    const items = await loadQueue()
    setQueue(items)
  }, [])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  const processQueue = useCallback(async () => {
    if (!user || processingRef.current) return
    processingRef.current = true
    try {
      let items = await loadQueue()
      setQueue(items)
      while (items.length > 0) {
        const net = await NetInfo.fetch()
        if (!net.isConnected) break

        const item = items[0]
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
        } catch {
          if (item.retries >= 3) {
            await dequeue(item.id)
          } else {
            await bumpRetry(item.id)
          }
        }
        items = await loadQueue()
        setQueue(items)
      }
    } finally {
      processingRef.current = false
    }
  }, [user])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected && user) {
        void processQueue()
      }
    })
    return () => unsub()
  }, [processQueue, user])

  useEffect(() => {
    if (!user) return
    void NetInfo.fetch().then((n) => {
      if (n.isConnected) void processQueue()
    })
  }, [user, processQueue])

  const value: UploadQueueContextValue = {
    queue,
    pendingCount: queue.length,
    refreshQueue,
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
