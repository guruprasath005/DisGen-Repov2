import { type RouteProp, useRoute } from "@react-navigation/native"
import * as LegacyFS from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import * as React from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import axios from "axios"
import {
  type Investigation,
  type Medication,
  type StructuredDataDto,
  type SummaryDto,
  type DocumentDto,
  type Vitals,
  approveDocument,
  fetchDocumentDetail,
  fetchStructuredData,
  fetchSummary,
  patchStructuredData,
  pollDocumentStatus,
} from "../api/documents"
import { API_BASE_URL, getMemoryAccessToken } from "../api/client"
import { GlassCard } from "../components/GlassCard"
import { useTabBarInset } from "../hooks/useTabBarInset"
import type { MainStackParamList } from "../navigation/types"
import { useTheme } from "../contexts/ThemeContext"
import type { ThemeTokens } from "../theme"
import { formatStatusLabel, statusBadgeStyle } from "../utils/statusBadge"

type DetailRoute = RouteProp<MainStackParamList, "DocumentDetail">

const POLL_INTERVAL_MS = 3000

const ACTIVE_POLL_STATUSES = new Set([
  "processing",
  "ocr_complete",
  "extracting",
  "generating",
])

const TERMINAL_STATUSES = new Set([
  "ready",
  "confirmed",
  "generated",
  "approved",
  "ocr_failed",
  "failed",
  "validation_failed",
])

const STEP_LABELS = ["OCR", "Extract", "Review", "Complete"] as const

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase())
}

function shouldPollStatus(status: string): boolean {
  return ACTIVE_POLL_STATUSES.has(status.toLowerCase())
}

function currentPipelineStep(status: string): number {
  const s = status.toLowerCase()
  if (["pending", "processing", "ocr_complete"].includes(s)) return 0
  if (s === "extracting") return 1
  if (["ready", "confirmed"].includes(s)) return 2
  if (["generating", "generated", "approved"].includes(s)) return 3
  return 0
}

/** Per-step UI state for pipeline indicator */
function pipelineStepVisual(
  stepIndex: number,
  status: string,
): "complete" | "current" | "future" | "error" {
  const s = status.toLowerCase()
  if (s === "ocr_failed") {
    if (stepIndex === 0) return "error"
    return "future"
  }
  if (s === "validation_failed") {
    if (stepIndex < 3) return "complete"
    return "error"
  }
  if (s === "failed") {
    if (stepIndex === 0) return "complete"
    if (stepIndex === 1) return "error"
    return "future"
  }
  const cur = currentPipelineStep(s)
  if (stepIndex < cur) return "complete"
  if (stepIndex === cur) return "current"
  return "future"
}

function segmentFilled(leftStepIndex: number, status: string): boolean {
  return pipelineStepVisual(leftStepIndex, status) === "complete"
}

function parseSummaryMarkdown(md: string | null | undefined): { heading: string; body: string }[] {
  if (!md) return []
  const trimmed = md.trim()
  if (!trimmed) return []
  const lines = trimmed.split(/\r?\n/)
  const out: { heading: string; body: string }[] = []
  let heading = ""
  let bodyLines: string[] = []

  function flush() {
    const body = bodyLines.join("\n").trim()
    if (heading || body) out.push({ heading, body })
    bodyLines = []
  }

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush()
      heading = line.slice(3).trim()
    } else {
      bodyLines.push(line)
    }
  }
  flush()
  if (!out.length) return [{ heading: "", body: trimmed }]
  return out
}

function formatChipDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function formatFullDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function ocrPercent(conf: number | null): string | null {
  if (conf == null) return null
  const pct = conf <= 1 ? conf * 100 : conf
  return `${pct.toFixed(1)}%`
}

type TabKey = "info" | "structured" | "summary"

