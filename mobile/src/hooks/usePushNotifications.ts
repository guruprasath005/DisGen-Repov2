import Constants, { ExecutionEnvironment } from "expo-constants"
import * as React from "react"

import { registerPushToken } from "../api/users"
import { navigate } from "../navigation/navigationRef"

// Only enable push in standalone/bare builds where expo-notifications works.
// Expo Go SDK 53+ removed Android push support — the module throws on load.
// Opt-in (whitelist) is safer than opt-out: if executionEnvironment is
// anything other than a known good value, we skip push silently.
const PUSH_SUPPORTED =
  Constants.executionEnvironment === ExecutionEnvironment.Standalone ||
  Constants.executionEnvironment === ExecutionEnvironment.Bare

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
