import { api, getMemoryAccessToken } from "./client"

export async function registerPushToken(pushToken: string): Promise<void> {
  const token = getMemoryAccessToken()
  await api.put(
    "/users/me/push-token",
    { push_token: pushToken },
    {
      ...(token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : {}),
    },
  )
}
