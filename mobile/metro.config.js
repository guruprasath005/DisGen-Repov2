// Default Expo Metro config.
//
// We previously redirected expo-notifications to a no-op stub here because
// App.tsx statically imported it and crashed Expo Go SDK 53+. That root cause
// is gone: push setup is now fully lazy and environment-gated in
// usePushNotifications (it only `await import("expo-notifications")` in
// standalone/bare builds). Expo Go never evaluates the native module, so no
// resolver hack or stub is required.
const { getDefaultConfig } = require("expo/metro-config")

module.exports = getDefaultConfig(__dirname)
