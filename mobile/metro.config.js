const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const config = getDefaultConfig(__dirname)

// In development (Expo Go), forcibly redirect expo-notifications to a no-op stub.
// extraNodeModules doesn't override installed packages — resolveRequest does.
// expo-notifications throws on Android Expo Go SDK 53+ during native module init.
if (process.env.NODE_ENV !== "production") {
  const STUB = path.resolve(__dirname, "src/stubs/expo-notifications-stub.js")

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "expo-notifications") {
      return { filePath: STUB, type: "sourceFile" }
    }
    return context.resolveRequest(context, moduleName, platform)
  }
}

module.exports = config
