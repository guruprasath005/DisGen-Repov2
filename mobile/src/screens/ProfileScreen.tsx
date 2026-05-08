import * as React from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { GlassCard } from "../components/GlassCard"
import { useTabBarInset } from "../hooks/useTabBarInset"
import { useAuth } from "../contexts/AuthContext"
import { theme } from "../theme"

function formatRole(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ProfileScreen() {
  const tabInset = useTabBarInset()
  const { user, logout } = useAuth()
  const [signingOut, setSigningOut] = React.useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await logout()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>Profile</Text>
        <Text style={styles.screenSubtitle}>
          Signed-in identity and hospital association.
        </Text>

        <GlassCard intensity={46} style={styles.identityCard}>
          <Text style={styles.label}>Full name</Text>
          <Text style={styles.value}>{user?.full_name ?? "—"}</Text>

          <Text style={[styles.label, styles.labelGap]}>Username</Text>
          <Text style={styles.value}>{user?.username ?? "—"}</Text>

          <Text style={[styles.label, styles.labelGap]}>Email</Text>
          <Text style={styles.value}>{user?.email ?? "—"}</Text>

          <Text style={[styles.label, styles.labelGap]}>Role</Text>
          <View style={styles.badgeWrap}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>
                {user?.role ? formatRole(user.role) : "—"}
              </Text>
            </View>
          </View>

          <Text style={[styles.label, styles.labelGap]}>Hospital ID</Text>
          <Text style={[styles.value, styles.mono]} selectable>
            {user?.hospital_id ?? "—"}
          </Text>
        </GlassCard>

        <Pressable
          style={[styles.signOutBtn, signingOut && styles.signOutBtnBusy]}
          disabled={signingOut}
          onPress={() => void handleSignOut()}
        >
          {signingOut ? (
            <ActivityIndicator color={theme.orangeDark} />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: theme.navy,
    letterSpacing: -0.6,
  },
  screenSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: theme.muted,
    marginBottom: 20,
    lineHeight: 21,
    maxWidth: 340,
  },
  identityCard: {
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.muted,
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  labelGap: {
    marginTop: 18,
  },
  value: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: "600",
    color: theme.navy,
    lineHeight: 22,
  },
  mono: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 15,
    fontWeight: "500",
    color: theme.slate,
  },
  badgeWrap: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(249,115,22,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.orangeLight,
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.orangeDark,
    letterSpacing: 0.2,
  },
  signOutBtn: {
    marginTop: 22,
    paddingVertical: 17,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
    borderWidth: 2,
    borderColor: theme.orange,
    backgroundColor: theme.glassFillStrong,
    shadowColor: theme.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  signOutBtnBusy: {
    opacity: 0.85,
  },
  signOutText: {
    color: theme.orangeDark,
    fontSize: 16,
    fontWeight: "700",
  },
})
