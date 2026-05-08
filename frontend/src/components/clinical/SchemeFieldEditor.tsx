import { useState } from "react"

import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  updateSummaryFields,
  type SummaryLatestResponse,
} from "@/api/documents"
import type { SchemeFieldItem } from "@/api/schemes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface FieldRowProps {
  item: SchemeFieldItem
  required: boolean
  value: string
  isLocked: boolean
  isSaving: boolean
  onChange: (field: string, value: string) => void
}

const FIELD_TYPE_CONFIG: Record<string, { rows: number; placeholder: (hint?: string | null) => string }> = {
  string: {
    rows: 2,
    placeholder: (hint) => hint || "",
  },
  narrative: {
    rows: 5,
    placeholder: (hint) => hint || "Write as continuous clinical prose…",
  },
  list: {
    rows: 3,
    placeholder: (hint) => hint || "One item per line (no bullets needed)",
  },
  medications: {
    rows: 4,
    placeholder: (hint) =>
      hint || "Drug Name: Dose/Route - Frequency - Duration\n(one medication per line)",
  },
}

function parseListLines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
}

function FieldRow({
  item,
  required,
  value,
  isLocked,
  isSaving,
  onChange,
}: FieldRowProps) {
  const isEmpty = required && !value.trim()
  const ftype = item.type || "string"
  const typeConfig = FIELD_TYPE_CONFIG[ftype] ?? FIELD_TYPE_CONFIG.string
  const isNarrative = ftype === "narrative"
  const isList = ftype === "list"
  const isMedications = ftype === "medications"

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 shadow-sm",
        isEmpty
          ? "border-red-300/70 bg-red-50/40"
          : isNarrative
            ? "border-blue-200/60 bg-blue-50/20 backdrop-blur-sm"
            : "border-border/40 bg-white/40 backdrop-blur-sm",
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium uppercase tracking-wide",
          required
            ? isEmpty
              ? "text-destructive"
              : "text-foreground/80"
            : "text-muted-foreground",
        )}
      >
        {item.label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {ftype !== "string" && (
          <span className="ml-1.5 rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-normal capitalize text-muted-foreground normal-case tracking-normal">
            {ftype}
          </span>
        )}
      </p>
      {isLocked ? (
        <>
          {isList || isMedications ? (
            <ul className="mt-1 space-y-0.5 pl-4 text-sm text-foreground">
              {parseListLines(value).length > 0 ? (
                parseListLines(value).map((line, i) => (
                  <li key={i} className="list-disc leading-snug">
                    {line}
                  </li>
                ))
              ) : (
                <li className="list-none text-muted-foreground">—</li>
              )}
            </ul>
          ) : isNarrative ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {value || "—"}
            </p>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-snug text-foreground">
              {value || "—"}
            </p>
          )}
        </>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(item.field, e.target.value)}
          rows={typeConfig.rows}
          className={cn(
            "mt-1 w-full resize-y rounded border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-0",
            isNarrative ? "leading-relaxed" : "leading-snug",
          )}
          placeholder={typeConfig.placeholder(item.hint)}
          disabled={isSaving}
        />
      )}
    </div>
  )
}

interface Props {
  documentId: string
  scheme: string
  summaryFields: Record<string, string | null>
  requiredFields: SchemeFieldItem[]
  optionalFields: SchemeFieldItem[]
  isLocked: boolean
  onSaved: (updated: SummaryLatestResponse) => void
}

function initLocal(
  summaryFields: Record<string, string | null>,
  required: SchemeFieldItem[],
  optional: SchemeFieldItem[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of [...required, ...optional]) {
    out[f.field] = summaryFields[f.field] ?? ""
  }
  return out
}

export function SchemeFieldEditor({
  documentId,
  scheme,
  summaryFields,
  requiredFields,
  optionalFields,
  isLocked,
  onSaved,
}: Props) {
  const [local, setLocal] = useState<Record<string, string>>(() =>
    initLocal(summaryFields, requiredFields, optionalFields),
  )

  const original = initLocal(summaryFields, requiredFields, optionalFields)
  const isDirty = Object.entries(local).some(([k, v]) => v !== (original[k] ?? ""))

  const saveMutation = useMutation({
    mutationFn: () => {
      const patch: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(local)) {
        patch[k] = v.trim() === "" ? null : v.trim()
      }
      return updateSummaryFields(documentId, patch, scheme)
    },
    onSuccess: (updated) => {
      const synced = initLocal(
        updated.summary_fields ?? {},
        requiredFields,
        optionalFields,
      )
      setLocal(synced)
      toast.success("Fields saved.")
      onSaved(updated)
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Save failed")
    },
  })

  function handleChange(field: string, value: string) {
    setLocal((prev) => ({ ...prev, [field]: value }))
  }

  if (requiredFields.length === 0 && optionalFields.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No scheme fields defined for this scheme.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {requiredFields.map((f) => (
        <FieldRow
          key={f.field}
          item={f}
          required
          value={local[f.field] ?? ""}
          isLocked={isLocked}
          isSaving={saveMutation.isPending}
          onChange={handleChange}
        />
      ))}
      {optionalFields.map((f) => (
        <FieldRow
          key={f.field}
          item={f}
          required={false}
          value={local[f.field] ?? ""}
          isLocked={isLocked}
          isSaving={saveMutation.isPending}
          onChange={handleChange}
        />
      ))}
      {!isLocked && (
        <div className="flex justify-end pt-1">
          <Button
            type="button"
            size="sm"
            disabled={!isDirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
