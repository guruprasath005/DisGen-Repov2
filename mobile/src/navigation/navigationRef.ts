import { createNavigationContainerRef } from "@react-navigation/native"

import type { RootStackParamList } from "./types"

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

export function navigate(
  name: keyof RootStackParamList,
  params?: RootStackParamList[keyof RootStackParamList],
): void {
  if (!navigationRef.isReady()) return
  if (params !== undefined) {
    navigationRef.navigate(name, params as never)
  } else {
    navigationRef.navigate(name as never)
  }
}
