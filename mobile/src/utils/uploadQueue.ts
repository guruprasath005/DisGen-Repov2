import AsyncStorage from "@react-native-async-storage/async-storage"

const QUEUE_KEY = "upload_queue"

export type QueuedUpload = {
  id: string
  patientName: string
  fileUri: string
  fileName: string
  mimeType: string
  consentGiven: boolean
  consentMethod: "written" | "verbal" | "digital"
  queuedAt: string
  retries: number
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function loadQueue(): Promise<QueuedUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as QueuedUpload[]
  } catch {
    return []
  }
}

export async function saveQueue(items: QueuedUpload[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

export async function enqueue(
  item: Omit<QueuedUpload, "id" | "queuedAt" | "retries"> & {
    id?: string
    queuedAt?: string
    retries?: number
  },
): Promise<void> {
  const list = await loadQueue()
  const row: QueuedUpload = {
    id: item.id ?? newId(),
    patientName: item.patientName,
    fileUri: item.fileUri,
    fileName: item.fileName,
    mimeType: item.mimeType,
    consentGiven: item.consentGiven,
    consentMethod: item.consentMethod,
    queuedAt: item.queuedAt ?? new Date().toISOString(),
    retries: item.retries ?? 0,
  }
  list.push(row)
  await saveQueue(list)
}

export async function dequeue(id: string): Promise<void> {
  const list = await loadQueue()
  await saveQueue(list.filter((x) => x.id !== id))
}

export async function bumpRetry(id: string): Promise<void> {
  const list = await loadQueue()
  const next = list.map((x) =>
    x.id === id ? { ...x, retries: x.retries + 1 } : x,
  )
  await saveQueue(next)
}
