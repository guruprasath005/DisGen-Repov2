import Constants from "expo-constants"
import * as React from "react"
import { Platform } from "react-native"

import { registerPushToken } from "../api/users"
import { navigate } from "../navigation/navigationRef"

// Only enable push in standalone/bare builds (string comparison — no enum import
// to avoid potential Android module resolution issues).
const _env = Constants.executionEnvironment
const PUSH_SUPPORTED = _env === "standalone" || _env === "bare"

function openNotificationDocument(data: Record<string, unknown> | undefined) {
  const documentId =
    data && typeof data.documentId === "string"
      ? data.documentId.trim()
      : undefined
  if (!documentId) return
  navigate("Main", {
    screen: "DocumentDetail",
    params: { documentId },
  })
}

export function usePushNotifications(): void {
  React.useEffect(() => {
    if (!PUSH_SUPPORTED) return

    let cancelled = false
    let removeSub: (() => void) | undefined

    async function setup() {
      try {
        const Notifications = await import("expo-notifications")

        // Android notification channel — created here (lazily, only in
        // standalone/bare where PUSH_SUPPORTED is true) instead of eagerly
        // in App.tsx, so Expo Go never evaluates the native module.
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
          })
        }

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        })

        const { status } = await Notifications.requestPermissionsAsync()
        if (cancelled || status !== "granted") return

        const tokenData = await Notifications.getExpoPushTokenAsync()
        void registerPushToken(tokenData.data).catch(() => {})

        const lastResponse =
          await Notifications.getLastNotificationResponseAsync()
        if (lastResponse?.notification?.request?.content?.data) {
          openNotificationDocument(
            lastResponse.notification.request.content.data as Record<
              string,
              unknown
            >,
          )
        }

        const sub = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            openNotificationDocument(
              response.notification.request.content.data as Record<
                string,
                unknown
              >,
            )
          },
        )
        removeSub = () => sub.remove()
      } catch {
        /* push notifications unavailable — non-fatal */
      }
    }

    void setup()

    return () => {
      cancelled = true
      removeSub?.()
    }
  }, [])
}
