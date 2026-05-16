import AsyncStorage from "@react-native-async-storage/async-storage"

const QUEUE_KEY = "upload_queue"
const FAILED_KEY = "upload_queue_failed"

export const MAX_UPLOAD_RETRIES = 3

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
  /** Earliest ISO time the item may be retried (exponential backoff). */
  nextRetryAt?: string
  /** Last upload error message, surfaced in the UI. */
  lastError?: string
  /** When the item was moved to the failed store (failed list only). */
  failedAt?: string
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Stable identity of an upload's payload — used to reject duplicate enqueues. */
function contentKey(
  i: Pick<QueuedUpload, "patientName" | "fileName" | "fileUri">,
): string {
  return `${i.patientName} ${i.fileName} ${i.fileUri}`
}

/** Exponential backoff: 5s, 20s, 80s … capped at 5 min. */
export function backoffMs(retries: number): number {
  return Math.min(5000 * 4 ** retries, 5 * 60_000)
}

async function load(key: string): Promise<QueuedUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as QueuedUpload[]) : []
  } catch {
    return []
  }
}

async function save(key: string, items: QueuedUpload[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(items))
}

export async function loadQueue(): Promise<QueuedUpload[]> {
  return load(QUEUE_KEY)
}

export async function saveQueue(items: QueuedUpload[]): Promise<void> {
  await save(QUEUE_KEY, items)
}

export async function loadFailed(): Promise<QueuedUpload[]> {
  return load(FAILED_KEY)
}

/**
 * Add an upload to the queue.
 *
 * Returns false (and does not enqueue) if an identical payload is already
 * pending — prevents the double-tap / re-mount duplicate uploads the old
 * queue allowed.
 */
export async function enqueue(
  item: Omit<QueuedUpload, "id" | "queuedAt" | "retries"> & {
    id?: string
    queuedAt?: string
    retries?: number
  },
): Promise<boolean> {
  const list = await loadQueue()
  const key = contentKey(item)
  if (list.some((x) => contentKey(x) === key)) {
    return false
  }
  list.push({
    id: item.id ?? newId(),
    patientName: item.patientName,
    fileUri: item.fileUri,
    fileName: item.fileName,
    mimeType: item.mimeType,
    consentGiven: item.consentGiven,
    consentMethod: item.consentMethod,
    queuedAt: item.queuedAt ?? new Date().toISOString(),
    retries: item.retries ?? 0,
  })
  await saveQueue(list)
  return true
}

export async function dequeue(id: string): Promise<void> {
  const list = await loadQueue()
  await saveQueue(list.filter((x) => x.id !== id))
}

/** Record a transient failure: bump retries, schedule the next attempt. */
export async function bumpRetry(id: string, error?: string): Promise<void> {
  const list = await loadQueue()
  await saveQueue(
    list.map((x) =>
      x.id === id
        ? {
            ...x,
            retries: x.retries + 1,
            lastError: error,
            nextRetryAt: new Date(
              Date.now() + backoffMs(x.retries),
            ).toISOString(),
          }
        : x,
    ),
  )
}

/** Move a permanently-failed item out of the active queue into the failed store. */
export async function moveToFailed(id: string, error?: string): Promise<void> {
  const list = await loadQueue()
  const item = list.find((x) => x.id === id)
  await saveQueue(list.filter((x) => x.id !== id))
  if (!item) return
  const failed = await loadFailed()
  failed.push({
    ...item,
    lastError: error ?? item.lastError,
    failedAt: new Date().toISOString(),
  })
  await save(FAILED_KEY, failed)
}

/** Re-queue every failed item for another attempt (retries reset). */
export async function retryAllFailed(): Promise<void> {
  const failed = await loadFailed()
  if (failed.length === 0) return
  const queue = await loadQueue()
  for (const f of failed) {
    if (!queue.some((q) => contentKey(q) === contentKey(f))) {
      queue.push({
        ...f,
        retries: 0,
        nextRetryAt: undefined,
        lastError: undefined,
        failedAt: undefined,
      })
    }
  }
  await saveQueue(queue)
  await save(FAILED_KEY, [])
}

export async function dismissFailed(id: string): Promise<void> {
  const failed = await loadFailed()
  await save(
    FAILED_KEY,
    failed.filter((x) => x.id !== id),
  )
}

export async function clearFailed(): Promise<void> {
  await save(FAILED_KEY, [])
}
