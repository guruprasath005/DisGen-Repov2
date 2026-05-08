import { StatusBar } from "expo-status-bar"
import * as Notifications from "expo-notifications"
import * as React from "react"
import { Platform } from "react-native"

import { AuthProvider } from "./src/contexts/AuthContext"
import { ThemeProvider, useTheme } from "./src/contexts/ThemeContext"
import { UploadQueueProvider } from "./src/hooks/useUploadQueue"
import { RootNavigator } from "./src/navigation/RootNavigator"

function AppStatusBar() {
  const { isDark } = useTheme()
  return <StatusBar style={isDark ? "light" : "dark"} />
}

export default function App() {
  React.useEffect(() => {
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
      })
    }
  }, [])

  return (
    <ThemeProvider>
      <AppStatusBar />
      <AuthProvider>
        <UploadQueueProvider>
          <RootNavigator />
        </UploadQueueProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
