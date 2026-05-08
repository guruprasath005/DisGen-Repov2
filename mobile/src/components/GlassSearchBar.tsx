import * as React from "react"
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native"

import { useTheme } from "../contexts/ThemeContext"

type GlassSearchBarProps = TextInputProps

export function GlassSearchBar(props: GlassSearchBarProps) {
  const { theme } = useTheme()

  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        shell: {
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: Platform.OS === "ios" ? 11 : 8,
          backgroundColor: theme.glassFillStrong,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.glassStroke,
          shadowColor: theme.navy,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.05,
          shadowRadius: 18,
          elevation: 3,
        },
        input: {
          flex: 1,
          marginLeft: 10,
          fontSize: 16,
          color: theme.navy,
          paddingVertical: Platform.OS === "ios" ? 6 : 4,
        },
      }),
    [theme],
  )

  return (
    <View style={styles.shell}>
      <TextInput
        placeholderTextColor={theme.muted}
        style={styles.input}
        {...props}
      />
    </View>
  )
}
