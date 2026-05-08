import * as React from "react"
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { fetchDocuments, type DocumentDto } from "../api/documents"
import { DocumentCard } from "../components/DocumentCard"
import { GlassSearchBar } from "../components/GlassSearchBar"
import { useTheme } from "../contexts/ThemeContext"
import { useOpenDocumentDetail } from "../hooks/useOpenDocumentDetail"
import { useTabBarInset } from "../hooks/useTabBarInset"
import type { ThemeTokens } from "../theme"

function createDocumentsStyles(theme: ThemeTokens) {
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
    searchWrap: {
      paddingHorizontal: 20,
      marginBottom: 8,
      marginTop: 14,
    },
    listContent: {
      paddingHorizontal: 20,
    },
    centerNote: {
      textAlign: "center",
      marginTop: 24,
      color: theme.muted,
      fontSize: 14,
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
  })
}

export function DocumentsScreen() {
  const tabInset = useTabBarInset()
  const { theme } = useTheme()
  const styles = React.useMemo(() => createDocumentsStyles(theme), [theme])
  const openDetail = useOpenDocumentDetail()
  const [docs, setDocs] = React.useState<DocumentDto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const res = await fetchDocuments({ page: 1, perPage: 100 })
      setDocs(res.documents)
    } catch {
      setError("Unable to load documents.")
      setDocs([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => {
      const byName = d.patient_name?.toLowerCase().includes(q) ?? false
      const byFile = d.filename.toLowerCase().includes(q)
      return byName || byFile
    })
  }, [docs, query])

  function onRefresh() {
    setRefreshing(true)
    void load()
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Documents</Text>
        <Text style={styles.subtitle}>Authorized discharge records</Text>
      </View>

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

      {loading ? (
        <Text style={styles.centerNote}>Loading records…</Text>
      ) : null}

      {!loading && error ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabInset + 16 }]}
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
    </SafeAreaView>
  )
}
