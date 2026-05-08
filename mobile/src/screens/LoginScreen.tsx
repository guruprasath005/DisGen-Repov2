import { Ionicons } from "@expo/vector-icons"
import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"
import axios from "axios"
import * as React from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { AppBackground } from "../components/AppBackground"
import { GlassCard } from "../components/GlassCard"
import { useAuth } from "../contexts/AuthContext"
import { useTheme } from "../contexts/ThemeContext"
import type { ThemeTokens } from "../theme"

const BIOMETRIC_ENABLED_KEY = "biometric_enabled"
const SAVED_USERNAME_KEY = "saved_username"
const SAVED_PASSWORD_KEY = "saved_password"

function extractLoginError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data as { detail?: unknown } | undefined
    const d = detail?.detail
    if (typeof d === "string") return d
    if (Array.isArray(d))
      return d.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ")
    if (error.response?.status === 429)
      return "Too many attempts. Please wait and try again."
  }
  return "Unable to sign in. Check your credentials and try again."
}

function createLoginStyles(theme: ThemeTokens) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "transparent",
    },
    flex: {
      flex: 1,
    },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 22,
      paddingBottom: 36,
      justifyContent: "center",
      paddingTop: 16,
    },
    hero: {
      alignItems: "center",
      marginBottom: 28,
    },
    logoMark: {
      width: 62,
      height: 62,
      borderRadius: 20,
      backgroundColor: theme.orange,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
      shadowColor: theme.orangeDark,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.35,
      shadowRadius: 22,
      elevation: 10,
    },
    brand: {
      fontSize: 30,
      fontWeight: "700",
      color: theme.navy,
      letterSpacing: -0.6,
    },
    tagline: {
      marginTop: 8,
      fontSize: 14,
      color: theme.muted,
      fontWeight: "500",
      letterSpacing: 0.15,
    },
    cardInner: {
      paddingHorizontal: 24,
      paddingVertical: 26,
    },
    cardTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: theme.navy,
      letterSpacing: -0.3,
    },
    cardSubtitle: {
      marginTop: 8,
      fontSize: 14,
      lineHeight: 20,
      color: theme.muted,
      marginBottom: 22,
    },
    banner: {
      backgroundColor: theme.errorBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(190,18,60,0.25)",
      borderRadius: 14,
      padding: 12,
      marginBottom: 18,
    },
    bannerText: {
      color: theme.error,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
    },
    label: {
      fontSize: 11,
      fontWeight: "700",
      color: theme.slate,
      letterSpacing: 0.65,
      textTransform: "uppercase",
    },
    labelSpacing: {
      marginTop: 18,
    },
    input: {
      marginTop: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.glassStroke,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: Platform.OS === "ios" ? 16 : 14,
      fontSize: 16,
      color: theme.navy,
      backgroundColor: theme.glassFillMuted,
    },
    button: {
      marginTop: 28,
      backgroundColor: theme.orange,
      paddingVertical: 17,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 56,
      shadowColor: theme.orangeDark,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.32,
      shadowRadius: 18,
      elevation: 8,
    },
    bioButton: {
      marginTop: 14,
      paddingVertical: 17,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 56,
      borderWidth: 2,
      borderColor: theme.orange,
      backgroundColor: "transparent",
      flexDirection: "row",
      gap: 10,
    },
    bioButtonPressed: {
      opacity: 0.92,
    },
    bioButtonDisabled: {
      opacity: 0.55,
    },
    bioButtonText: {
      fontSize: 16,
      fontWeight: "700",
      color: theme.orange,
    },
    buttonPressed: {
      opacity: 0.94,
      transform: [{ scale: 0.997 }],
    },
    buttonDisabled: {
      opacity: 0.78,
    },
    buttonText: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "700",
      letterSpacing: 0.25,
    },
    footer: {
      marginTop: 26,
      textAlign: "center",
      fontSize: 12,
      color: theme.muted,
      lineHeight: 18,
      paddingHorizontal: 16,
    },
  })
}

export function LoginScreen() {
  const { theme } = useTheme()
  const styles = React.useMemo(() => createLoginStyles(theme), [theme])
  const { login } = useAuth()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [bioBusy, setBioBusy] = React.useState(false)
  const [showBioButton, setShowBioButton] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function checkBioOffer() {
      try {
        const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY)
        const u = await SecureStore.getItemAsync(SAVED_USERNAME_KEY)
        const p = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY)
        const hw = await LocalAuthentication.hasHardwareAsync()
        const enrolled = await LocalAuthentication.isEnrolledAsync()
        if (!cancelled) {
          setShowBioButton(
            enabled === "true" &&
              Boolean(u) &&
              Boolean(p) &&
              hw &&
              enrolled,
          )
        }
      } catch {
        if (!cancelled) setShowBioButton(false)
      }
    }
    void checkBioOffer()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit() {
    const u = username.trim()
    if (!u || !password) {
      setError("Enter username and password.")
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await login(u, password)
    } catch (e) {
      const msg = extractLoginError(e)
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBiometricLogin() {
    setError(null)
    setBioBusy(true)
    try {
      const u = await SecureStore.getItemAsync(SAVED_USERNAME_KEY)
      const p = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY)
      if (!u || !p) {
        setError("Saved credentials are missing.")
        return
      }
      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: "Sign in to DisGen",
        fallbackLabel: "Use password",
        cancelLabel: "Cancel",
      })
      if (!authResult.success) return
      await login(u, p)
    } catch (e) {
      setError(extractLoginError(e))
    } finally {
      setBioBusy(false)
    }
  }

  return (
    <AppBackground variant="login">
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.logoMark}>
                <Ionicons name="shield-checkmark" size={30} color="#FFFFFF" />
              </View>
              <Text style={styles.brand}>DisGen</Text>
              <Text style={styles.tagline}>Discharge intelligence</Text>
            </View>

            <GlassCard intensity={52} contentStyle={styles.cardInner}>
              <Text style={styles.cardTitle}>Hospital sign in</Text>
              <Text style={styles.cardSubtitle}>
                PHI-grade session — credentials stay encrypted on device after
                login.
              </Text>

              {error ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>{error}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                editable={!submitting && !bioBusy}
                value={username}
                onChangeText={setUsername}
              />

              <Text style={[styles.label, styles.labelSpacing]}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={theme.muted}
                secureTextEntry
                autoComplete="password"
                editable={!submitting && !bioBusy}
                value={password}
                onChangeText={setPassword}
              />

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                  (submitting || bioBusy) && styles.buttonDisabled,
                ]}
                disabled={submitting || bioBusy}
                onPress={() => void handleSubmit()}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Sign in securely</Text>
                )}
              </Pressable>

              {showBioButton ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.bioButton,
                    pressed && styles.bioButtonPressed,
                    (submitting || bioBusy) && styles.bioButtonDisabled,
                  ]}
                  disabled={submitting || bioBusy}
                  onPress={() => void handleBiometricLogin()}
                >
                  {bioBusy ? (
                    <ActivityIndicator color={theme.orange} />
                  ) : (
                    <>
                      <Ionicons
                        name="finger-print"
                        size={22}
                        color={theme.orange}
                      />
                      <Text style={styles.bioButtonText}>
                        Sign in with Face ID / Touch ID
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </GlassCard>

            <Text style={styles.footer}>
              Authorized clinical and administrative staff only.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppBackground>
  )
}
