import type { ThemeTokens } from "../theme"

export interface StatusBadgeStyle {
  backgroundColor: string
  borderColor: string
  color: string
}

/** Top-edge accent on document cards — mirrors web pipeline colours */
export function statusAccentColor(status: string): string {
  const s = status.toLowerCase()
  if (s === "approved") return "#059669"
  if (s === "failed" || s === "ocr_failed") return "#E11D48"
  if (s === "generated" || s === "generating") return "#7C3AED"
  if (s === "ready" || s === "confirmed") return "#0284C7"
  if (s === "pending" || s === "processing") return "#64748B"
  if (s === "ocr_complete" || s === "extracting") return "#D97706"
  return "#F97316"
}

/** Colour-coded discharge pipeline states (aligned with web dashboard badges). */
export function statusBadgeStyle(status: string, t: ThemeTokens): StatusBadgeStyle {
  const s = status.toLowerCase()
  if (["processing", "extracting", "ocr_complete"].includes(s)) {
    return {
      backgroundColor: "rgba(245, 158, 11, 0.14)",
      borderColor: "#F59E0B",
      color: "#B45309",
    }
  }
  if (["generating", "generated"].includes(s)) {
    return {
      backgroundColor: "rgba(139, 92, 246, 0.14)",
      borderColor: "#8B5CF6",
      color: "#6D28D9",
    }
  }
  if (["ready", "confirmed"].includes(s)) {
    return {
      backgroundColor: "rgba(59, 130, 246, 0.12)",
      borderColor: "#3B82F6",
      color: "#1D4ED8",
    }
  }
  if (["completed", "approved"].includes(s)) {
    return {
      backgroundColor: "rgba(34, 197, 94, 0.12)",
      borderColor: "#22C55E",
      color: "#15803D",
    }
  }
  if (["failed", "ocr_failed", "validation_failed"].includes(s)) {
    return {
      backgroundColor: "rgba(239, 68, 68, 0.12)",
      borderColor: "#EF4444",
      color: "#B91C1C",
    }
  }
  if (s === "pending") {
    return {
      backgroundColor: "rgba(100, 116, 139, 0.12)",
      borderColor: "#94A3B8",
      color: "#475569",
    }
  }
  return {
    backgroundColor: t.bg,
    borderColor: t.border,
    color: t.slate,
  }
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
