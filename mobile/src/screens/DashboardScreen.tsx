import { Ionicons } from "@expo/vector-icons"
import * as React from "react"
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchDocuments, fetchStats, type DocumentsStats } from "../api/documents"
import { DashboardMetricTile } from "../components/DashboardMetricTile"
import { DocumentCard } from "../components/DocumentCard"
import { GlassCard } from "../components/GlassCard"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import { useOpenDocumentDetail } from "../hooks/useOpenDocumentDetail"
import { useTabBarInset } from "../hooks/useTabBarInset"
import { useUploadQueue } from "../hooks/useUploadQueue"
import type { ThemeTokens } from "../theme"
import { greetingPrefix } from "../utils/greeting"

function createDashboardStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "transparent",
    },
    scroll: {
      paddingHorizontal: 20,
      paddingBottom: 32,
      paddingTop: 10,
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    heroIconChip: {
      width: 46,
      height: 46,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(249,115,22,0.14)",
      borderWidth: 2,
      borderColor: "rgba(249,115,22,0.38)",
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 3,
    },
    heroTextCol: {
      flex: 1,
      minWidth: 0,
    },
    heroTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: theme.navy,
      letterSpacing: -0.55,
      lineHeight: 28,
    },
    heroName: {
      marginTop: 4,
      fontSize: 15,
      fontWeight: "400",
      color: theme.muted,
      letterSpacing: -0.1,
      lineHeight: 21,
    },
    heroLead: {
      marginTop: 14,
      fontSize: 14,
      color: theme.muted,
      lineHeight: 21,
      maxWidth: 400,
    },
    facilityRow: {
      marginTop: 14,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    facilityLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.slate,
      letterSpacing: 0.15,
    },
    mono: {
      fontFamily: Platform.select({
        ios: "Menlo",
        android: "monospace",
        default: "monospace",
      }),
      fontSize: 13,
      fontWeight: "500",
      color: theme.slate,
    },
    doctorHint: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    doctorHintText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: theme.muted,
      fontWeight: "500",
      textAlign: "center",
    },
    metricsSection: {
      marginTop: 22,
      gap: 10,
    },
    metricsPair: {
      flexDirection: "row",
      gap: 10,
      alignItems: "stretch",
    },
    queueBanner: {
      marginTop: 14,
      padding: 12,
      borderRadius: 14,
      backgroundColor: "rgba(245,158,11,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#F59E0B",
    },
    queueBannerText: {
      fontSize: 13,
      fontWeight: "600",
      color: "#B45309",
    },
    section: {
      marginTop: 28,
      fontSize: 17,
      fontWeight: "700",
      color: theme.navy,
      letterSpacing: -0.35,
    },
    sectionHint: {
      marginTop: 6,
      fontSize: 13,
      color: theme.muted,
      marginBottom: 16,
      lineHeight: 19,
    },
    skeletonWrap: {
      gap: 12,
    },
    skeletonCard: {
      borderRadius: 16,
      padding: 16,
      backgroundColor: theme.glassFill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
      marginBottom: 12,
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 14,
      elevation: 3,
    },
    skeletonLineShort: {
      height: 10,
      width: "36%",
      borderRadius: 6,
      backgroundColor: theme.border,
      marginBottom: 12,
    },
    skeletonLineLong: {
      height: 18,
      width: "92%",
      borderRadius: 8,
      backgroundColor: theme.border,
      marginBottom: 16,
    },
    skeletonRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    skeletonPill: {
      height: 26,
      width: 88,
      borderRadius: 999,
      backgroundColor: theme.border,
    },
    skeletonDate: {
      height: 12,
      width: 120,
      borderRadius: 6,
      backgroundColor: theme.border,
    },
    error: {
      color: theme.error,
      fontSize: 14,
      marginBottom: 12,
      fontWeight: "500",
    },
    empty: {
      fontSize: 15,
      color: theme.muted,
      marginTop: 8,
    },
  })
}

