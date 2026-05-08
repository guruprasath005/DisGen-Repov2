import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs"
import { BlurView } from "expo-blur"
import * as React from "react"
import { Platform, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useTheme } from "../contexts/ThemeContext"
import type { ThemeTokens } from "../theme"

function createGlassTabStyles(theme: ThemeTokens, isDark: boolean) {
  const clipBg =
    Platform.OS === "android"
      ? isDark
        ? "rgba(30,41,59,0.94)"
        : "rgba(252,252,253,0.94)"
      : isDark
        ? "rgba(30,41,59,0.45)"
        : "rgba(255,255,255,0.45)"

  const androidVeil =
    Platform.OS === "android"
      ? isDark
        ? "rgba(30,41,59,0.82)"
        : "rgba(255,255,255,0.72)"
      : isDark
        ? "rgba(15,23,42,0.35)"
        : "rgba(255,255,255,0.08)"

  return StyleSheet.create({
    outer: {
      position: "absolute",
      left: 18,
      right: 18,
    },
    shadowPlate: {
      borderRadius: 28,
      shadowColor: theme.navy,
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.14,
      shadowRadius: 28,
      elevation: 22,
    },
    clip: {
      borderRadius: 28,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
      backgroundColor: clipBg,
    },
    blur: {
      borderRadius: 28,
    },
    androidVeil: {
      backgroundColor: androidVeil,
      borderRadius: 28,
    },
    innerRim: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: theme.glassStrokeBright,
      opacity: isDark ? 0.35 : 0.55,
    },
  })
}

export function GlassTabBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const bottom = Math.max(insets.bottom, 12)
  const { theme, isDark } = useTheme()
  const styles = React.useMemo(
    () => createGlassTabStyles(theme, isDark),
    [theme, isDark],
  )

  return (
    <View style={[styles.outer, { bottom }]} pointerEvents="box-none">
      <View style={styles.shadowPlate}>
        <View style={styles.clip}>
          <BlurView
            intensity={Platform.OS === "ios" ? 85 : 55}
            tint={isDark ? "dark" : "light"}
            style={[StyleSheet.absoluteFillObject, styles.blur]}
            pointerEvents="none"
          />
          <View
            style={[styles.androidVeil, StyleSheet.absoluteFillObject]}
            pointerEvents="none"
          />
          <BottomTabBar
            {...props}
            insets={{
              ...props.insets,
              bottom: 0,
              top: 0,
              left: 0,
              right: 0,
            }}
            style={{
              backgroundColor: "transparent",
              borderTopWidth: 0,
              elevation: 0,
              shadowOpacity: 0,
              height: 62,
              paddingTop: 6,
              paddingBottom: 8,
            }}
          />
          <View style={styles.innerRim} pointerEvents="none" />
        </View>
      </View>
    </View>
  )
}
