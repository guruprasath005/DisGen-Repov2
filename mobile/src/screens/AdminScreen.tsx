import * as React from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  approveDocument,
  fetchDocuments,
  fetchStats,
  type DocumentDto,
  type DocumentsStats,
} from "../api/documents"
import { DocumentCard } from "../components/DocumentCard"
import { GlassSearchBar } from "../components/GlassSearchBar"
import { useTheme } from "../contexts/ThemeContext"
import { useOpenDocumentDetail } from "../hooks/useOpenDocumentDetail"
import { useTabBarInset } from "../hooks/useTabBarInset"
import type { ThemeTokens } from "../theme"

type AdminSegment = "pending" | "all"

function filterDocumentsByQuery(docs: DocumentDto[], query: string): DocumentDto[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs
  return docs.filter((d) => {
    const byName = d.patient_name?.toLowerCase().includes(q) ?? false
    const byFile = d.filename.toLowerCase().includes(q)
    return byName || byFile
  })
}

function createAdminStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "transparent",
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: theme.navy,
      letterSpacing: -0.6,
    },
    subtitle: {
      marginTop: 6,
      fontSize: 14,
      color: theme.muted,
    },
    statsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 20,
    },
    statsSkeleton: {
      width: "47%",
      borderRadius: 14,
      backgroundColor: theme.border,
      minHeight: 76,
    },
    statsTile: {
      width: "47%",
      borderRadius: 16,
      backgroundColor: theme.glassFill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
      paddingVertical: 14,
      paddingHorizontal: 10,
      shadowColor: theme.navy,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.05,
      shadowRadius: 12,
      elevation: 2,
    },
    statsTileNumber: {
      fontSize: 22,
      fontWeight: "800",
      color: theme.navy,
      textAlign: "center",
    },
    statsTileLabel: {
      marginTop: 4,
      fontSize: 10,
      fontWeight: "700",
      color: theme.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      textAlign: "center",
    },
    segmentWrap: {
      flexDirection: "row",
      marginHorizontal: 20,
      marginBottom: 12,
      marginTop: 4,
      gap: 10,
      backgroundColor: theme.glassFillStrong,
      borderRadius: 999,
      padding: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 11,
      paddingHorizontal: 8,
      borderRadius: 999,
      alignItems: "center",
    },
    segmentBtnActive: {
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
    searchWrap: {
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    listFlex: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 20,
    },
    error: {
      marginHorizontal: 20,
      color: theme.error,
      fontWeight: "500",
      marginBottom: 8,
    },
    empty: {
      marginTop: 32,
      textAlign: "center",
      fontSize: 15,
      color: theme.muted,
      paddingHorizontal: 24,
    },
    quickRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 10,
      marginBottom: 4,
    },
    approveQuick: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(34,197,94,0.14)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#22C55E",
    },
    approveQuickText: {
      fontSize: 14,
      fontWeight: "700",
      color: "#15803D",
    },
    viewQuick: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.glassFillMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
    },
    viewQuickText: {
      fontSize: 14,
      fontWeight: "700",
      color: theme.muted,
    },
  })
}

