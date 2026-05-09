const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const config = getDefaultConfig(__dirname)

// In development (Expo Go), redirect expo-notifications to a no-op stub.
// expo-notifications throws on Android Expo Go SDK 53+ during native module init.
// Production builds (EAS / expo run:android) use the real module via node_modules.
if (process.env.NODE_ENV !== "production") {
  config.resolver.extraNodeModules = {
    ...config.resolver.extraNodeModules,
    "expo-notifications": path.resolve(
      __dirname,
      "src/stubs/expo-notifications-stub.js",
    ),
  }
}

module.exports = config