export function DocumentDetailScreen() {
  const { params } = useRoute<DetailRoute>()
  const { documentId } = params
  const tabInset = useTabBarInset()

  const [loading, setLoading] = React.useState(true)
  const [secondaryLoading, setSecondaryLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [doc, setDoc] = React.useState<DocumentDto | null>(null)
  const [structured, setStructured] = React.useState<
    StructuredDataDto | null | undefined
  >(undefined)
  const [summary, setSummary] = React.useState<SummaryDto | null | undefined>(
    undefined,
  )
  const [tab, setTab] = React.useState<TabKey>("info")
  const [downloading, setDownloading] = React.useState(false)
  const [detailRefreshing, setDetailRefreshing] = React.useState(false)
  const [structuredEditing, setStructuredEditing] = React.useState(false)

  const { theme } = useTheme()
  const styles = React.useMemo(() => createDetailStyles(theme), [theme])
  const detailBundle = React.useMemo(
    () => ({ styles, theme }),
    [styles, theme],
  )

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  React.useEffect(() => {
    if (tab !== "structured") {
      setStructuredEditing(false)
    }
  }, [tab])

  const fetchSecondary = React.useCallback(async () => {
    const [str, sum] = await Promise.all([
      fetchStructuredData(documentId),
      fetchSummary(documentId),
    ])
    setStructured(str)
    setSummary(sum)
  }, [documentId])

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const loadDocument = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    setStructured(undefined)
    setSummary(undefined)
    stopPolling()

    try {
      const d = await fetchDocumentDetail(documentId)
      setDoc(d)

      if (isTerminalStatus(d.status)) {
        await fetchSecondary()
      } else if (shouldPollStatus(d.status)) {
        pollRef.current = setInterval(async () => {
          try {
            const { status } = await pollDocumentStatus(documentId)
            setDoc((prev) => (prev ? { ...prev, status } : null))
            if (isTerminalStatus(status)) {
              stopPolling()
              setSecondaryLoading(true)
              try {
                await fetchSecondary()
              } finally {
                setSecondaryLoading(false)
              }
            }
          } catch {
            /* transient poll failure — ignore */
          }
        }, POLL_INTERVAL_MS)
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : "Could not load document."
      setError(msg)
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }, [documentId, fetchSecondary, stopPolling])

  const handleRefresh = React.useCallback(async () => {
    setDetailRefreshing(true)
    try {
      const d = await fetchDocumentDetail(documentId)
      setDoc(d)
      if (isTerminalStatus(d.status)) {
        setSecondaryLoading(true)
        try {
          await fetchSecondary()
        } finally {
          setSecondaryLoading(false)
        }
      }
    } catch {
      /* ignore refresh errors */
    } finally {
      setDetailRefreshing(false)
    }
  }, [documentId, fetchSecondary])

  React.useEffect(() => {
    void loadDocument()
    return () => {
      stopPolling()
    }
  }, [loadDocument, stopPolling])

  async function handleDownloadPdf() {
    const token = getMemoryAccessToken()
    if (!token) {
      Alert.alert("Download failed", "You are not signed in.")
      return
    }
    const dir = LegacyFS.documentDirectory
    if (!dir) {
      Alert.alert("Download failed", "Storage is not available on this device.")
      return
    }
    const uri = `${API_BASE_URL}/documents/${documentId}/summary/latest/pdf`
    const dest = `${dir}discharge_${documentId}.pdf`

    setDownloading(true)
    try {
      const result = await LegacyFS.downloadAsync(uri, dest, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (result.status === 200) {
        await Sharing.shareAsync(result.uri, {
          mimeType: "application/pdf",
          dialogTitle: "Discharge Summary",
        })
      } else {
        Alert.alert("Download failed", "Could not download the PDF.")
      }
    } catch {
      Alert.alert("Download failed", "Could not download the PDF.")
    } finally {
      setDownloading(false)
    }
  }

  if (loading && !doc) {
    return (
      <DetailThemeContext.Provider value={detailBundle}>
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
          <View style={styles.fullSpinner}>
            <ActivityIndicator size="large" color={theme.orange} />
          </View>
        </SafeAreaView>
      </DetailThemeContext.Provider>
    )
  }

  if (error || !doc) {
    return (
      <DetailThemeContext.Provider value={detailBundle}>
        <SafeAreaView style={styles.safe} edges={["bottom"]}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollPad,
              { paddingBottom: tabInset + 32 },
            ]}
          >
            <Text style={styles.errTitle}>Something went wrong</Text>
            <Text style={styles.errBody}>{error ?? "Unknown error"}</Text>
            <Pressable
              style={styles.retryBtn}
              onPress={() => void loadDocument()}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </DetailThemeContext.Provider>
    )
  }

  const badge = statusBadgeStyle(doc.status, theme)
  const polling = shouldPollStatus(doc.status)
  const chipDate = formatChipDate(doc.created_at)
  const ocrStr = ocrPercent(doc.ocr_confidence)

  return (
    <DetailThemeContext.Provider value={detailBundle}>
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollPad,
          { paddingBottom: tabInset + 32 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          structuredEditing ? undefined : (
            <RefreshControl
              refreshing={detailRefreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={theme.orange}
            />
          )
        }
      >
        <GlassCard intensity={44} style={styles.cardGap}>
          <Text style={styles.filename} numberOfLines={2}>
            {doc.filename}
          </Text>
          <View style={styles.headerRow}>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: badge.backgroundColor,
                  borderColor: badge.borderColor,
                },
              ]}
            >
              <Text style={[styles.statusBadgeText, { color: badge.color }]}>
                {formatStatusLabel(doc.status)}
              </Text>
            </View>
            {polling ? (
              <View style={styles.processingRow}>
                <ActivityIndicator size="small" color={theme.orange} />
                <Text style={styles.processingText}>Processing…</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.metaChips}>
            {doc.pages != null ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{doc.pages} pages</Text>
              </View>
            ) : null}
            {ocrStr ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>OCR {ocrStr}</Text>
              </View>
            ) : null}
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>{chipDate}</Text>
            </View>
          </View>
        </GlassCard>

        <PipelineIndicator status={doc.status} />

        <View style={styles.segmentWrap}>
          {(
            [
              ["info", "Info"],
              ["structured", "Structured Data"],
              ["summary", "Summary"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.segmentPill, tab === key && styles.segmentPillActive]}
              onPress={() => setTab(key)}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  tab === key && styles.segmentLabelActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "info" ? (
          <InfoTab doc={doc} />
        ) : tab === "structured" ? (
          <StructuredTab
            data={structured}
            loading={secondaryLoading}
            awaitingPipeline={!isTerminalStatus(doc.status)}
            documentId={documentId}
            onSaved={(updated) => setStructured(updated)}
            onEditingChange={setStructuredEditing}
          />
        ) : (
          <SummaryTab
            summary={summary}
            loading={secondaryLoading}
            awaitingPipeline={!isTerminalStatus(doc.status)}
            downloading={downloading}
            onDownloadPdf={() => void handleDownloadPdf()}
            documentId={documentId}
            onApproved={() =>
              setSummary((prev) =>
                prev ? { ...prev, status: "approved" } : prev,
              )
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
    </DetailThemeContext.Provider>
  )
}

function PipelineIndicator({ status }: { status: string }) {
  const { styles } = useDetailTheme()
  return (
    <GlassCard intensity={40} style={styles.cardGap} contentStyle={styles.pipelineInner}>
      <Text style={styles.sectionHeading}>Pipeline</Text>
      <View style={styles.pipelineRow}>
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 ? (
              <View
                style={[
                  styles.pipelineConnector,
                  segmentFilled(i - 1, status)
                    ? styles.connectorOrange
                    : styles.connectorMuted,
                ]}
              />
            ) : null}
            <PipelineStep stepIndex={i} label={label} status={status} />
          </React.Fragment>
        ))}
      </View>
    </GlassCard>
  )
}