export function AdminScreen() {
  const tabInset = useTabBarInset()
  const openDetail = useOpenDocumentDetail()
  const { theme } = useTheme()
  const styles = React.useMemo(() => createAdminStyles(theme), [theme])
  const [segment, setSegment] = React.useState<AdminSegment>("pending")
  const [pendingDocs, setPendingDocs] = React.useState<DocumentDto[]>([])
  const [allDocs, setAllDocs] = React.useState<DocumentDto[]>([])
  const [statsData, setStatsData] = React.useState<DocumentsStats | null>(null)
  const [statsLoading, setStatsLoading] = React.useState(true)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    setStatsLoading(true)

    const statsTask = fetchStats()
      .then((s) => setStatsData(s))
      .catch(() => setStatsData(null))
      .finally(() => setStatsLoading(false))

    const listsTask = Promise.all([
      fetchDocuments({ status: "generated", page: 1, perPage: 50 })
        .then((r) => setPendingDocs(r.documents))
        .catch(() => {
          setPendingDocs([])
          setError("Unable to load pending documents.")
        }),
      fetchDocuments({ page: 1, perPage: 100 })
        .then((r) => setAllDocs(r.documents))
        .catch(() => {
          setAllDocs([])
          setError("Unable to load documents.")
        }),
    ])

    await Promise.all([statsTask, listsTask])

    setLoading(false)
    setRefreshing(false)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const filteredAll = React.useMemo(
    () => filterDocumentsByQuery(allDocs, query),
    [allDocs, query],
  )

  function onRefresh() {
    setRefreshing(true)
    void load()
  }

  async function handleApprove(docId: string) {
    try {
      await approveDocument(docId)
      setPendingDocs((prev) => prev.filter((d) => d.id !== docId))
      void fetchStats()
        .then((s) => setStatsData(s))
        .catch(() => {})
      void fetchDocuments({ page: 1, perPage: 100 })
        .then((r) => setAllDocs(r.documents))
        .catch(() => {})
    } catch {
      /* keep row; errors typically rare for optimistic UX */
    }
  }

  const listPaddingBottom = tabInset + 16

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.subtitle}>Review and browse facility documents</Text>
      </View>

      <View style={styles.statsRow}>
        {statsLoading ? (
          <>
            {[0, 1, 2, 3].map((k) => (
              <View key={k} style={styles.statsSkeleton} />
            ))}
          </>
        ) : (
          <>
            <View style={styles.statsTile}>
              <Text style={styles.statsTileNumber}>
                {statsData != null ? String(statsData.total) : "—"}
              </Text>
              <Text style={styles.statsTileLabel}>Total</Text>
            </View>
            <View style={styles.statsTile}>
              <Text style={styles.statsTileNumber}>
                {statsData != null ? String(statsData.pending) : "—"}
              </Text>
              <Text style={styles.statsTileLabel}>Pending</Text>
            </View>
            <View style={styles.statsTile}>
              <Text style={styles.statsTileNumber}>
                {statsData != null ? String(statsData.processing) : "—"}
              </Text>
              <Text style={styles.statsTileLabel}>Processing</Text>
            </View>
            <View style={styles.statsTile}>
              <Text style={styles.statsTileNumber}>
                {statsData != null ? String(statsData.approved) : "—"}
              </Text>
              <Text style={styles.statsTileLabel}>Approved</Text>
            </View>
          </>
        )}
      </View>

      <View style={styles.segmentWrap}>
        <Pressable
          style={[styles.segmentBtn, segment === "pending" && styles.segmentBtnActive]}
          onPress={() => setSegment("pending")}
        >
          <Text
            style={[
              styles.segmentLabel,
              segment === "pending" && styles.segmentLabelActive,
            ]}
          >
            Pending Review
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentBtn, segment === "all" && styles.segmentBtnActive]}
          onPress={() => setSegment("all")}
        >
          <Text
            style={[
              styles.segmentLabel,
              segment === "all" && styles.segmentLabelActive,
            ]}
          >
            All Documents
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {segment === "pending" ? (
        <FlatList
          style={styles.listFlex}
          data={pendingDocs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: listPaddingBottom }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.orange}
            />
          }
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.empty}>No documents awaiting approval.</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <DocumentCard
              doc={item}
              onPress={() => openDetail(item.id)}
              footer={
                <View style={styles.quickRow}>
                  <Pressable
                    style={styles.approveQuick}
                    onPress={() => void handleApprove(item.id)}
                  >
                    <Text style={styles.approveQuickText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    style={styles.viewQuick}
                    onPress={() => openDetail(item.id)}
                  >
                    <Text style={styles.viewQuickText}>View</Text>
                  </Pressable>
                </View>
              }
            />
          )}
        />
      ) : (
        <View style={styles.listFlex}>
          <View style={styles.searchWrap}>
            <GlassSearchBar
              placeholder="Search by patient or filename…"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <FlatList
            style={styles.listFlex}
            data={filteredAll}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: listPaddingBottom }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.orange}
              />
            }
            ListEmptyComponent={
              !loading ? (
                <Text style={styles.empty}>
                  {query.trim()
                    ? "No discharge files match your search."
                    : "No documents in your scope yet."}
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <DocumentCard doc={item} onPress={() => openDetail(item.id)} />
            )}
          />
        </View>
      )}
    </SafeAreaView>
  )
}
