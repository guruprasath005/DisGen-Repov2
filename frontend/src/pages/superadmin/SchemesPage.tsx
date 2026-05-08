import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { AlertDialog, Dialog } from "radix-ui"
import { Layers2, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  createCustomScheme,
  deleteCustomScheme,
  fetchSchemes,
  updateCustomScheme,
  type CustomSchemePayload,
  type SchemeFieldItem,
  type SchemeResponse,
} from "@/api/schemes"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function extractErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data
    if (d && typeof d === "object" && "detail" in d) {
      const detail = (d as { detail?: unknown }).detail
      if (typeof detail === "string") return detail
      if (Array.isArray(detail)) return JSON.stringify(detail)
    }
    return e.message || "Request failed"
  }
  return e instanceof Error ? e.message : "Something went wrong"
}

type FieldRow = { field: string; label: string; type: string; section: string; hint: string }

const FIELD_TYPES = ["string", "narrative", "list", "medications"] as const

function emptyRow(): FieldRow {
  return { field: "", label: "", type: "string", section: "", hint: "" }
}

function coerceFields(raw: unknown[]): FieldRow[] {
  const mapped = raw.map((item) => {
    if (item && typeof item === "object" && "field" in item) {
      const o = item as Record<string, unknown>
      return {
        field: String(o.field ?? ""),
        label: String(o.label ?? ""),
        type: String(o.type ?? "string"),
        section: String(o.section ?? ""),
        hint: String(o.hint ?? ""),
      }
    }
    return emptyRow()
  })
  return mapped.length ? mapped : [emptyRow()]
}

function toPayloadField(row: FieldRow): SchemeFieldItem {
  return {
    field: row.field.trim(),
    label: row.label.trim(),
    type: row.type || "string",
    ...(row.section.trim() ? { section: row.section.trim() } : {}),
    ...(row.hint.trim() ? { hint: row.hint.trim() } : {}),
  }
}

const NAME_SLUG_RE = /^[a-zA-Z0-9_]+$/

