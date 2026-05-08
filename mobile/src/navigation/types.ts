import type { NavigatorScreenParams } from "@react-navigation/native"

export type MainTabParamList = {
  Dashboard: undefined
  Documents: undefined
  Upload: undefined
  Admin: undefined
  Profile: undefined
}

export type MainStackParamList = {
  Tabs: undefined
  DocumentDetail: { documentId: string }
}

export type RootStackParamList = {
  Login: undefined
  Main: NavigatorScreenParams<MainStackParamList>
}
