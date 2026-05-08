import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import * as ImagePicker from "expo-image-picker"
import * as Print from "expo-print"
import * as React from "react"
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  type ConsentMethod,
  uploadDischargeDocument,
} from "../api/documents"
import { GlassCard } from "../components/GlassCard"
import { useTabBarInset } from "../hooks/useTabBarInset"
import { theme } from "../theme"

function mimeFromPick(mime: string | undefined, name: string): string {
  if (mime && mime !== "") return mime
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff"
  return "application/octet-stream"
}

/** Minimal escaping for img src="" attributes */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
}

const MAX_CAMERA_PHOTOS = 20

export function UploadScreen() {
  const tabInset = useTabBarInset()
  const [patientName, setPatientName] = React.useState("")
  const [pick, setPick] = React.useState<DocumentPicker.DocumentPickerAsset | null>(
    null,
  )
  const [cameraPhotos, setCameraPhotos] = React.useState<
    ImagePicker.ImagePickerAsset[]
  >([])
  const [consentConfirmed, setConsentConfirmed] = React.useState(true)
  const [consentMethod, setConsentMethod] =
    React.useState<ConsentMethod>("written")
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<number | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function handlePick() {
    setError(null)
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/tiff"],
      copyToCacheDirectory: true,
      multiple: false,
    })

    if (result.canceled || !result.assets?.[0]) {
      return
    }
    const asset = result.assets[0]
    setPick(asset)
    setCameraPhotos([])
    setSuccess(null)
  }

  async function handleTakePhoto() {
    setError(null)
    setSuccess(null)

    if (cameraPhotos.length >= MAX_CAMERA_PHOTOS) {
      setError(`You can add up to ${MAX_CAMERA_PHOTOS} photos per upload.`)
      return
    }

    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setError("Camera access is required to photograph clinical documents.")
      return
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 0.92,
      allowsEditing: false,
    })

    if (result.canceled || !result.assets?.[0]) {
      return
    }

    const asset = result.assets[0]
    setPick(null)
    setCameraPhotos((prev) => [...prev, asset])
  }

  function removeCameraPhoto(uri: string) {
    setCameraPhotos((prev) => prev.filter((p) => p.uri !== uri))
  }

  async function handleUpload() {
    const name = patientName.trim()
    if (!name) {
      setError("Patient name is required.")
      return
    }
    if (pick?.uri && cameraPhotos.length > 0) {
      setError(
        "Remove camera photos or clear the selected file before uploading.",
      )
      return
    }
    if (!pick?.uri && cameraPhotos.length === 0) {
      setError("Select a discharge PDF or clinical image, or capture photos.")
      return
    }
    if (!consentConfirmed) {
      setError("Confirm patient consent before uploading.")
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)
    setProgress(0)

    const photoCountForSuccess = cameraPhotos.length

    try {
      if (cameraPhotos.length > 0) {
        const html = cameraPhotos
          .map(
            (p) =>
              `<img src="${escapeHtmlAttr(p.uri)}" style="width:100%;page-break-after:always"/>`,
          )
          .join("")

        let pdfUri: string | null = null
        try {
          const { uri } = await Print.printToFileAsync({ html })
          pdfUri = uri

          const fileName = `discharge_photos_${Date.now()}.pdf`

          const res = await uploadDischargeDocument({
            patientName: name,
            fileUri: uri,
            fileName,
            mimeType: "application/pdf",
            consentGiven: consentConfirmed,
            consentMethod,
            onUploadProgress: (pct) => setProgress(pct),
          })

          if (res.duplicate) {
            setSuccess(
              "This file was already uploaded for your hospital — no duplicate stored.",
            )
          } else {
            setSuccess(
              `${photoCountForSuccess} photo(s) uploaded as one discharge document.`,
            )
          }

          setPatientName("")
          setPick(null)
          setCameraPhotos([])
          setProgress(null)
        } finally {
          if (pdfUri != null) {
            await FileSystem.deleteAsync(pdfUri, { idempotent: true }).catch(
              () => undefined,
            )
          }
        }

        return
      }

      const fileName = pick!.name ?? "document.pdf"
      const mimeType = mimeFromPick(pick!.mimeType ?? undefined, fileName)

      const res = await uploadDischargeDocument({
        patientName: name,
        fileUri: pick!.uri,
        fileName,
        mimeType,
        consentGiven: consentConfirmed,
        consentMethod,
        onUploadProgress: (pct) => setProgress(pct),
      })

      if (res.duplicate) {
        setSuccess(
          "This file was already uploaded for your hospital — no duplicate stored.",
        )
      } else if (res.status === 201) {
        setSuccess(
          "Upload received — OCR and extraction will begin shortly.",
        )
      } else {
        setSuccess("Upload completed.")
      }

      setPatientName("")
      setPick(null)
      setProgress(null)
    } catch (e: unknown) {
      setProgress(null)
      const detail =
        e &&
        typeof e === "object" &&
        "response" in e &&
        (e as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail
      setError(
        typeof detail === "string"
          ? detail
          : "Upload failed. Check your connection and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabInset + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>New Discharge</Text>
        <Text style={styles.subtitle}>
          Secure upload with mandatory consent recording for DPDP compliance.
        </Text>

        <GlassCard
          intensity={42}
          contentStyle={styles.cardInner}
          style={styles.cardShell}
        >
          <Text style={styles.label}>Patient name</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter patient full name"
            placeholderTextColor={theme.muted}
            value={patientName}
            onChangeText={setPatientName}
            editable={!busy}
          />

          <Text style={[styles.label, styles.labelGap]}>Consent method</Text>
          <View style={styles.segment}>
            {(
              [
                ["written", "Written"],
                ["verbal", "Verbal"],
                ["digital", "Digital"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[
                  styles.segmentBtn,
                  consentMethod === value && styles.segmentBtnActive,
                ]}
                disabled={busy}
                onPress={() => setConsentMethod(value)}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    consentMethod === value && styles.segmentLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.consentRow}>
            <Text style={styles.consentText}>
              I confirm explicit patient consent was obtained before upload.
            </Text>
            <Switch
              value={consentConfirmed}
              onValueChange={setConsentConfirmed}
              disabled={busy}
              trackColor={{
                false: theme.border,
                true: theme.orangeLight,
              }}
              thumbColor={consentConfirmed ? theme.orange : "#f4f4f5"}
            />
          </View>

          <View style={styles.pickRow}>
            <Pressable
              style={[styles.pickBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void handlePick()}
            >
              <Text style={styles.pickBtnText}>Select File</Text>
            </Pressable>
            <Pressable
              style={[styles.pickBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void handleTakePhoto()}
            >
              <Text style={styles.pickBtnText}>Take Photo</Text>
            </Pressable>
          </View>

          {pick?.name ? (
            <Text style={styles.fileName}>Selected · {pick.name}</Text>
          ) : (
            <Text style={styles.fileHint}>
              PDF, JPEG, PNG, or TIFF · max 25 MB
            </Text>
          )}

          {cameraPhotos.length > 0 ? (
            <>
              <Text style={styles.photoCount}>
                {`${cameraPhotos.length} photo(s) ready`}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbStrip}
              >
                {cameraPhotos.map((p, index) => (
                  <View key={`${p.uri}-${index}`} style={styles.thumbWrap}>
                    <Image
                      source={{ uri: p.uri }}
                      style={styles.thumbImage}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={styles.thumbRemove}
                      hitSlop={10}
                      disabled={busy}
                      onPress={() => removeCameraPhoto(p.uri)}
                    >
                      <Text style={styles.thumbRemoveGlyph}>✕</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}

          {progress !== null && busy ? (
            <View style={styles.progressOuter}>
              <View
                style={[styles.progressInner, { width: `${progress}%` }]}
              />
            </View>
          ) : null}

          {error ? (
            <View style={styles.errBanner}>
              <Text style={styles.errText}>{error}</Text>
            </View>
          ) : null}

          {success ? (
            <View style={styles.okBanner}>
              <Text style={styles.okText}>{success}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.uploadBtn, busy && styles.uploadBtnBusy]}
            disabled={busy}
            onPress={() => void handleUpload()}
          >
            {busy ? (
              <ActivityIndicator color={theme.white} />
            ) : (
              <Text style={styles.uploadBtnText}>Upload</Text>
            )}
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: theme.navy,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: theme.muted,
    lineHeight: 21,
    marginBottom: 18,
    maxWidth: 340,
  },
  cardShell: {
    marginBottom: 8,
  },
  cardInner: {
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.slate,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  labelGap: {
    marginTop: 18,
  },
  input: {
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 15 : 13,
    fontSize: 16,
    color: theme.navy,
    backgroundColor: theme.glassFill,
  },
  segment: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    backgroundColor: theme.glassFillMuted,
    alignItems: "center",
  },
  segmentBtnActive: {
    borderColor: theme.orange,
    backgroundColor: "rgba(249,115,22,0.12)",
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.muted,
  },
  segmentLabelActive: {
    color: theme.orangeDark,
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    backgroundColor: theme.glassFillMuted,
  },
  consentText: {
    flex: 1,
    fontSize: 14,
    color: theme.navy,
    lineHeight: 20,
    fontWeight: "500",
  },
  pickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 22,
  },
  pickBtn: {
    flex: 1,
    minWidth: 130,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: theme.orange,
    backgroundColor: theme.glassFillStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  pickBtnText: {
    fontWeight: "700",
    color: theme.orangeDark,
    fontSize: 15,
  },
  disabled: {
    opacity: 0.55,
  },
  fileName: {
    marginTop: 14,
    fontSize: 14,
    color: theme.slate,
    fontWeight: "600",
  },
  fileHint: {
    marginTop: 14,
    fontSize: 13,
    color: theme.muted,
  },
  photoCount: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: "600",
    color: theme.slate,
  },
  thumbStrip: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 12,
    paddingRight: 4,
  },
  thumbWrap: {
    width: 82,
    height: 82,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    backgroundColor: theme.border,
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(15,23,42,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbRemoveGlyph: {
    color: theme.white,
    fontSize: 14,
    fontWeight: "700",
    marginTop: -1,
  },
  progressOuter: {
    marginTop: 18,
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.border,
    overflow: "hidden",
  },
  progressInner: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.orange,
  },
  errBanner: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(190,18,60,0.25)",
  },
  errText: {
    color: theme.error,
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },
  okBanner: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(34,197,94,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(34,197,94,0.35)",
  },
  okText: {
    color: "#15803D",
    fontWeight: "600",
    fontSize: 14,
    lineHeight: 20,
  },
  uploadBtn: {
    marginTop: 26,
    backgroundColor: theme.orange,
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    shadowColor: theme.orangeDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
  uploadBtnBusy: {
    opacity: 0.85,
  },
  uploadBtnText: {
    color: theme.white,
    fontSize: 17,
    fontWeight: "700",
  },
})
