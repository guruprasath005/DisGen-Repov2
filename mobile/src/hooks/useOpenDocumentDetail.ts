import { useNavigation } from "@react-navigation/native"
import type { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { useCallback } from "react"

import type { MainStackParamList } from "../navigation/types"

export function useOpenDocumentDetail() {
  const navigation = useNavigation()
  return useCallback(
    (documentId: string) => {
      const parent =
        navigation.getParent<NativeStackNavigationProp<MainStackParamList>>()
      parent?.navigate("DocumentDetail", { documentId })
    },
    [navigation],
  )
}
