// No-op stub for expo-notifications used in Expo Go (SDK 53+ removed Android push support).
// Metro resolves expo-notifications to this file in development so the native
// module never initializes and the app loads cleanly on all platforms.
// The real expo-notifications is used in production builds via eas.json overrides.
module.exports = {
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => null,
  requestPermissionsAsync: async () => ({ status: "denied" }),
  getExpoPushTokenAsync: async () => { throw new Error("Not available") },
  getLastNotificationResponseAsync: async () => null,
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
  addPushTokenListener: () => ({ remove: () => {} }),
  scheduleNotificationAsync: async () => "",
  cancelScheduledNotificationAsync: async () => {},
  dismissAllNotificationsAsync: async () => {},
  getBadgeCountAsync: async () => 0,
  setBadgeCountAsync: async () => false,
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1, NONE: 0 },
}
