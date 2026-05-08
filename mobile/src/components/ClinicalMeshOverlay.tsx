import * as React from "react"
import { StyleSheet, View } from "react-native"

import { useTheme } from "../contexts/ThemeContext"

/**
 * Soft radial-style blobs mirroring the web `bg-clinical-mesh` treatment
 * (frontend/src/index.css + AppShell gradients).
 */
export function ClinicalMeshOverlay() {
  const { isDark } = useTheme()
  const a = isDark ? 0.42 : 1

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View
        style={[
          styles.blob,
          {
            top: "-14%",
            left: "-18%",
            backgroundColor: `rgba(249,115,22,${0.09 * a})`,
          },
        ]}
      />
      <View
        style={[
          styles.blob,
          {
            top: "-8%",
            right: "-22%",
            backgroundColor: `rgba(59,130,246,${0.055 * a})`,
          },
        ]}
      />
      <View
        style={[
          styles.blob,
          {
            bottom: "-16%",
            left: "-14%",
            backgroundColor: `rgba(249,115,22,${0.045 * a})`,
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  blob: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
  },
})
