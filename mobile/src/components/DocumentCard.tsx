import * as React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { theme } from "../theme"
import { formatStatusLabel, statusBadgeStyle } from "../utils/statusBadge"
import type { DocumentDto } from "../api/documents"

interface DocumentCardProps {
  doc: DocumentDto
  onPress: () => void
}

export function DocumentCard({ doc, onPress }: DocumentCardProps) {
  const badge = statusBadgeStyle(doc.status)
  const created = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(doc.created_at))
    } catch {
      return doc.created_at
    }
  }, [doc.created_at])

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.topAccent} />
      <Text style={styles.label}>Discharge file</Text>
      <Text style={styles.title} numberOfLines={2}>
        {doc.filename}
      </Text>
      <View style={styles.row}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: badge.backgroundColor,
              borderColor: badge.borderColor,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: badge.color }]}>
            {formatStatusLabel(doc.status)}
          </Text>
        </View>
        <Text style={styles.date}>{created}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 17,
    paddingTop: 15,
    backgroundColor: theme.glassFillStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    marginBottom: 12,
    overflow: "hidden",
    shadowColor: theme.navy,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 22,
    elevation: 4,
  },
  cardPressed: {
    transform: [{ scale: 0.992 }],
    borderColor: theme.orangeLight,
    shadowOpacity: 0.09,
  },
  topAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: theme.orange,
    opacity: 0.55,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.85,
    textTransform: "uppercase",
    color: theme.muted,
    marginBottom: 6,
    marginTop: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.navy,
    lineHeight: 22,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    gap: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  date: {
    flex: 1,
    textAlign: "right",
    fontSize: 12,
    color: theme.muted,
    fontWeight: "500",
  },
})
