import * as React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useTheme } from "../contexts/ThemeContext"
import type { DocumentDto } from "../api/documents"
import { formatStatusLabel, statusAccentColor, statusBadgeStyle } from "../utils/statusBadge"

interface DocumentCardProps {
  doc: DocumentDto
  onPress: () => void
  footer?: React.ReactNode
}

export function DocumentCard({ doc, onPress, footer }: DocumentCardProps) {
  const { theme } = useTheme()
  const badge = statusBadgeStyle(doc.status, theme)
  const accentBar = statusAccentColor(doc.status)

  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        card: {
          borderRadius: 16,
          padding: 17,
          paddingTop: 15,
          backgroundColor: theme.glassFillStrong,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor:
            theme.border === "#1E293B"
              ? "rgba(148,163,184,0.22)"
              : "rgba(226,232,240,0.95)",
          marginBottom: 12,
          overflow: "hidden",
          shadowColor: "#0F172A",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 18,
          elevation: 5,
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
          backgroundColor: accentBar,
          opacity: 1,
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
          letterSpacing: -0.25,
          lineHeight: 22,
        },
        patientLine: {
          fontSize: 14,
          fontWeight: "500",
          color: theme.muted,
          marginBottom: 12,
          letterSpacing: -0.1,
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
      }),
    [theme, accentBar],
  )

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
      <Text
        style={[styles.title, { marginBottom: doc.patient_name ? 4 : 12 }]}
        numberOfLines={2}
      >
        {doc.filename}
      </Text>
      {doc.patient_name ? (
        <Text style={styles.patientLine} numberOfLines={1}>
          {doc.patient_name}
        </Text>
      ) : null}
      {footer}
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
