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

import { fetchDocuments } from "../api/documents"
import { DocumentCard } from "../components/DocumentCard"
import { useTabBarInset } from "../hooks/useTabBarInset"
import { useOpenDocumentDetail } from "../hooks/useOpenDocumentDetail"
import { theme } from "../theme"
import { greetingPrefix } from "../utils/greeting"
import { useAuth } from "../contexts/AuthContext"

export function DashboardScreen() {
  const tabInset = useTabBarInset()
  const { user } = useAuth()
  const openDetail = useOpenDocumentDetail()
  const [docs, setDocs] = React.useState<Awaited<
    ReturnType<typeof fetchDocuments>
  >["documents"]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const res = await fetchDocuments({ page: 1, perPage: 5 })
      setDocs(res.documents)
    } catch {
      setError("Could not load recent discharge records.")
      setDocs([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function onRefresh() {
    setRefreshing(true)
    void load()
  }

  const greeting = greetingPrefix()

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
        <Text style={styles.greeting}>
          {greeting},{" "}
          <Text style={styles.greetingName}>{user?.full_name ?? ""}</Text>
        </Text>
        <View style={styles.accentRule} />
        <Text style={styles.subtitle}>
          Facility ID ·{" "}
          <Text style={styles.mono}>{user?.hospital_id ?? "—"}</Text>
        </Text>

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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  greeting: {
    fontSize: 26,
    fontWeight: "700",
    color: theme.navy,
    letterSpacing: -0.55,
    lineHeight: 32,
  },
  accentRule: {
    marginTop: 14,
    width: 42,
    height: 4,
    borderRadius: 4,
    backgroundColor: theme.orange,
    opacity: 0.85,
  },
  greetingName: {
    color: theme.orangeDark,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: theme.muted,
    lineHeight: 20,
  },
  mono: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 13,
    color: theme.slate,
  },
  section: {
    marginTop: 26,
    fontSize: 17,
    fontWeight: "700",
    color: theme.navy,
    letterSpacing: -0.2,
  },
  sectionHint: {
    marginTop: 4,
    fontSize: 13,
    color: theme.muted,
    marginBottom: 16,
  },
  skeletonWrap: {
    gap: 12,
  },
  skeletonCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: theme.glassFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    marginBottom: 12,
    shadowColor: theme.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  skeletonLineShort: {
    height: 10,
    width: "36%",
    borderRadius: 6,
    backgroundColor: "#EEF2F7",
    marginBottom: 12,
  },
  skeletonLineLong: {
    height: 18,
    width: "92%",
    borderRadius: 8,
    backgroundColor: "#EEF2F7",
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
    backgroundColor: "#EEF2F7",
  },
  skeletonDate: {
    height: 12,
    width: 120,
    borderRadius: 6,
    backgroundColor: "#EEF2F7",
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
