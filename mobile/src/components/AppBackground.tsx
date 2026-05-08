import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"

import { ClinicalMeshOverlay } from "./ClinicalMeshOverlay"
import { useTheme } from "../contexts/ThemeContext"
import { gradientTuple } from "../theme"

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
  const { theme, isDark } = useTheme()

  const colors =
    variant === "login"
      ? theme.gradientLoginColors
      : theme.gradientColors

  const vignetteOpacity = isDark ? 0.06 : 0.04

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }, style]}>
      <LinearGradient
        colors={gradientTuple(colors)}
        locations={[...theme.gradientLocations]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <ClinicalMeshOverlay />
      <LinearGradient
        colors={[
          "transparent",
          `rgba(249,115,22,${vignetteOpacity})`,
          "transparent",
        ]}
        locations={[0.65, 0.92, 1]}
        start={{ x: 0.5, y: 0 }}
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
  },
})
