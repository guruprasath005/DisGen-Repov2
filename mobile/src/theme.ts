export const theme = {
  orange: "#F97316",
  orangeDark: "#EA580C",
  orangeLight: "#FED7AA",
  navy: "#0F172A",
  slate: "#334155",
  muted: "#64748B",
  border: "#E2E8F0",
  bg: "#F8FAFC",
  white: "#FFFFFF",
  error: "#BE123C",
  errorBg: "rgba(225,29,72,0.08)",

  /** Soft ambient mesh for main app surfaces */
  gradientColors: ["#FAFBFD", "#EFF6FF", "#FFF8F4"],
  gradientLocations: [0, 0.42, 1] as const,

  /** Login / hero — slightly richer contrast */
  gradientLoginColors: ["#F4F7FB", "#E8F4FC", "#FFF4E8"],

  /** Frosted panels without blur (lists perform better) */
  glassFill: "rgba(255,255,255,0.72)",
  glassFillMuted: "rgba(255,255,255,0.52)",
  glassFillStrong: "rgba(255,255,255,0.92)",

  glassStroke: "rgba(148,163,184,0.42)",
  glassStrokeBright: "rgba(255,255,255,0.95)",
  glassHighlight: "rgba(255,255,255,0.65)",

  shadowSoft: "rgba(15, 23, 42, 0.06)",
  shadowElevated: "rgba(15, 23, 42, 0.12)",
}

export type ThemeTokens = typeof theme

/** expo-linear-gradient expects a tuple, not a generic string[] */
export type GradientStops = readonly [string, string, string]

export function gradientTuple(colors: readonly string[]): GradientStops {
  return colors as GradientStops
}

export const darkTheme: ThemeTokens = {
  ...theme,
  bg: "#0F172A",
  navy: "#F1F5F9",
  slate: "#94A3B8",
  muted: "#64748B",
  white: "#1E293B",
  border: "#1E293B",
  glassFill: "rgba(30,41,59,0.72)",
  glassFillStrong: "rgba(30,41,59,0.92)",
  glassFillMuted: "rgba(30,41,59,0.48)",
  glassStroke: "rgba(148,163,184,0.18)",
  errorBg: "rgba(190,18,60,0.18)",
  gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  gradientLoginColors: ["#0F172A", "#1E293B", "#0F172A"],
}
