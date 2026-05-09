// Intercept expo-notifications crash in Expo Go SDK 53+.
// The native push token module throws during initialization in Expo Go —
// this must be patched before any other module loads.
if (typeof ErrorUtils !== "undefined") {
  const _handler = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (
      typeof error?.message === "string" &&
      error.message.includes("expo-notifications")
    ) {
      return // swallow — push notifications not supported in Expo Go
    }
    _handler(error, isFatal)
  })
}

import { registerRootComponent } from "expo"
import App from "./App"

registerRootComponent(App)
