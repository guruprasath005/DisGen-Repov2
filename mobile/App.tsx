import { StatusBar } from "expo-status-bar"

import { AuthProvider } from "./src/contexts/AuthContext"
import { RootNavigator } from "./src/navigation/RootNavigator"

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  )
}
