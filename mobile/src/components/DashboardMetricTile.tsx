import { Ionicons } from "@expo/vector-icons"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { StyleSheet, Text, View } from "react-native"

import { useTheme } from "../contexts/ThemeContext"
import type { ThemeTokens } from "../theme"

export type MetricAccent = "slate" | "emerald" | "violet" | "sky"

const ACCENT = {
  slate: {
    ring: ["rgba(71,85,105,0.20)", "rgba(148,163,184,0.06)", "transparent"] as const,
    iconBg: "rgba(71,85,105,0.14)",
    iconRing: "rgba(71,85,105,0.32)",
    iconColor: "#334155",
  },
  emerald: {
    ring: ["rgba(16,185,129,0.18)", "rgba(52,211,153,0.08)", "transparent"] as const,
    iconBg: "rgba(16,185,129,0.14)",
    iconRing: "rgba(16,185,129,0.35)",
    iconColor: "#047857",
  },
  violet: {
    ring: ["rgba(139,92,246,0.18)", "rgba(167,139,250,0.07)", "transparent"] as const,
    iconBg: "rgba(139,92,246,0.14)",
    iconRing: "rgba(139,92,246,0.38)",
    iconColor: "#6D28D9",
  },
  sky: {
    ring: ["rgba(14,165,233,0.18)", "rgba(56,189,248,0.08)", "transparent"] as const,
    iconBg: "rgba(14,165,233,0.14)",
    iconRing: "rgba(14,165,233,0.38)",
    iconColor: "#0369A1",
  },
} satisfies Record<
  MetricAccent,
  {
    ring: readonly [string, string, string]
    iconBg: string
    iconRing: string
    iconColor: string
  }
>

function createMetricStyles(
  theme: ThemeTokens,
  accent: MetricAccent,
  isDark: boolean,
) {
  const tone = ACCENT[accent]
  return StyleSheet.create({
    wrap: {
      flex: 1,
      minWidth: 0,
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor:
        theme.border === "#1E293B"
          ? "rgba(148,163,184,0.22)"
          : "rgba(226,232,240,0.95)",
      backgroundColor: theme.glassFillStrong,
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.35 : 0.09,
      shadowRadius: 18,
      elevation: 5,
    },
    gradient: {
      ...StyleSheet.absoluteFillObject,
      opacity: isDark ? 0.55 : 0.92,
    },
    inner: {
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 16,
      position: "relative",
    },
    topRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 10,
    },
    title: {
      flex: 1,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.55,
      textTransform: "uppercase",
      color: theme.muted,
      lineHeight: 15,
    },
    iconChip: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tone.iconBg,
      borderWidth: 2,
      borderColor: tone.iconRing,
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 2,
    },
    value: {
      fontSize: 28,
      fontWeight: "700",
      letterSpacing: -0.8,
      color: theme.navy,
      fontVariant: ["tabular-nums"],
    },
    skeleton: {
      marginTop: 2,
      height: 34,
      width: "72%",
      borderRadius: 8,
      backgroundColor: theme.border,
      opacity: 0.85,
    },
    subtitle: {
      marginTop: 8,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: "500",
      color: theme.muted,
    },
  })
}

interface DashboardMetricTileProps {
  title: string
  value: string
  subtitle?: string
  icon: keyof typeof Ionicons.glyphMap
  accent: MetricAccent
  loading: boolean
}

export function DashboardMetricTile({
  title,
  value,
  subtitle,
  icon,
  accent,
  loading,
}: DashboardMetricTileProps) {
  const { theme, isDark } = useTheme()
  const tone = ACCENT[accent]
  const iconColor = isDark ? "#F8FAFC" : tone.iconColor
  const styles = React.useMemo(
    () => createMetricStyles(theme, accent, isDark),
    [theme, accent, isDark],
  )

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[...tone.ring]}
        locations={[0, 0.45, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.15, y: 1 }}
        style={styles.gradient}
        pointerEvents="none"
      />
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Text style={styles.title}>{title}</Text>
          <View style={styles.iconChip}>
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>
        </View>
        {loading ? (
          <View style={styles.skeleton} />
        ) : (
          <Text style={styles.value}>{value}</Text>
        )}
        {!loading && subtitle ? (
          <Text style={styles.subtitle}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  )
}
