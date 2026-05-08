import { Ionicons } from "@expo/vector-icons"
import { BlurView } from "expo-blur"
import * as React from "react"
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native"

import { theme } from "../theme"

type GlassSearchBarProps = Omit<TextInputProps, "style"> & {
  containerStyle?: StyleProp<ViewStyle>
}

export function GlassSearchBar({
  containerStyle,
  ...inputProps
}: GlassSearchBarProps) {
  return (
    <View style={[styles.wrap, containerStyle]}>
      <BlurView
        intensity={Platform.OS === "ios" ? 38 : 28}
        tint="light"
        style={[StyleSheet.absoluteFillObject, styles.blur]}
        pointerEvents="none"
      />
      <View
        style={[styles.veil, StyleSheet.absoluteFillObject]}
        pointerEvents="none"
      />
      <View style={styles.rim} pointerEvents="none" />
      <Ionicons
        name="search"
        size={20}
        color={theme.muted}
        style={styles.icon}
      />
      <TextInput
        {...inputProps}
        style={styles.input}
        placeholderTextColor={theme.muted}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glassStroke,
    minHeight: 52,
    backgroundColor: theme.glassFillStrong,
    shadowColor: theme.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  blur: {
    borderRadius: 18,
  },
  veil: {
    borderRadius: 18,
    backgroundColor:
      Platform.OS === "android"
        ? "rgba(255,255,255,0.88)"
        : "rgba(255,255,255,0.35)",
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.glassStrokeBright,
    opacity: 0.4,
  },
  icon: {
    marginLeft: 16,
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? 14 : 12,
    paddingRight: 16,
    fontSize: 16,
    color: theme.navy,
    backgroundColor: "transparent",
  },
})
