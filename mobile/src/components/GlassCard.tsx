import { BlurView } from "expo-blur"
import * as React from "react"
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { theme } from "../theme"

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
  return (
    <View style={[styles.shell, style]}>
      <BlurView
        intensity={intensity}
        tint="light"
        style={[StyleSheet.absoluteFillObject, styles.blur]}
        pointerEvents="none"
      />
      {/* Solid fallback helps Android readability while blur composites */}
      <View
        style={[styles.fallbackTint, StyleSheet.absoluteFillObject]}
        pointerEvents="none"
      />
      <View style={[styles.rim, StyleSheet.absoluteFillObject]} pointerEvents="none" />
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    shadowColor: theme.navy,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.09,
    shadowRadius: 28,
    elevation: 8,
    backgroundColor: theme.glassFillStrong,
  },
  blur: {
    borderRadius: 22,
  },
  fallbackTint: {
    backgroundColor:
      Platform.OS === "android"
        ? "rgba(255,255,255,0.82)"
        : "rgba(255,255,255,0.12)",
    borderRadius: 22,
  },
  rim: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.glassStrokeBright,
    opacity: 0.45,
  },
  inner: {
    position: "relative",
    padding: 22,
  },
})