export default function SchemesPage() {
  const qc = useQueryClient()
  const schemesQuery = useQuery({
    queryKey: ["schemes"],
    queryFn: fetchSchemes,
  })

  const [editorOpen, setEditorOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<SchemeResponse | null>(
    null,
  )

  const schemes = schemesQuery.data ?? []
  const builtins = schemes.filter((s) => s.is_builtin)
  const customs = schemes.filter((s) => !s.is_builtin)

  function openCreate() {
    setEditingId(null)
    setEditorOpen(true)
  }

  function openEdit(s: SchemeResponse) {
    setEditingId(s.id)
    setEditorOpen(true)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomScheme(id),
    onSuccess: async () => {
      toast.success("Custom scheme deleted.")
      await qc.invalidateQueries({ queryKey: ["schemes"] })
      setDeleteTarget(null)
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const loading = schemesQuery.isLoading

  return (
    <div className="space-y-10 pb-12">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <Layers2 className="size-5" aria-hidden />
            </div>
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              Discharge schemes
            </h1>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Canonical templates ship read-only; custom schemes layer extraction rules,
            PDF sections, and optional retrieval chunks—aligned with hospital
            discharge programmes and governance review.
          </p>
        </div>
        <Button
          type="button"
          className="gap-2 shadow-md shadow-orange-950/15 lg:shrink-0"
          onClick={openCreate}
        >
          <Plus className="size-4" aria-hidden />
          Custom scheme
        </Button>
      </div>

      {!loading ? (
        <div className="flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/35 px-3 py-1.5 font-medium text-foreground text-xs shadow-[var(--shadow-xs)]">
            <span className="text-muted-foreground">Built-in</span>
            <span className="tabular-nums">{builtins.length}</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 font-medium text-foreground text-xs shadow-[var(--shadow-xs)]">
            <span className="text-muted-foreground">Custom</span>
            <span className="tabular-nums">{customs.length}</span>
          </span>
        </div>
      ) : null}

      <EditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editingId={editingId}
        scheme={editingId ? schemes.find((s) => s.id === editingId) : undefined}
        qc={qc}
      />

      <section>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-muted/80 text-muted-foreground ring-1 ring-border/70">
            <Lock className="size-3.5" aria-hidden />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-base text-foreground tracking-tight">
              Built-in catalogue
            </h2>
            <p className="text-muted-foreground text-xs">
              Maintained by the platform — baseline extraction and PDF layouts.
            </p>
          </div>
        </div>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {builtins.map((s) => (
              <Card
                key={s.id}
                className="border-border/80 shadow-[var(--shadow-card)] transition-shadow hover:shadow-md"
              >
                <CardHeader className="border-border/40 border-b pb-4">
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-1 size-3 shrink-0 rounded-full shadow-inner ring-2 ring-background"
                      style={{ backgroundColor: s.color }}
                    />
                    <div className="min-w-0">
                      <CardTitle className="font-heading text-[15px] leading-snug">
                        {s.label}
                      </CardTitle>
                      <CardDescription className="mt-1 font-mono text-[11px]">
                        {s.name}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-4 pb-5">
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-muted/35 px-3 py-2 ring-1 ring-border/50">
                      <dt className="text-muted-foreground">Rules</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {s.rules.length}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-muted/35 px-3 py-2 ring-1 ring-border/50">
                      <dt className="text-muted-foreground">Required fields</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {s.required_fields.length}
                      </dd>
                    </div>
                  </dl>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1 shadow-[var(--shadow-xs)]"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-5">
          <h2 className="font-heading font-semibold text-base text-foreground tracking-tight">
            Hospital extensions
          </h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Editable schemes participate in extraction, summarisation, and PDF
            composition — publish only after clinical informatics sign-off.
          </p>
        </div>
        {loading ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : customs.length === 0 ? (
          <Card className="border-dashed border-border/80 bg-muted/[0.35] shadow-[var(--shadow-card)]">
            <CardContent className="py-14 text-center">
              <p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
                No custom schemes yet. Define one when a specialty pathway needs
                distinct structured fields or narrative rules beyond the built-in
                catalogue.
              </p>
              <Button
                type="button"
                className="mt-6 gap-2 shadow-md shadow-orange-950/15"
                onClick={openCreate}
              >
                <Plus className="size-4" aria-hidden />
                Create first scheme
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {customs.map((s) => (
              <Card
                key={s.id}
                className="overflow-hidden border-border/80 shadow-[var(--shadow-card)] transition-shadow hover:shadow-md"
              >
                <CardContent className="flex flex-wrap items-center gap-4 p-0 sm:flex-nowrap">
                  <div
                    className="min-h-[4px] w-full shrink-0 sm:min-h-0 sm:w-1 sm:self-stretch"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="mt-1 size-3 shrink-0 rounded-full shadow-inner ring-2 ring-background"
                        style={{ backgroundColor: s.color }}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">
                          {s.label}
                        </p>
                        <p className="font-mono text-muted-foreground text-xs">
                          {s.name}
                        </p>
                        <p className="mt-2 text-muted-foreground text-xs">
                          {s.rules.length} rules · {s.required_fields.length}{" "}
                          required fields
                        </p>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1 shadow-[var(--shadow-xs)] sm:flex-none"
                        onClick={() => openEdit(s)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="flex-1 gap-1 sm:flex-none"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <AlertDialog.Root
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/60 bg-white/98 p-6 shadow-xl outline-none">
            <AlertDialog.Title className="font-semibold text-foreground text-lg">
              Delete custom scheme?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-muted-foreground text-sm">
              This removes{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.label}
              </span>{" "}
              ({deleteTarget?.name}) and its RAG index. Summaries that reference it
              may fail until documents are reassigned.
            </AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline" className="bg-white/70">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
                  }}
                >
                  Delete permanently
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}

function EditorModal({
  open,
  onOpenChange,
  editingId,
  scheme,
  qc,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editingId: string | null
  scheme?: SchemeResponse
  qc: ReturnType<typeof useQueryClient>
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border/80 bg-card shadow-[var(--shadow-card)] outline-none">
          <div className="shrink-0 border-border/55 border-b bg-muted/25 px-6 py-5">
            <Dialog.Title className="font-heading font-semibold text-foreground text-lg tracking-tight">
              {editingId
                ? scheme?.is_builtin
                  ? "Edit built-in scheme"
                  : "Edit custom scheme"
                : "Create custom scheme"}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-muted-foreground text-sm leading-relaxed">
              Define extraction fields, narrative rules, and PDF section headings.
              Each non-empty line under Rules becomes one discrete instruction string.
            </Dialog.Description>
          </div>
          {open ? (
            <SchemeEditorBody
              key={editingId ?? "create"}
              editingId={editingId}
              isBuiltin={scheme?.is_builtin ?? false}
              scheme={scheme}
              qc={qc}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SchemeEditorBody({
  editingId,
  isBuiltin,
  scheme,
  qc,
  onClose,
}: {
  editingId: string | null
  isBuiltin: boolean
  scheme?: SchemeResponse
  qc: ReturnType<typeof useQueryClient>
  onClose: () => void
}) {
  const createMutation = useMutation({
    mutationFn: (body: CustomSchemePayload) => createCustomScheme(body),
    onSuccess: async () => {
      toast.success("Custom scheme created.")
      await qc.invalidateQueries({ queryKey: ["schemes"] })
      onClose()
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: CustomSchemePayload
    }) => updateCustomScheme(id, body),
    onSuccess: async () => {
      toast.success("Custom scheme updated.")
      await qc.invalidateQueries({ queryKey: ["schemes"] })
      onClose()
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const [name, setName] = React.useState(() =>
    editingId && scheme ? scheme.name : "",
  )
  const [label, setLabel] = React.useState(() =>
    editingId && scheme ? scheme.label : "",
  )
  const [color, setColor] = React.useState(() =>
    editingId && scheme ? scheme.color : "#F97316",
  )
  const [rulesText, setRulesText] = React.useState(() =>
    editingId && scheme ? scheme.rules.join("\n") : "",
  )
  const [pdfSectionsText, setPdfSectionsText] = React.useState(() =>
    editingId && scheme ? scheme.pdf_sections.join("\n") : "",
  )
  const [ragText, setRagText] = React.useState("")
  const [requiredRows, setRequiredRows] = React.useState<FieldRow[]>(() =>
    editingId && scheme ? coerceFields(scheme.required_fields) : [emptyRow()],
  )
  const [optionalRows, setOptionalRows] = React.useState<FieldRow[]>(() =>
    editingId && scheme ? coerceFields(scheme.optional_fields) : [emptyRow()],
  )

  function splitLines(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const slug = name.trim()
    const lab = label.trim()
    if (!NAME_SLUG_RE.test(slug)) {
      toast.error(
        "Name must be a slug: letters, digits, and underscores only.",
      )
      return
    }
    if (!lab) {
      toast.error("Label is required.")
      return
    }
    const hex = color.trim().toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(hex)) {
      toast.error("Color must be a 6-digit hex value (e.g. #F97316).")
      return
    }
    const reqFields = requiredRows
      .filter((r) => r.field.trim() && r.label.trim())
      .map(toPayloadField)
    const optFields = optionalRows
      .filter((r) => r.field.trim() && r.label.trim())
      .map(toPayloadField)
    const rules = splitLines(rulesText)
    const pdf_sections = splitLines(pdfSectionsText)
    const rag_chunks = splitLines(ragText)

    const body: CustomSchemePayload = {
      name: slug,
      label: lab,
      color: hex,
      required_fields: reqFields,
      optional_fields: optFields,
      rules,
      pdf_sections,
      ...(rag_chunks.length ? { rag_chunks } : {}),
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, body })
    } else {
      createMutation.mutate(body)
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending

  function addRequiredRow() {
    setRequiredRows((r) => [...r, emptyRow()])
  }

  function addOptionalRow() {
    setOptionalRows((r) => [...r, emptyRow()])
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      onSubmit={submit}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {isBuiltin && (
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800">
            Built-in scheme — name is locked. You can edit fields, rules, and color.
            Changes survive server restarts because they are persisted in the database.
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scheme-name">Name (slug)</Label>
            <Input
              id="scheme-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-white/70 font-mono text-xs"
              placeholder="my_scheme"
              disabled={Boolean(editingId)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheme-label">Label</Label>
            <Input
              id="scheme-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="bg-white/70"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scheme-color">Color</Label>
          <div className="flex gap-2">
            <Input
              id="scheme-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-14 cursor-pointer px-1 py-1"
            />
            <Input
              aria-label="Scheme color hex"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="min-w-0 flex-1 bg-white/70 font-mono text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scheme-rules">Rules (one per line)</Label>
          <textarea
            id="scheme-rules"
            rows={4}
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            className={cn(
              "w-full resize-y rounded-lg border border-input bg-white/70 px-2.5 py-2 font-mono text-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="scheme-pdf">PDF sections (one per line)</Label>
          <textarea
            id="scheme-pdf"
            rows={3}
            value={pdfSectionsText}
            onChange={(e) => setPdfSectionsText(e.target.value)}
            className={cn(
              "w-full resize-y rounded-lg border border-input bg-white/70 px-2.5 py-2 font-mono text-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="scheme-rag">
            RAG chunks (optional, one per line)
          </Label>
          <textarea
            id="scheme-rag"
            rows={2}
            value={ragText}
            onChange={(e) => setRagText(e.target.value)}
            placeholder="Indexed into vector search; defaults to rules if empty."
            className={cn(
              "w-full resize-y rounded-lg border border-input bg-white/70 px-2.5 py-2 font-mono text-xs outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          />
        </div>

        <FieldMatrix
          title="Required fields"
          rows={requiredRows}
          setRows={setRequiredRows}
          onAdd={addRequiredRow}
        />
        <FieldMatrix
          title="Optional fields"
          rows={optionalRows}
          setRows={setOptionalRows}
          onAdd={addOptionalRow}
        />
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-border/55 border-t bg-muted/20 px-6 py-4">
        <Dialog.Close asChild>
          <Button type="button" variant="outline" className="shadow-[var(--shadow-xs)]">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editingId ? "Save changes" : "Create"}
        </Button>
      </div>
    </form>
  )
}
function FieldMatrix({
  title,
  rows,
  setRows,
  onAdd,
}: {
  title: string
  rows: FieldRow[]
  setRows: React.Dispatch<React.SetStateAction<FieldRow[]>>
  onAdd: () => void
}) {
  function update(i: number, patch: Partial<FieldRow>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Button type="button" size="xs" variant="outline" onClick={onAdd}>
          Add row
        </Button>
      </div>
      <div className="space-y-3 rounded-xl border border-border/50 bg-white/50 p-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-lg border border-border/30 bg-white/60 p-3 space-y-3">
            {/* Header: field number + remove button */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Field {i + 1}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                disabled={rows.length <= 1}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove field"
              >
                ×
              </Button>
            </div>

            {/* Row 1: slug + label + type — 3 columns on wider screens */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Slug</p>
                <Input
                  aria-label={`${title} field slug ${i + 1}`}
                  placeholder="field_slug"
                  value={row.field}
                  onChange={(e) => update(i, { field: e.target.value })}
                  className="bg-white/70 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Display label</p>
                <Input
                  aria-label={`${title} label ${i + 1}`}
                  placeholder="e.g. Discharge Medications"
                  value={row.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  className="bg-white/70 text-sm"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Type</p>
                <select
                  aria-label={`${title} type ${i + 1}`}
                  value={row.type}
                  onChange={(e) => update(i, { type: e.target.value })}
                  className={cn(
                    "h-9 w-full rounded-md border border-input bg-white/70 px-2 text-sm outline-none",
                    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                  )}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: section + hint */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Section heading <span className="normal-case font-normal">(optional)</span>
                </p>
                <Input
                  aria-label={`${title} section ${i + 1}`}
                  placeholder="e.g. Medications, Identifiers"
                  value={row.section}
                  onChange={(e) => update(i, { section: e.target.value })}
                  className="bg-white/70 text-xs"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  LLM hint <span className="normal-case font-normal">(optional)</span>
                </p>
                <textarea
                  aria-label={`${title} hint ${i + 1}`}
                  placeholder="Extraction instruction for the AI…"
                  value={row.hint}
                  rows={2}
                  onChange={(e) => update(i, { hint: e.target.value })}
                  className={cn(
                    "w-full resize-y rounded-md border border-input bg-white/70 px-2.5 py-2 text-xs outline-none leading-snug",
                    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                  )}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
