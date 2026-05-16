import { StatusBar } from "expo-status-bar"
import * as React from "react"

import { AuthProvider } from "./src/contexts/AuthContext"
import { ThemeProvider, useTheme } from "./src/contexts/ThemeContext"
import { UploadQueueProvider } from "./src/hooks/useUploadQueue"
import { RootNavigator } from "./src/navigation/RootNavigator"

// NOTE: expo-notifications is intentionally NOT imported here. Statically
// importing it (and eagerly creating the Android channel on every launch)
// evaluated the native module in Expo Go SDK 53+ and crashed dev — the cause
// of the repeated Metro-stub firefighting. Push setup (incl. the Android
// channel) now lives entirely in the lazy, environment-gated
// usePushNotifications hook, which only touches the native module in
// standalone/bare builds. Expo Go never loads it, so no stub is needed.

function AppStatusBar() {
  const { isDark } = useTheme()
  return <StatusBar style={isDark ? "light" : "dark"} />
}

export default function App() {
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
