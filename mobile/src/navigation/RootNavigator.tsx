import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { AppBackground } from "../components/AppBackground"
import { theme } from "../theme"
import { useAuth } from "../contexts/AuthContext"
import { LoginScreen } from "../screens/LoginScreen"

import { MainStackNavigator } from "./MainStack"

export type RootStackParamList = {
  Login: undefined
  Main: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  const { user, isLoading } = useAuth()

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
      <NavigationContainer>
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
