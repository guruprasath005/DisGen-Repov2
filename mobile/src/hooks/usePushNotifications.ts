import Constants from "expo-constants"
import * as Notifications from "expo-notifications"
import * as React from "react"

import { registerPushToken } from "../api/users"
import { navigate } from "../navigation/navigationRef"

// Push notifications are not supported in Expo Go since SDK 53.
// Only register and listen when running as a standalone/dev-client build.
const IS_EXPO_GO = Constants.appOwnership === "expo"

if (!IS_EXPO_GO) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  })
}

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
    let responseSub: { remove: () => void } | undefined

    async function registerToken() {
      const { status } = await Notifications.requestPermissionsAsync()
      if (cancelled || status !== "granted") return

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync()
        const token = tokenData.data
        void registerPushToken(token).catch(() => {})
      } catch {
        /* push token unavailable — non-fatal */
      }
    }

    void registerToken()

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response?.notification?.request?.content?.data) return
      const data = response.notification.request.content.data as Record<
        string,
        unknown
      >
      openNotificationDocument(data)
    })

    responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined
        openNotificationDocument(data)
      },
    )

    return () => {
      cancelled = true
      responseSub?.remove()
    }
  }, [])
}
