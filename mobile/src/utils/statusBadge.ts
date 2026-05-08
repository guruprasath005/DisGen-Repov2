import { theme } from "../theme"

export interface StatusBadgeStyle {
  backgroundColor: string
  borderColor: string
  color: string
}

/** Colour-coded discharge pipeline states */
export function statusBadgeStyle(status: string): StatusBadgeStyle {
  const s = status.toLowerCase()
  if (
    ["processing", "extracting", "ocr_complete", "generating"].includes(s)
  ) {
    return {
      backgroundColor: "rgba(245, 158, 11, 0.14)",
      borderColor: "#F59E0B",
      color: "#B45309",
    }
  }
  if (["ready", "confirmed"].includes(s)) {
    return {
      backgroundColor: "rgba(59, 130, 246, 0.12)",
      borderColor: "#3B82F6",
      color: "#1D4ED8",
    }
  }
  if (["completed", "generated", "approved"].includes(s)) {
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
  return {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    color: theme.slate,
  }
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