function PipelineStep({
  stepIndex,
  label,
  status,
}: {
  stepIndex: number
  label: string
  status: string
}) {
  const { styles } = useDetailTheme()
  const visual = pipelineStepVisual(stepIndex, status)

  const circleStyle =
    visual === "future"
      ? styles.pipeCircleFuture
      : visual === "error"
        ? styles.pipeCircleError
        : styles.pipeCircleFill

  const content =
    visual === "complete" ? (
      <Text style={styles.pipeCheck}>✓</Text>
    ) : visual === "error" ? (
      <Text style={styles.pipeCross}>✕</Text>
    ) : visual === "current" ? (
      <Text style={styles.pipeNum}>{stepIndex + 1}</Text>
    ) : (
      <Text style={styles.pipeNumMuted}>{stepIndex + 1}</Text>
    )

  return (
    <View style={styles.pipeStep}>
      <View style={[styles.pipeCircle, circleStyle]}>{content}</View>
      <Text
        style={[
          styles.pipeLabel,
          visual === "future" && styles.pipeLabelMuted,
          visual === "error" && styles.pipeLabelError,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </View>
  )
}

function InfoTab({ doc }: { doc: DocumentDto }) {
  const { styles } = useDetailTheme()
  return (
    <GlassCard intensity={44} contentStyle={styles.tabCardInner}>
      <FieldRow label="Document ID" value={doc.id} mono selectable />
      <FieldRow label="Filename" value={doc.filename} />
      <FieldRow label="Status" value={formatStatusLabel(doc.status)} />
      <FieldRow label="Uploaded" value={formatFullDateTime(doc.created_at)} />
      <FieldRow
        label="Pages"
        value={doc.pages != null ? String(doc.pages) : "—"}
      />
      <FieldRow
        label="OCR Confidence"
        value={ocrPercent(doc.ocr_confidence) ?? "—"}
      />
      <FieldRow label="Hospital ID" value={doc.hospital_id} mono selectable />
    </GlassCard>
  )
}

function FieldRow({
  label,
  value,
  mono,
  selectable,
}: {
  label: string
  value: string
  mono?: boolean
  selectable?: boolean
}) {
  const { styles } = useDetailTheme()
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text
        style={[styles.fieldValue, mono && styles.fieldMono]}
        selectable={Boolean(selectable)}
      >
        {value}
      </Text>
    </View>
  )
}

function cloneStructured(d: StructuredDataDto): StructuredDataDto {
  return JSON.parse(JSON.stringify(d)) as StructuredDataDto
}

const STRUCTURED_PATCH_STRING_KEYS: (keyof StructuredDataDto)[] = [
  "patient_name",
  "patient_age",
  "patient_gender",
  "uhid",
  "abha_id",
  "phone",
  "admission_date",
  "discharge_date",
  "ward",
  "bed_number",
  "hospital_name",
  "referring_doctor",
  "treating_doctor",
]

function buildStructuredPatch(
  base: StructuredDataDto,
  draft: StructuredDataDto,
): Partial<StructuredDataDto> {
  const patch: Partial<StructuredDataDto> = {}
  for (const key of STRUCTURED_PATCH_STRING_KEYS) {
    if (draft[key] !== base[key]) {
      ;(patch as Record<string, unknown>)[key as string] = draft[key]
    }
  }
  if (JSON.stringify(draft.diagnoses) !== JSON.stringify(base.diagnoses)) {
    patch.diagnoses = draft.diagnoses
  }
  if (JSON.stringify(draft.medications) !== JSON.stringify(base.medications)) {
    patch.medications = draft.medications
  }
  if (JSON.stringify(draft.vitals) !== JSON.stringify(base.vitals)) {
    patch.vitals = draft.vitals
  }
  return patch
}

function saveFailureDetail(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return "Save failed. Please try again."
  }
  const respData = err.response?.data
  if (respData && typeof respData === "object" && "detail" in respData) {
    const detail = (respData as { detail: unknown }).detail
    if (typeof detail === "string" && detail.trim()) return detail
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg)
        }
        return String(item)
      })
      const joined = parts.filter(Boolean).join("; ")
      if (joined) return joined
    }
  }
  return "Save failed. Please try again."
}

function StructuredFieldInput({
  label,
  value,
  onChangeText,
  mono,
}: {
  label: string
  value: string | null | undefined
  onChangeText: (t: string) => void
  mono?: boolean
}) {
  const { styles, theme } = useDetailTheme()
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.structuredInput, mono && styles.fieldMono]}
        value={value ?? ""}
        onChangeText={onChangeText}
        placeholderTextColor={theme.muted}
      />
    </View>
  )
}

const VITAL_GRID_FIELDS: { label: string; key: keyof Vitals }[] = [
  { label: "BP", key: "bp" },
  { label: "Pulse", key: "pulse" },
  { label: "Temp", key: "temp" },
  { label: "SpO₂", key: "spo2" },
  { label: "Weight", key: "weight" },
  { label: "Height", key: "height" },
]

function VitalsGridEditable({
  vitals,
  onChangeField,
}: {
  vitals: Vitals
  onChangeField: (key: keyof Vitals, value: string) => void
}) {
  const { styles, theme } = useDetailTheme()
  return (
    <View style={styles.vitalsGrid}>
      {VITAL_GRID_FIELDS.map(({ label, key }) => (
        <View key={key} style={styles.vitalsCell}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.structuredInput}
            value={vitals[key] ?? ""}
            onChangeText={(t) => onChangeField(key, t)}
            placeholderTextColor={theme.muted}
          />
        </View>
      ))}
    </View>
  )
}

function emptyMedication(): Medication {
  return {
    name: "",
    dose: "",
    route: "",
    frequency: "",
    duration: "",
  }
}

