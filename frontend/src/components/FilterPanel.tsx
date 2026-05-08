import * as React from "react"
import { Calendar, ChevronDown, Filter } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** Label styling for filter fields */
export const filterLabelClass =
  "block font-heading text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"

/** Wrapper per control — grows on wide layouts */
export const filterFieldClass = "min-w-[11rem] flex-1 space-y-2"

/** Shared chrome for native selects and date inputs */
export const filterControlClass = cn(
  "h-9 w-full min-w-0 rounded-lg border border-input/95 bg-background px-3 text-sm text-foreground",
  "shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.04)]",
  "outline-none transition-[border-color,box-shadow]",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/45",
  "disabled:cursor-not-allowed disabled:opacity-50",
)

export function FilterSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          filterControlClass,
          "cursor-pointer appearance-none pr-9",
          className,
        )}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-65"
        aria-hidden
      />
    </div>
  )
}

export function FilterDateInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <div className="relative">
      <input
        type="date"
        {...props}
        className={cn(
          filterControlClass,
          "pr-10 [color-scheme:light]",
          className,
        )}
      />
      <Calendar
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
        aria-hidden
      />
    </div>
  )
}

export type FilterPanelProps = {
  title?: string
  description?: string
  /** Number of dimensions currently narrowing the result set */
  activeFilterCount?: number
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function FilterPanel({
  title = "Filters",
  description,
  activeFilterCount = 0,
  actions,
  children,
  className,
}: FilterPanelProps) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex flex-col gap-4 border-border/45 border-b bg-muted/25 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/14 to-primary/8 text-primary shadow-[var(--shadow-xs)] ring-1 ring-primary/18"
              aria-hidden
            >
              <Filter className="size-[18px]" strokeWidth={2} />
            </div>
            <CardTitle className="font-heading text-base leading-none tracking-tight">
              {title}
            </CardTitle>
            {activeFilterCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-primary/12 px-2.5 py-1 font-semibold text-primary text-[11px] tabular-nums ring-1 ring-primary/22">
                {activeFilterCount} active
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-border/90 bg-background px-2.5 py-1 font-medium text-muted-foreground text-[11px] shadow-[var(--shadow-xs)]">
                Showing all
              </span>
            )}
          </div>
          {description ? (
            <CardDescription className="max-w-2xl text-[13px] leading-snug">
              {description}
            </CardDescription>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1 sm:pt-0">
            {actions}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="px-5 py-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">{children}</div>
      </CardContent>
    </Card>
  )
}
