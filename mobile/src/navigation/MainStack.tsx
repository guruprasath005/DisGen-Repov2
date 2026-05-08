import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { Platform, StyleSheet, View } from "react-native"

import { ClinicalMeshOverlay } from "../components/ClinicalMeshOverlay"
import { useTheme } from "../contexts/ThemeContext"
import { usePushNotifications } from "../hooks/usePushNotifications"
import { DocumentDetailScreen } from "../screens/DocumentDetailScreen"
import { gradientTuple } from "../theme"
import { MainTabsNavigator } from "./MainTabs"
import type { MainStackParamList } from "./types"

const Stack = createNativeStackNavigator<MainStackParamList>()

export function MainStackNavigator() {
  usePushNotifications()
  const { theme, isDark } = useTheme()

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={gradientTuple(theme.gradientColors)}
        locations={[...theme.gradientLocations]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <ClinicalMeshOverlay />
      <LinearGradient
        colors={[
          "transparent",
          `rgba(249,115,22,${isDark ? 0.06 : 0.04})`,
          "transparent",
        ]}
        locations={[0.65, 0.92, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <Stack.Navigator
        screenOptions={{
          contentStyle: { backgroundColor: "transparent" },
          headerShown: false,
        }}
      >
        <Stack.Screen name="Tabs" component={MainTabsNavigator} />
        <Stack.Screen
          name="DocumentDetail"
          component={DocumentDetailScreen}
          options={{
            headerShown: true,
            title: "Document",
            headerTintColor: theme.orangeDark,
            headerTransparent: Platform.OS === "ios",
            headerBlurEffect:
              Platform.OS === "ios" ? (isDark ? "dark" : "light") : undefined,
            headerStyle: {
              backgroundColor:
                Platform.OS === "ios"
                  ? "transparent"
                  : theme.glassFillStrong,
              ...(Platform.OS === "android"
                ? {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.glassStroke,
                  }
                : {}),
            },
            headerShadowVisible: Platform.OS === "android",
            headerTitleStyle: {
              fontWeight: "700",
              color: theme.navy,
              fontSize: 17,
            },
          }}
        />
      </Stack.Navigator>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
})