export function DashboardScreen() {
  const { theme } = useTheme()
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme])
  const tabInset = useTabBarInset()
  const { user } = useAuth()
  const { pendingCount } = useUploadQueue()
  const openDetail = useOpenDocumentDetail()
  const [docs, setDocs] = React.useState<Awaited<
    ReturnType<typeof fetchDocuments>
  >["documents"]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [statsData, setStatsData] = React.useState<DocumentsStats | null>(null)
  const [statsLoading, setStatsLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setError(null)
    setStatsLoading(true)

    const docsTask = fetchDocuments({ page: 1, perPage: 5 })
      .then((res) => {
        setDocs(res.documents)
      })
      .catch(() => {
        setError("Could not load recent discharge records.")
        setDocs([])
      })

    const statsTask = fetchStats()
      .then((s) => {
        setStatsData(s)
      })
      .catch(() => {
        setStatsData(null)
      })
      .finally(() => {
        setStatsLoading(false)
      })

    await Promise.all([docsTask, statsTask])

    setLoading(false)
    setRefreshing(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function onRefresh() {
    setRefreshing(true)
    void load()
  }

  const greeting = greetingPrefix()

  const corpusSubtitle =
    user?.role === "doctor"
      ? "Documents uploaded under your account."
      : "Active records in your authorized hospital scope."

  const approvalSubtitle =
    statsData != null && statsData.total > 0
      ? `${Math.min(
          100,
          Math.round((statsData.approved / statsData.total) * 100),
        )}% of scoped corpus carries an approved summary.`
      : undefined

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabInset + 12 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.orange}
          />
        }
      >
        <View style={styles.heroRow}>
          <View style={styles.heroIconChip}>
            <Ionicons name="grid-outline" size={24} color={theme.orange} />
          </View>
          <View style={styles.heroTextCol}>
            <Text style={styles.heroTitle}>{greeting}</Text>
            {user?.full_name ? (
              <Text style={styles.heroName}>{user.full_name}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.heroLead}>
          Operational snapshot of the discharge pipeline — queue depth,
          in-flight processing, and your latest uploads.
        </Text>

        <View style={styles.facilityRow}>
          <Text style={styles.facilityLabel}>Facility ID</Text>
          <Text style={styles.mono}>{user?.hospital_id ?? "—"}</Text>
        </View>

        {user?.role === "doctor" ? (
          <GlassCard intensity={40} style={{ marginTop: 16 }} contentStyle={{ paddingVertical: 14 }}>
            <View style={styles.doctorHint}>
              <Ionicons
                name="bar-chart-outline"
                size={22}
                color={theme.orange}
              />
              <Text style={styles.doctorHintText}>
                Metrics below reflect documents tied to your submissions and
                visibility rules.
              </Text>
            </View>
          </GlassCard>
        ) : null}

        <View style={styles.metricsSection}>
          <View style={styles.metricsPair}>
            <DashboardMetricTile
              title="Documents in corpus"
              value={statsData != null ? String(statsData.total) : "—"}
              subtitle={corpusSubtitle}
              icon="documents-outline"
              accent="slate"
              loading={statsLoading}
            />
            <DashboardMetricTile
              title="Pending intake"
              value={statsData != null ? String(statsData.pending) : "—"}
              subtitle="Awaiting triage or OCR assignment."
              icon="time-outline"
              accent="sky"
              loading={statsLoading}
            />
          </View>
          <View style={styles.metricsPair}>
            <DashboardMetricTile
              title="In pipeline"
              value={statsData != null ? String(statsData.processing) : "—"}
              subtitle="Currently extracting or generating summaries."
              icon="sync-outline"
              accent="violet"
              loading={statsLoading}
            />
            <DashboardMetricTile
              title="Approved summaries"
              value={statsData != null ? String(statsData.approved) : "—"}
              subtitle={approvalSubtitle}
              icon="checkmark-circle-outline"
              accent="emerald"
              loading={statsLoading}
            />
          </View>
        </View>

        {pendingCount > 0 ? (
          <View style={styles.queueBanner}>
            <Text style={styles.queueBannerText}>
              {pendingCount} upload(s) queued — will sync when back online.
            </Text>
          </View>
        ) : null}

        <Text style={styles.section}>Recent discharge records</Text>
        <Text style={styles.sectionHint}>
          Latest five uploads in your authorized scope.
        </Text>

        {loading ? (
          <View style={styles.skeletonWrap}>
            {[0, 1, 2, 3, 4].map((k) => (
              <View key={k} style={styles.skeletonCard}>
                <View style={styles.skeletonLineShort} />
                <View style={styles.skeletonLineLong} />
                <View style={styles.skeletonRow}>
                  <View style={styles.skeletonPill} />
                  <View style={styles.skeletonDate} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {!loading && error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}

        {!loading && !error && docs.length === 0 ? (
          <Text style={styles.empty}>No discharge documents yet.</Text>
        ) : null}

        {!loading &&
          docs.map((d) => (
            <DocumentCard
              key={d.id}
              doc={d}
              onPress={() => openDetail(d.id)}
            />
          ))}
      </ScrollView>
    </SafeAreaView>
  )
}
