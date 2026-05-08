import { BlurView } from "expo-blur"
import * as React from "react"
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useTheme } from "../contexts/ThemeContext"

interface GlassCardProps {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  intensity?: number
}

/** Single-panel frost — avoid nesting many blur views in long lists (cost). */
export function GlassCard({
  children,
  style,
  contentStyle,
  intensity = Platform.OS === "ios" ? 48 : 36,
}: GlassCardProps) {
  const { theme, isDark } = useTheme()

  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        shell: {
          borderRadius: 20,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.glassStroke,
          shadowColor: "#0F172A",
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: isDark ? 0.45 : 0.08,
          shadowRadius: 24,
          elevation: 10,
          backgroundColor: theme.glassFillStrong,
        },
        blur: {
          borderRadius: 20,
        },
        fallbackTint: {
          backgroundColor:
            Platform.OS === "android"
              ? theme.glassFillStrong
              : isDark
                ? "rgba(30,41,59,0.35)"
                : "rgba(255,255,255,0.12)",
          borderRadius: 20,
        },
        rim: {
          borderRadius: 20,
          borderWidth: 1,
          borderColor: theme.glassStrokeBright,
          opacity: isDark ? 0.25 : 0.45,
        },
        inner: {
          position: "relative",
          padding: 22,
        },
      }),
    [theme, isDark],
  )

  return (
    <View style={[styles.shell, style]}>
      <BlurView
        intensity={intensity}
        tint={isDark ? "dark" : "light"}
        style={[StyleSheet.absoluteFillObject, styles.blur]}
        pointerEvents="none"
      />
      <View
        style={[styles.fallbackTint, StyleSheet.absoluteFillObject]}
        pointerEvents="none"
      />
      <View style={[styles.rim, StyleSheet.absoluteFillObject]} pointerEvents="none" />
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </View>
  )
}
