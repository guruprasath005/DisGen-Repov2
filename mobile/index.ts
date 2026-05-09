// Patch global error handler BEFORE any module loads.
// expo-notifications throws on Android in Expo Go SDK 53+ during native module
// init. ES module `import` statements get hoisted by Babel above this code,
// so we use require() below to preserve execution order.
if (typeof ErrorUtils !== "undefined") {
  const _handler = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (
      typeof error?.message === "string" &&
      error.message.includes("expo-notifications")
    ) {
      return // swallow — push notifications not supported in Expo Go on Android
    }
    _handler(error, isFatal)
  })
}

// Use require() (not import) so the above patch is set before these modules load
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerRootComponent } = require("expo")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const App = require("./App").default
registerRootComponent(App)
