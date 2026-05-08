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
  gradientColors: ["#FAFBFD", "#EFF6FF", "#FFF8F4"] as const,
  gradientLocations: [0, 0.42, 1] as const,

  /** Login / hero — slightly richer contrast */
  gradientLoginColors: ["#F4F7FB", "#E8F4FC", "#FFF4E8"] as const,

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
