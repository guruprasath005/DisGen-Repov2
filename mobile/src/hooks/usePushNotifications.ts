import * as Notifications from "expo-notifications"
import * as React from "react"

import { registerPushToken } from "../api/users"
import { navigate } from "../navigation/navigationRef"

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

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
        /* swallow */
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