function StructuredTab({
  data,
  loading,
  awaitingPipeline,
  documentId,
  onSaved,
  onEditingChange,
}: {
  data: StructuredDataDto | null | undefined
  loading: boolean
  awaitingPipeline: boolean
  documentId: string
  onSaved: (updated: StructuredDataDto) => void
  onEditingChange?: (editing: boolean) => void
}) {
  const { styles, theme } = useDetailTheme()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<StructuredDataDto | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const baselineRef = React.useRef<StructuredDataDto | null>(null)

  React.useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  React.useEffect(() => {
    if (data === null || data === undefined) {
      setEditing(false)
      setDraft(null)
      baselineRef.current = null
      setSaveError(null)
    }
  }, [data])

  const beginEdit = React.useCallback(() => {
    if (!data) return
    baselineRef.current = cloneStructured(data)
    setDraft(cloneStructured(data))
    setEditing(true)
    setSaveError(null)
  }, [data])

  const cancelEdit = React.useCallback(() => {
    setDraft(null)
    baselineRef.current = null
    setEditing(false)
    setSaveError(null)
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!draft || !baselineRef.current) return
    const patch = buildStructuredPatch(baselineRef.current, draft)
    if (Object.keys(patch).length === 0) {
      cancelEdit()
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await patchStructuredData(documentId, patch)
      cancelEdit()
      onSaved(updated)
    } catch (e: unknown) {
      setSaveError(saveFailureDetail(e))
    } finally {
      setSaving(false)
    }
  }, [draft, documentId, onSaved, cancelEdit])

  if (awaitingPipeline && data === undefined) {
    return (
      <GlassCard intensity={44} contentStyle={styles.emptyTab}>
        <Text style={styles.emptyMuted}>
          Structured data will appear when processing finishes.
        </Text>
      </GlassCard>
    )
  }
  if (loading || data === undefined) {
    return (
      <GlassCard intensity={44} contentStyle={styles.loadingTab}>
        <ActivityIndicator color={theme.orange} />
      </GlassCard>
    )
  }
  if (data === null) {
    return (
      <GlassCard intensity={44} contentStyle={styles.emptyTab}>
        <Text style={styles.emptyMuted}>
          Structured data is not available yet.
        </Text>
      </GlassCard>
    )
  }

  const row = editing && draft ? draft : data

  const setStr = (
    key:
      | "patient_name"
      | "patient_age"
      | "patient_gender"
      | "uhid"
      | "abha_id"
      | "phone"
      | "admission_date"
      | "discharge_date"
      | "ward"
      | "bed_number"
      | "hospital_name"
      | "referring_doctor"
      | "treating_doctor",
    val: string,
  ) => {
    setDraft((prev) =>
      prev ? { ...prev, [key]: val.trim() === "" ? null : val } : prev,
    )
  }

  const updateVital = (key: keyof Vitals, val: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      const nextVitals: Vitals = { ...(prev.vitals ?? {}) }
      nextVitals[key] = val.trim() === "" ? null : val
      return { ...prev, vitals: nextVitals }
    })
  }

  const updateDiagnosis = (index: number, val: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = [...prev.diagnoses]
      next[index] = val
      return { ...prev, diagnoses: next }
    })
  }

  const removeDiagnosis = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        diagnoses: prev.diagnoses.filter((_, i) => i !== index),
      }
    })
  }

  const addDiagnosis = () => {
    setDraft((prev) =>
      prev ? { ...prev, diagnoses: [...prev.diagnoses, ""] } : prev,
    )
  }

  const updateMedication = (index: number, medPatch: Partial<Medication>) => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = prev.medications.map((m, i) =>
        i === index ? { ...m, ...medPatch } : m,
      )
      return { ...prev, medications: next }
    })
  }

  const removeMedication = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        medications: prev.medications.filter((_, i) => i !== index),
      }
    })
  }

  const addMedication = () => {
    setDraft((prev) =>
      prev
        ? { ...prev, medications: [...prev.medications, emptyMedication()] }
        : prev,
    )
  }

  return (
    <View style={styles.structuredWrap}>
      <View style={styles.structChipBar}>
        {saveError ? (
          <View style={styles.structSaveErrBanner}>
            <Text style={styles.structSaveErrText}>{saveError}</Text>
          </View>
        ) : null}
        <View style={styles.confirmChipRow}>
          <View
            style={[
              styles.confirmChip,
              row.data_confirmed
                ? styles.confirmChipGreen
                : styles.confirmChipAmber,
            ]}
          >
            <Text
              style={[
                styles.confirmChipText,
                row.data_confirmed
                  ? styles.confirmChipTextGreen
                  : styles.confirmChipTextAmber,
              ]}
            >
              {row.data_confirmed ? "Data confirmed" : "Awaiting confirmation"}
            </Text>
          </View>
          <View style={styles.confirmChipActions}>
            {!editing ? (
              <Pressable onPress={beginEdit} hitSlop={8}>
                <Text style={styles.structEditBtn}>Edit</Text>
              </Pressable>
            ) : (
              <View style={styles.structEditActions}>
                <Pressable
                  onPress={cancelEdit}
                  disabled={saving}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      styles.structCancelBtn,
                      saving && styles.structActionMuted,
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSave()}
                  disabled={saving}
                  hitSlop={8}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={theme.orange} />
                  ) : (
                    <Text style={styles.structSaveBtn}>Save</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </View>

      <CollapsibleSection title="Patient" defaultOpen>
        {editing && draft ? (
          <>
            <StructuredFieldInput
              label="Name"
              value={draft.patient_name}
              onChangeText={(t) => setStr("patient_name", t)}
            />
            <StructuredFieldInput
              label="Age"
              value={draft.patient_age}
              onChangeText={(t) => setStr("patient_age", t)}
            />
            <StructuredFieldInput
              label="Gender"
              value={draft.patient_gender}
              onChangeText={(t) => setStr("patient_gender", t)}
            />
            <StructuredFieldInput
              label="UHID"
              value={draft.uhid}
              onChangeText={(t) => setStr("uhid", t)}
              mono
            />
            <StructuredFieldInput
              label="ABHA ID"
              value={draft.abha_id}
              onChangeText={(t) => setStr("abha_id", t)}
              mono
            />
            <StructuredFieldInput
              label="Phone"
              value={draft.phone}
              onChangeText={(t) => setStr("phone", t)}
            />
          </>
        ) : (
          <>
            <Nullable label="Name" value={data.patient_name} />
            <Nullable label="Age" value={data.patient_age} />
            <Nullable label="Gender" value={data.patient_gender} />
            <Nullable label="UHID" value={data.uhid} mono />
            <Nullable label="ABHA ID" value={data.abha_id} mono />
            <Nullable label="Phone" value={data.phone} />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Admission" defaultOpen>
        {editing && draft ? (
          <>
            <StructuredFieldInput
              label="Admission date"
              value={draft.admission_date}
              onChangeText={(t) => setStr("admission_date", t)}
            />
            <StructuredFieldInput
              label="Discharge date"
              value={draft.discharge_date}
              onChangeText={(t) => setStr("discharge_date", t)}
            />
            <StructuredFieldInput
              label="Ward"
              value={draft.ward}
              onChangeText={(t) => setStr("ward", t)}
            />
            <StructuredFieldInput
              label="Bed number"
              value={draft.bed_number}
              onChangeText={(t) => setStr("bed_number", t)}
            />
            <StructuredFieldInput
              label="Treating doctor"
              value={draft.treating_doctor}
              onChangeText={(t) => setStr("treating_doctor", t)}
            />
            <StructuredFieldInput
              label="Referring doctor"
              value={draft.referring_doctor}
              onChangeText={(t) => setStr("referring_doctor", t)}
            />
            <StructuredFieldInput
              label="Hospital name"
              value={draft.hospital_name}
              onChangeText={(t) => setStr("hospital_name", t)}
            />
          </>
        ) : (
          <>
            <Nullable label="Admission date" value={data.admission_date} />
            <Nullable label="Discharge date" value={data.discharge_date} />
            <Nullable label="Ward" value={data.ward} />
            <Nullable label="Bed number" value={data.bed_number} />
            <Nullable label="Treating doctor" value={data.treating_doctor} />
            <Nullable label="Referring doctor" value={data.referring_doctor} />
            <Nullable label="Hospital name" value={data.hospital_name} />
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Diagnosis" defaultOpen>
        {data.icd10_primary ? (
          <View style={styles.icdPrimary}>
            <Text style={styles.fieldLabel}>Primary ICD-10</Text>
            <Text style={styles.icdChipText}>
              {data.icd10_primary.code} · {data.icd10_primary.description}
            </Text>
          </View>
        ) : null}
        {data.icd10_secondary?.length ? (
          <View style={styles.blockGap}>
            <Text style={styles.fieldLabel}>Secondary ICD-10</Text>
            {( data.icd10_secondary ?? [] ).map((e, i) => (
              <Text key={`${e.code}-${i}`} style={styles.icdSecondaryLine}>
                {e.code} · {e.description}
              </Text>
            ))}
          </View>
        ) : null}
        {editing && draft ? (
          <View style={styles.blockGap}>
            <Text style={styles.fieldLabel}>Diagnoses</Text>
            {draft.diagnoses.map((diag, i) => (
              <View key={`diag-${i}`} style={styles.diagnosisEditRow}>
                <TextInput
                  style={[styles.structuredInput, styles.diagnosisEditInput]}
                  value={diag}
                  onChangeText={(t) => updateDiagnosis(i, t)}
                  placeholderTextColor={theme.muted}
                />
                <Pressable
                  onPress={() => removeDiagnosis(i)}
                  hitSlop={10}
                  style={styles.diagnosisRemoveBtn}
                >
                  <Text style={styles.diagnosisRemoveGlyph}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={addDiagnosis} hitSlop={8}>
              <Text style={styles.structAddLink}>+ Add diagnosis</Text>
            </Pressable>
          </View>
        ) : data.diagnoses?.length ? (
          <View style={styles.blockGap}>
            <Text style={styles.fieldLabel}>Diagnoses</Text>
            {( data.diagnoses ?? [] ).map((d, i) => (
              <Text key={`${d}-${i}`} style={styles.bulletLine}>
                • {d}
              </Text>
            ))}
          </View>
        ) : null}
      </CollapsibleSection>

      {(data.comorbidities?.length || data.allergies?.length) ? (
        <CollapsibleSection title="Comorbidities & Allergies" defaultOpen>
          {data.comorbidities?.length ? (
            <View style={styles.pillRow}>
              {( data.comorbidities ?? [] ).map((c, i) => (
                <View key={`co-${i}`} style={styles.softPill}>
                  <Text style={styles.softPillText}>{c}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {data.allergies?.length ? (
            <View style={[styles.pillRow, styles.blockGap]}>
              {( data.allergies ?? [] ).map((a, i) => (
                <View key={`al-${i}`} style={styles.softPill}>
                  <Text style={styles.softPillText}>{a}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </CollapsibleSection>
      ) : null}

      {editing && draft ? (
        <CollapsibleSection title="Medications" defaultOpen>
          {draft.medications.map((m, i) => (
            <View key={`med-edit-${i}`} style={styles.medEditCard}>
              <Pressable
                style={styles.medRemoveBtn}
                onPress={() => removeMedication(i)}
                hitSlop={10}
              >
                <Text style={styles.medRemoveGlyph}>✕</Text>
              </Pressable>
              <StructuredFieldInput
                label="Name"
                value={m.name}
                onChangeText={(t) =>
                  updateMedication(i, {
                    name: t,
                  })
                }
              />
              <View style={styles.medEditTwoCol}>
                <View style={styles.medEditCol}>
                  <Text style={styles.fieldLabel}>Dose</Text>
                  <TextInput
                    style={styles.structuredInput}
                    value={m.dose ?? ""}
                    onChangeText={(t) =>
                      updateMedication(i, {
                        dose: t.trim() === "" ? null : t,
                      })
                    }
                    placeholderTextColor={theme.muted}
                  />
                </View>
                <View style={styles.medEditCol}>
                  <Text style={styles.fieldLabel}>Route</Text>
                  <TextInput
                    style={styles.structuredInput}
                    value={m.route ?? ""}
                    onChangeText={(t) =>
                      updateMedication(i, {
                        route: t.trim() === "" ? null : t,
                      })
                    }
                    placeholderTextColor={theme.muted}
                  />
                </View>
              </View>
              <View style={styles.medEditTwoCol}>
                <View style={styles.medEditCol}>
                  <Text style={styles.fieldLabel}>Frequency</Text>
                  <TextInput
                    style={styles.structuredInput}
                    value={m.frequency ?? ""}
                    onChangeText={(t) =>
                      updateMedication(i, {
                        frequency: t.trim() === "" ? null : t,
                      })
                    }
                    placeholderTextColor={theme.muted}
                  />
                </View>
                <View style={styles.medEditCol}>
                  <Text style={styles.fieldLabel}>Duration</Text>
                  <TextInput
                    style={styles.structuredInput}
                    value={m.duration ?? ""}
                    onChangeText={(t) =>
                      updateMedication(i, {
                        duration: t.trim() === "" ? null : t,
                      })
                    }
                    placeholderTextColor={theme.muted}
                  />
                </View>
              </View>
            </View>
          ))}
          <Pressable onPress={addMedication} hitSlop={8}>
            <Text style={styles.structAddLink}>+ Add medication</Text>
          </Pressable>
        </CollapsibleSection>
      ) : data.medications?.length ? (
        <CollapsibleSection title="Medications" defaultOpen>
          {( data.medications ?? [] ).map((m, i) => (
            <MedicationRow key={`med-${i}`} med={m} />
          ))}
        </CollapsibleSection>
      ) : null}

      {editing && draft ? (
        <CollapsibleSection title="Vitals" defaultOpen>
          <VitalsGridEditable
            vitals={draft.vitals ?? {}}
            onChangeField={updateVital}
          />
        </CollapsibleSection>
      ) : data.vitals &&
        Object.values(data.vitals).some(
          (v) => v != null && String(v).trim(),
        ) ? (
        <CollapsibleSection title="Vitals" defaultOpen>
          <VitalsGrid vitals={data.vitals} />
        </CollapsibleSection>
      ) : null}

      {data.investigations?.length ? (
        <CollapsibleSection title="Investigations" defaultOpen>
          {( data.investigations ?? [] ).map((inv, i) => (
            <InvestigationRow key={`inv-${i}`} inv={inv} />
          ))}
        </CollapsibleSection>
      ) : null}

      {data.procedures?.length ? (
        <CollapsibleSection title="Procedures" defaultOpen>
          {( data.procedures ?? [] ).map((p, i) => (
            <Text key={`proc-${i}`} style={styles.bulletLine}>
              • {p}
            </Text>
          ))}
        </CollapsibleSection>
      ) : null}
    </View>
  )
}

function Nullable({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  const { styles } = useDetailTheme()
  if (value == null || String(value).trim() === "") return null
  return <FieldRow label={label} value={String(value)} mono={mono} />
}

function MedicationRow({ med }: { med: Medication }) {
  const { styles } = useDetailTheme()
  const bits = [med.dose, med.route, med.frequency, med.duration].filter(
    (x) => x != null && String(x).trim() !== "",
  )
  return (
    <View style={styles.medBlock}>
      <Text style={styles.medName}>{med.name}</Text>
      {bits.length ? (
        <Text style={styles.medSub}>{bits.join(" · ")}</Text>
      ) : null}
      {med.normalized === false ? (
        <Text style={styles.medUnverified}>(unverified)</Text>
      ) : null}
    </View>
  )
}

function VitalsGrid({ vitals }: { vitals: NonNullable<StructuredDataDto["vitals"]> }) {
  const { styles } = useDetailTheme()
  const pairs: [string, string][] = []
  const push = (label: string, v: string | null | undefined) => {
    if (v != null && String(v).trim() !== "") pairs.push([label, String(v)])
  }
  push("BP", vitals.bp)
  push("Pulse", vitals.pulse)
  push("Temp", vitals.temp)
  push("SpO₂", vitals.spo2)
  push("Weight", vitals.weight)
  push("Height", vitals.height)

  return (
    <View style={styles.vitalsGrid}>
      {pairs.map(([k, v]) => (
        <View key={k} style={styles.vitalsCell}>
          <Text style={styles.fieldLabel}>{k}</Text>
          <Text style={styles.fieldValue}>{v}</Text>
        </View>
      ))}
    </View>
  )
}

function InvestigationRow({ inv }: { inv: Investigation }) {
  const { styles } = useDetailTheme()
  const main = [inv.result, inv.unit].filter(Boolean).join(" ")
  return (
    <View style={styles.invBlock}>
      <Text style={styles.invName}>{inv.name}</Text>
      {main ? <Text style={styles.fieldValue}>{main}</Text> : null}
      {inv.normal_range ? (
        <Text style={styles.invRange}>Reference: {inv.normal_range}</Text>
      ) : null}
    </View>
  )
}

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const { styles } = useDetailTheme()
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <GlassCard intensity={42} style={styles.cardGap} contentStyle={styles.collapsibleInner}>
      <Pressable
        style={styles.collapsibleHead}
        onPress={() => setOpen((o) => !o)}
      >
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Text style={styles.collapsibleChev}>{open ? "−" : "+"}</Text>
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </GlassCard>
  )
}

function approveFailureDetail(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return "Approval failed. Please try again."
  }
  const data = err.response?.data
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === "string" && detail.trim()) return detail
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg)
        }
        return String(item)
      })
      const joined = parts.filter(Boolean).join("; ")
      if (joined) return joined
    }
  }
  return "Approval failed. Please try again."
}

function SummaryTab({
  summary,
  loading,
  awaitingPipeline,
  downloading,
  onDownloadPdf,
  documentId,
  onApproved,
}: {
  summary: SummaryDto | null | undefined
  loading: boolean
  awaitingPipeline: boolean
  downloading: boolean
  onDownloadPdf: () => void
  documentId: string
  onApproved: () => void
}) {
  const { styles, theme } = useDetailTheme()
  const [approving, setApproving] = React.useState(false)
  const [approveError, setApproveError] = React.useState<string | null>(null)
  const [approveSuccess, setApproveSuccess] = React.useState(false)

  const handleApprove = React.useCallback(async () => {
    setApproving(true)
    setApproveError(null)
    setApproveSuccess(false)
    try {
      await approveDocument(documentId)
      setApproveSuccess(true)
      onApproved()
    } catch (e: unknown) {
      setApproveError(approveFailureDetail(e))
    } finally {
      setApproving(false)
    }
  }, [documentId, onApproved])

  if (awaitingPipeline && summary === undefined) {
    return (
      <GlassCard intensity={44} contentStyle={styles.emptyTab}>
        <Text style={styles.emptyMuted}>
          Summary will be available after generation completes.
        </Text>
      </GlassCard>
    )
  }
  if (loading || summary === undefined) {
    return (
      <GlassCard intensity={44} contentStyle={styles.loadingTab}>
        <ActivityIndicator color={theme.orange} />
      </GlassCard>
    )
  }
  if (summary === null) {
    return (
      <GlassCard intensity={44} contentStyle={styles.emptyTab}>
        <Text style={styles.emptyMuted}>No summary generated yet.</Text>
      </GlassCard>
    )
  }

  const sumBadge = statusBadgeStyle(summary.status, theme)
  const sections = parseSummaryMarkdown(summary.summary_text)
  const summaryStatus = summary.status.toLowerCase()

  return (
    <GlassCard intensity={44} contentStyle={styles.summaryInner}>
      <View style={styles.summaryBadgeRow}>
        <View style={[styles.schemeChip, { borderColor: theme.orange }]}>
          <Text style={styles.schemeChipText}>{summary.scheme}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: sumBadge.backgroundColor,
              borderColor: sumBadge.borderColor,
            },
          ]}
        >
          <Text style={[styles.statusBadgeText, { color: sumBadge.color }]}>
            {formatStatusLabel(summary.status)}
          </Text>
        </View>
      </View>

      {sections.map((sec, i) => (
        <View key={`sec-${i}`} style={styles.summarySection}>
          {sec.heading ? (
            <Text style={styles.summaryHeading}>{sec.heading}</Text>
          ) : null}
          <Text style={styles.summaryBody}>{sec.body}</Text>
        </View>
      ))}

      <Pressable
        style={[
          styles.downloadBtn,
          (downloading || approving) && styles.downloadBtnBusy,
        ]}
        onPress={onDownloadPdf}
        disabled={downloading || approving}
      >
        {downloading ? (
          <ActivityIndicator color={theme.orangeDark} />
        ) : (
          <Text style={styles.downloadBtnText}>Download PDF</Text>
        )}
      </Pressable>

      {approveSuccess ? (
        <View style={styles.approveOkBanner}>
          <Text style={styles.approveOkText}>
            Document approved successfully
          </Text>
        </View>
      ) : null}

      {summaryStatus === "generated" && approveError ? (
        <View style={styles.approveErrBanner}>
          <Text style={styles.approveErrText}>{approveError}</Text>
        </View>
      ) : null}

      {summaryStatus === "approved" ? (
        <View style={styles.approvedBadge}>
          <Text style={styles.approvedBadgeText}>Approved</Text>
        </View>
      ) : summaryStatus === "generated" ? (
        <Pressable
          style={[styles.approveBtn, approving && styles.downloadBtnBusy]}
          onPress={() => void handleApprove()}
          disabled={approving}
        >
          {approving ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.approveBtnText}>Approve Document</Text>
          )}
        </Pressable>
      ) : null}
    </GlassCard>
  )
}

function createDetailStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  fullSpinner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollPad: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 18,
  },
  cardGap: {
    marginBottom: 0,
  },
  filename: {
    fontSize: 19,
    fontWeight: "700",
    color: theme.navy,
    lineHeight: 26,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  processingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  processingText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.muted,
  },
  metaChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.slate,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.muted,
    letterSpacing: 0.75,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  pipelineInner: {
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  pipelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  pipelineConnector: {
    height: 3,
    flexGrow: 1,
    flexBasis: 0,
    alignSelf: "center",
    marginHorizontal: -2,
    marginBottom: 28,
    borderRadius: 2,
    maxHeight: 3,
  },
  connectorOrange: {
    backgroundColor: theme.orange,
  },
  connectorMuted: {
    backgroundColor: theme.border,
  },
  pipeStep: {
    width: 68,
    alignItems: "center",
  },
  pipeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  pipeCircleFill: {
    backgroundColor: theme.orange,
    borderWidth: 2,
    borderColor: theme.orangeDark,
  },
  pipeCircleFuture: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: theme.border,
  },
  pipeCircleError: {
    backgroundColor: theme.error,
    borderWidth: 2,
    borderColor: theme.error,
  },
  pipeCheck: {
    color: theme.white,
    fontSize: 16,
    fontWeight: "800",
  },
  pipeCross: {
    color: theme.white,
    fontSize: 15,
    fontWeight: "800",
  },
  pipeNum: {
    color: theme.white,
    fontSize: 14,
    fontWeight: "800",
  },
  pipeNumMuted: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  pipeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.navy,
    textAlign: "center",
    lineHeight: 14,
  },
  pipeLabelMuted: {
    color: theme.muted,
    fontWeight: "600",
  },
  pipeLabelError: {
    color: theme.error,
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: theme.glassFillStrong,
    borderRadius: 999,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    gap: 4,
    marginBottom: 4,
  },
  segmentPill: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: "center",
  },
  segmentPillActive: {
    backgroundColor: theme.orange,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.muted,
    textAlign: "center",
  },
  segmentLabelActive: {
    color: theme.white,
  },
  tabCardInner: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 18,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.muted,
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  fieldValue: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.navy,
    lineHeight: 23,
  },
  fieldMono: {
    fontFamily: "monospace",
    fontSize: 14,
  },
  errTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.navy,
    marginBottom: 8,
  },
  errBody: {
    fontSize: 15,
    color: theme.muted,
    marginBottom: 20,
    lineHeight: 22,
  },
  retryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.orangeDark,
    backgroundColor: theme.white,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.orangeDark,
  },
  loadingTab: {
    paddingVertical: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTab: {
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptyMuted: {
    fontSize: 15,
    color: theme.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  structuredWrap: {
    gap: 16,
  },
  structChipBar: {
    gap: 12,
    marginBottom: 4,
  },
  structSaveErrBanner: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(190,18,60,0.25)",
  },
  structSaveErrText: {
    color: theme.error,
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },
  structuredInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.navy,
    backgroundColor: theme.glassFill,
  },
  confirmChipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  confirmChipActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    marginLeft: "auto",
  },
  structEditBtn: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.orange,
  },
  structEditActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  structCancelBtn: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.muted,
  },
  structSaveBtn: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.orange,
    minWidth: 42,
    textAlign: "center",
  },
  structActionMuted: {
    opacity: 0.45,
  },
  diagnosisEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  diagnosisEditInput: {
    flex: 1,
  },
  diagnosisRemoveBtn: {
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  diagnosisRemoveGlyph: {
    color: theme.error,
    fontSize: 18,
    fontWeight: "700",
  },
  structAddLink: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.orange,
    marginTop: 4,
  },
  medEditCard: {
    position: "relative",
    marginBottom: 20,
    paddingTop: 4,
    paddingRight: 28,
  },
  medRemoveBtn: {
    position: "absolute",
    top: 0,
    right: 0,
    padding: 8,
    zIndex: 2,
  },
  medRemoveGlyph: {
    color: theme.error,
    fontSize: 18,
    fontWeight: "700",
  },
  medEditTwoCol: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  medEditCol: {
    flex: 1,
    gap: 6,
  },
  confirmChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmChipGreen: {
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: "#22C55E",
  },
  confirmChipAmber: {
    backgroundColor: "rgba(245,158,11,0.14)",
    borderColor: "#F59E0B",
  },
  confirmChipText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  confirmChipTextGreen: {
    color: "#15803D",
  },
  confirmChipTextAmber: {
    color: "#B45309",
  },
  collapsibleInner: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  collapsibleHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  collapsibleTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.navy,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  collapsibleChev: {
    fontSize: 20,
    fontWeight: "600",
    color: theme.orange,
    marginLeft: 12,
  },
  collapsibleBody: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    paddingTop: 16,
  },
  icdPrimary: {
    backgroundColor: "rgba(249,115,22,0.1)",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.orangeLight,
    gap: 8,
  },
  icdChipText: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.navy,
    lineHeight: 22,
  },
  icdSecondaryLine: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.slate,
    lineHeight: 22,
  },
  blockGap: {
    marginTop: 12,
    gap: 6,
  },
  bulletLine: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.navy,
    lineHeight: 23,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  softPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  softPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.slate,
  },
  medBlock: {
    marginBottom: 14,
    gap: 4,
  },
  medName: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.navy,
  },
  medSub: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.slate,
    lineHeight: 21,
  },
  medUnverified: {
    fontSize: 13,
    fontStyle: "italic",
    color: theme.muted,
  },
  vitalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  vitalsCell: {
    width: "47%",
    gap: 6,
  },
  invBlock: {
    marginBottom: 14,
    gap: 4,
  },
  invName: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.navy,
  },
  invRange: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.muted,
    lineHeight: 19,
  },
  summaryInner: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 18,
  },
  summaryBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  schemeChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: "rgba(249,115,22,0.08)",
  },
  schemeChipText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.orangeDark,
    letterSpacing: 0.6,
  },
  summarySection: {
    gap: 8,
  },
  summaryHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.navy,
    lineHeight: 22,
  },
  summaryBody: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.slate,
    lineHeight: 22,
  },
  downloadBtn: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.orange,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.white,
  },
  downloadBtnBusy: {
    opacity: 0.85,
  },
  downloadBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.orangeDark,
  },
  approvedBadge: {
    alignSelf: "center",
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: "#22C55E",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  approvedBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#15803D",
    letterSpacing: 0.4,
  },
  approveOkBanner: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(34,197,94,0.35)",
  },
  approveOkText: {
    color: "#15803D",
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },
  approveErrBanner: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(190,18,60,0.25)",
  },
  approveErrText: {
    color: theme.error,
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },
  approveBtn: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: theme.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  approveBtnText: {
    color: theme.white,
    fontSize: 16,
    fontWeight: "700",
  },
})
}

type DetailThemeBundle = {
  styles: ReturnType<typeof createDetailStyles>
  theme: ThemeTokens
}

const DetailThemeContext = React.createContext<DetailThemeBundle | null>(null)

function useDetailTheme() {
  const ctx = React.useContext(DetailThemeContext)
  if (!ctx) {
    throw new Error("useDetailTheme must be used within DocumentDetailScreen")
  }
  return ctx
}
