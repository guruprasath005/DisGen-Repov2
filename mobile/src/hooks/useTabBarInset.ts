import { useSafeAreaInsets } from "react-native-safe-area-context"

/** Space reserved above the floating glass tab bar + safe area. */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets()
  const BAR_HEIGHT = 62
  const FLOAT_GAP = 14
  return BAR_HEIGHT + FLOAT_GAP + Math.max(insets.bottom, 12)
}
