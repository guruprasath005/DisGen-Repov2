import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import * as React from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AppBackground } from "../components/AppBackground"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import { LoginScreen } from "../screens/LoginScreen"

import { navigationRef } from "./navigationRef"
import { MainStackNavigator } from "./MainStack"
import type { RootStackParamList } from "./types"

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  const { user, isLoading } = useAuth()
  const { theme } = useTheme()

  if (isLoading) {
    return (
      <AppBackground variant="login">
        <View style={styles.splash}>
          <ActivityIndicator size="large" color={theme.orange} />
        </View>
      </AppBackground>
    )
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          key={user ? "signed-in" : "signed-out"}
          screenOptions={{ headerShown: false }}
        >
          {user == null ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <Stack.Screen name="Main" component={MainStackNavigator} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
})
