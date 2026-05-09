import Constants, { ExecutionEnvironment } from "expo-constants"
import * as React from "react"

import { registerPushToken } from "../api/users"
import { navigate } from "../navigation/navigationRef"

// expo-notifications remote push APIs were removed from Expo Go in SDK 53.
// The module throws at load time in Expo Go — use dynamic import so it never
// loads. ExecutionEnvironment.StoreClient is the correct SDK 53+ Expo Go check.
const IS_EXPO_GO =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient

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
    if (IS_EXPO_GO) return

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
        /* push notifications unavailable in this environment — non-fatal */
      }
    }

    void setup()

    return () => {
      cancelled = true
      removeSub?.()
    }
  }, [])
}
