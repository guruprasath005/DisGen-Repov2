import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"

import { theme } from "../theme"

type Variant = "app" | "login"

interface AppBackgroundProps {
  children: React.ReactNode
  variant?: Variant
  style?: StyleProp<ViewStyle>
}

export function AppBackground({
  children,
  variant = "app",
  style,
}: AppBackgroundProps) {
  const colors =
    variant === "login"
      ? theme.gradientLoginColors
      : theme.gradientColors

  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={[...colors]}
        locations={[...theme.gradientLocations]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Soft vignette for depth */}
      <LinearGradient
        colors={["transparent", "rgba(249,115,22,0.04)", "transparent"]}
        start={{ x: 0.5, y: 0.85 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
})
