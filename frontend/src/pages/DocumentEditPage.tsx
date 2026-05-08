import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Loader2, Plus, Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import {
  fetchStructuredData,
  patchStructuredData,
  type StructuredDataPatch,
  type StructuredDataResponse,
} from "@/api/documents"
import { DoctorGate } from "@/components/DoctorGate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type InvRow = { name: string; result: string; date: string }
type ProcRow = { name: string; date: string; surgeon: string }
type MedRow = { name: string; dose: string; frequency: string }

interface FormState {
  patient_name: string
  age: string
  gender: string
  uhid: string
  abha_id: string
  phone: string
  admission_date: string
  discharge_date: string
  ward: string
  bed_number: string
  primary_diagnosis: string
  secondary_diag_tags: string
  presenting_tags: string
  blood_pressure: string
  pulse_rate: string
  temperature: string
  oxygen_saturation: string
  weight: string
  height: string
  investigations: InvRow[]
  procedures: ProcRow[]
  medications_during_stay: MedRow[]
  discharge_medications: MedRow[]
  follow_up_instructions: string
  follow_up_date: string
  diet_advice: string
  allergies: string
  consultant: string
  surgeon: string
  anesthetist: string
}

function trim(s: string): string {
  return s.trim()
}

function splitTags(s: string): string[] {
  return s
    .split(/[,|\n]/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function coalesceStr(v: unknown): string {
  if (v == null || v === "") return ""
  return String(v)
}

function parseInitial(data: Record<string, unknown>): FormState {
  const sec = Array.isArray(data.secondary_diagnoses)
    ? (data.secondary_diagnoses as unknown[]).map(String).join(", ")
    : ""
  const pres = Array.isArray(data.presenting_complaints)
    ? (data.presenting_complaints as unknown[]).map(String).join(", ")
    : ""

  const investigationsRaw = Array.isArray(data.investigations)
    ? (data.investigations as Record<string, unknown>[])
    : []
  const investigations: InvRow[] =
    investigationsRaw.length > 0
      ? investigationsRaw.map((row) => ({
          name: coalesceStr(row.name),
          result: coalesceStr(row.value ?? row.result),
          date: coalesceStr(row.date),
        }))
      : [{ name: "", result: "", date: "" }]

  const procRaw = Array.isArray(data.procedures)
    ? (data.procedures as Record<string, unknown>[])
    : []
  const procedures: ProcRow[] =
    procRaw.length > 0
      ? procRaw.map((row) => ({
          name: coalesceStr(row.name),
          date: coalesceStr(row.date),
          surgeon: coalesceStr(row.surgeon ?? row.notes),
        }))
      : [{ name: "", date: "", surgeon: "" }]

  const mdStayRaw = Array.isArray(data.medications_during_stay)
    ? (data.medications_during_stay as Record<string, unknown>[])
    : []
  const medications_during_stay: MedRow[] =
    mdStayRaw.length > 0
      ? mdStayRaw.map((row) => ({
          name: coalesceStr(row.name),
          dose: coalesceStr(row.dose),
          frequency: coalesceStr(row.frequency),
        }))
      : [{ name: "", dose: "", frequency: "" }]

  const dmRaw = Array.isArray(data.discharge_medications)
    ? (data.discharge_medications as Record<string, unknown>[])
    : []
  const discharge_medications: MedRow[] =
    dmRaw.length > 0
      ? dmRaw.map((row) => ({
          name: coalesceStr(row.name),
          dose: coalesceStr(row.dose),
          frequency: coalesceStr(row.frequency),
        }))
      : [{ name: "", dose: "", frequency: "" }]

  return {
    patient_name: coalesceStr(data.patient_name),
    age: coalesceStr(data.age),
    gender: coalesceStr(data.gender),
    uhid: coalesceStr(data.uhid),
    abha_id: coalesceStr(data.abha_id),
    phone: coalesceStr(data.phone),
    admission_date: coalesceStr(data.admission_date),
    discharge_date: coalesceStr(data.discharge_date),
    ward: coalesceStr(data.ward),
    bed_number: coalesceStr(data.bed_number),
    primary_diagnosis: coalesceStr(data.primary_diagnosis),
    secondary_diag_tags: sec,
    presenting_tags: pres,
    blood_pressure: coalesceStr(data.blood_pressure),
    pulse_rate: coalesceStr(data.pulse_rate),
    temperature: coalesceStr(data.temperature),
    oxygen_saturation: coalesceStr(data.oxygen_saturation),
    weight: coalesceStr(data.weight),
    height: coalesceStr(data.height),
    investigations,
    procedures,
    medications_during_stay,
    discharge_medications,
    follow_up_instructions: coalesceStr(data.follow_up_instructions),
    follow_up_date: coalesceStr(data.follow_up_date),
    diet_advice: coalesceStr(data.diet_advice),
    allergies: coalesceStr(data.allergies),
    consultant: coalesceStr(data.consultant),
    surgeon: coalesceStr(data.surgeon),
    anesthetist: coalesceStr(data.anesthetist),
  }
}

function normalizeInv(rows: InvRow[]) {
  return rows
    .filter((r) => trim(r.name) || trim(r.result) || trim(r.date))
    .map((r) => ({
      name: trim(r.name) || null,
      value: trim(r.result) || null,
      date: trim(r.date) || null,
    }))
}

function normalizeProc(rows: ProcRow[]) {
  return rows
    .filter((r) => trim(r.name) || trim(r.date) || trim(r.surgeon))
    .map((r) => ({
      name: trim(r.name) || null,
      date: trim(r.date) || null,
      notes: trim(r.surgeon) || null,
    }))
}

function normalizeMed(rows: MedRow[]) {
  return rows
    .filter((r) => trim(r.name) || trim(r.dose) || trim(r.frequency))
    .map((r) => ({
      name: trim(r.name) || null,
      dose: trim(r.dose) || null,
      frequency: trim(r.frequency) || null,
    }))
}

function buildPatch(a: FormState, b: FormState): StructuredDataPatch {
  const patch: StructuredDataPatch = {}

  const scalarPairs: [keyof FormState, keyof StructuredDataPatch][] = [
    ["patient_name", "patient_name"],
    ["age", "age"],
    ["gender", "gender"],
    ["uhid", "uhid"],
    ["abha_id", "abha_id"],
    ["phone", "phone"],
    ["admission_date", "admission_date"],
    ["discharge_date", "discharge_date"],
    ["ward", "ward"],
    ["bed_number", "bed_number"],
    ["primary_diagnosis", "primary_diagnosis"],
    ["blood_pressure", "blood_pressure"],
    ["pulse_rate", "pulse_rate"],
    ["temperature", "temperature"],
    ["oxygen_saturation", "oxygen_saturation"],
    ["weight", "weight"],
    ["height", "height"],
    ["follow_up_instructions", "follow_up_instructions"],
    ["follow_up_date", "follow_up_date"],
    ["diet_advice", "diet_advice"],
    ["allergies", "allergies"],
    ["consultant", "consultant"],
    ["surgeon", "surgeon"],
    ["anesthetist", "anesthetist"],
  ]

  for (const [fk, pk] of scalarPairs) {
    const va = trim(String(a[fk]))
    const vb = trim(String(b[fk]))
    if (va !== vb) {
      ;(patch as Record<string, unknown>)[pk as string] = vb || null
    }
  }

  const secA = splitTags(a.secondary_diag_tags)
  const secB = splitTags(b.secondary_diag_tags)
  if (JSON.stringify(secA) !== JSON.stringify(secB)) {
    patch.secondary_diagnoses = secB.length ? secB : null
  }

  const presA = splitTags(a.presenting_tags)
  const presB = splitTags(b.presenting_tags)
  if (JSON.stringify(presA) !== JSON.stringify(presB)) {
    patch.presenting_complaints = presB.length ? presB : null
  }

  const invA = normalizeInv(a.investigations)
  const invB = normalizeInv(b.investigations)
  if (JSON.stringify(invA) !== JSON.stringify(invB)) {
    patch.investigations = invB.length ? invB : null
  }

  const prA = normalizeProc(a.procedures)
  const prB = normalizeProc(b.procedures)
  if (JSON.stringify(prA) !== JSON.stringify(prB)) {
    patch.procedures = prB.length ? prB : null
  }

  const msA = normalizeMed(a.medications_during_stay)
  const msB = normalizeMed(b.medications_during_stay)
  if (JSON.stringify(msA) !== JSON.stringify(msB)) {
    patch.medications_during_stay = msB.length ? msB : null
  }

  const dmA = normalizeMed(a.discharge_medications)
  const dmB = normalizeMed(b.discharge_medications)
  if (JSON.stringify(dmA) !== JSON.stringify(dmB)) {
    patch.discharge_medications = dmB.length ? dmB : null
  }

  return patch
}

function extractErr(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { detail?: unknown }
    if (typeof d?.detail === "string") return d.detail
    return e.message || "Request failed"
  }
  return e instanceof Error ? e.message : "Something went wrong"
}

const textareaClass =
  "min-h-[88px] w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"

export default function DocumentEditPage() {
  return (
    <DoctorGate>
      <DocumentEditInner />
    </DoctorGate>
  )
}

function DocumentEditInner() {
  const { id = "" } = useParams<{ id: string }>()

  const structuredQuery = useQuery({
    queryKey: ["document", id, "structured"],
    queryFn: () => fetchStructuredData(id),
    enabled: Boolean(id),
  })

  if (structuredQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 pb-16">
        <p className="text-muted-foreground text-sm">Loading structured data…</p>
      </div>
    )
  }

  if (structuredQuery.error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm">
        {extractErr(structuredQuery.error)}
      </div>
    )
  }

  const structured = structuredQuery.data
  if (!structured) return null

  return (
    <DocumentEditForm
      key={`${structured.document_id}-${structured.version}-${structured.updated_at}`}
      documentId={id}
      structured={structured}
    />
  )
}

function DocumentEditForm({
  documentId,
  structured,
}: {
  documentId: string
  structured: StructuredDataResponse
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const baseline = useMemo(
    () => parseInitial(structured.data as Record<string, unknown>),
    [structured.data],
  )

  const [form, setForm] = useState(() =>
    parseInitial(structured.data as Record<string, unknown>),
  )

  const mutation = useMutation({
    mutationFn: (patch: StructuredDataPatch) =>
      patchStructuredData(documentId, patch),
    onSuccess: () => {
      toast.success("Structured data saved.")
      void queryClient.invalidateQueries({
        queryKey: ["document", documentId],
      })
      void queryClient.invalidateQueries({
        queryKey: ["document", documentId, "structured"],
      })
      navigate(`/documents/${documentId}`)
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  const dirtyPatch = useMemo(() => buildPatch(baseline, form), [baseline, form])

  function submit() {
    const patch = buildPatch(baseline, form)
    if (Object.keys(patch).length === 0) {
      toast.message("No changes to save.")
      return
    }
    mutation.mutate(patch)
  }

  const update = <K extends keyof FormState>(key: K, v: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: v }))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            Edit structured data
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Changes are audited and encrypted. Only modified fields are sent to
            the server.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(`/documents/${documentId}`)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              mutation.isPending ||
              Object.keys(dirtyPatch ?? {}).length === 0
            }
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </div>

      <Section title="Patient">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient name">
            <Input
              value={form.patient_name}
              onChange={(e) => update("patient_name", e.target.value)}
            />
          </Field>
          <Field label="Age">
            <Input
              value={form.age}
              onChange={(e) => update("age", e.target.value)}
            />
          </Field>
          <Field label="Gender">
            <Input
              value={form.gender}
              onChange={(e) => update("gender", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </Field>
          <Field label="UHID">
            <Input
              value={form.uhid}
              onChange={(e) => update("uhid", e.target.value)}
            />
          </Field>
          <Field label="ABHA ID">
            <Input
              value={form.abha_id}
              onChange={(e) => update("abha_id", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Episode">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Admission date">
            <Input
              type="date"
              value={form.admission_date}
              onChange={(e) => update("admission_date", e.target.value)}
            />
          </Field>
          <Field label="Discharge date">
            <Input
              type="date"
              value={form.discharge_date}
              onChange={(e) => update("discharge_date", e.target.value)}
            />
          </Field>
          <Field label="Ward">
            <Input
              value={form.ward}
              onChange={(e) => update("ward", e.target.value)}
            />
          </Field>
          <Field label="Bed number">
            <Input
              value={form.bed_number}
              onChange={(e) => update("bed_number", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Diagnosis">
        <div className="grid gap-4">
          <Field label="Primary diagnosis">
            <textarea
              className={textareaClass}
              value={form.primary_diagnosis}
              onChange={(e) => update("primary_diagnosis", e.target.value)}
            />
          </Field>
          <Field label="Secondary diagnoses (comma-separated)">
            <Input
              value={form.secondary_diag_tags}
              onChange={(e) => update("secondary_diag_tags", e.target.value)}
              placeholder="e.g. Type 2 DM, Hypertension"
            />
          </Field>
          <Field label="Presenting complaints (comma-separated)">
            <Input
              value={form.presenting_tags}
              onChange={(e) => update("presenting_tags", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Vitals">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Blood pressure">
            <Input
              value={form.blood_pressure}
              onChange={(e) => update("blood_pressure", e.target.value)}
            />
          </Field>
          <Field label="Pulse rate">
            <Input
              value={form.pulse_rate}
              onChange={(e) => update("pulse_rate", e.target.value)}
            />
          </Field>
          <Field label="Temperature">
            <Input
              value={form.temperature}
              onChange={(e) => update("temperature", e.target.value)}
            />
          </Field>
          <Field label="Oxygen saturation">
            <Input
              value={form.oxygen_saturation}
              onChange={(e) => update("oxygen_saturation", e.target.value)}
            />
          </Field>
          <Field label="Weight">
            <Input
              value={form.weight}
              onChange={(e) => update("weight", e.target.value)}
            />
          </Field>
          <Field label="Height">
            <Input
              value={form.height}
              onChange={(e) => update("height", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Investigations">
        <div className="space-y-3">
          {form.investigations.map((row, idx) => (
            <div
              key={idx}
              className="grid gap-3 rounded-xl border border-border/50 bg-white/45 p-4 backdrop-blur-sm sm:grid-cols-[1fr_1fr_auto]"
            >
              <Input
                placeholder="Name"
                value={row.name}
                onChange={(e) => {
                  const next = [...form.investigations]
                  next[idx] = { ...row, name: e.target.value }
                  update("investigations", next)
                }}
              />
              <Input
                placeholder="Result"
                value={row.result}
                onChange={(e) => {
                  const next = [...form.investigations]
                  next[idx] = { ...row, result: e.target.value }
                  update("investigations", next)
                }}
              />
              <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
                <Input
                  type="date"
                  value={row.date}
                  onChange={(e) => {
                    const next = [...form.investigations]
                    next[idx] = { ...row, date: e.target.value }
                    update("investigations", next)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove row"
                  onClick={() =>
                    update(
                      "investigations",
                      form.investigations.filter((_, i) => i !== idx),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("investigations", [
                ...form.investigations,
                { name: "", result: "", date: "" },
              ])
            }
          >
            <Plus className="size-4" />
            Add investigation
          </Button>
        </div>
      </Section>

      <Section title="Procedures">
        <div className="space-y-3">
          {form.procedures.map((row, idx) => (
            <div
              key={idx}
              className="grid gap-3 rounded-xl border border-border/50 bg-white/45 p-4 backdrop-blur-sm sm:grid-cols-3"
            >
              <Input
                placeholder="Procedure name"
                value={row.name}
                onChange={(e) => {
                  const next = [...form.procedures]
                  next[idx] = { ...row, name: e.target.value }
                  update("procedures", next)
                }}
              />
              <Input
                type="date"
                placeholder="Date"
                value={row.date}
                onChange={(e) => {
                  const next = [...form.procedures]
                  next[idx] = { ...row, date: e.target.value }
                  update("procedures", next)
                }}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Surgeon"
                  value={row.surgeon}
                  onChange={(e) => {
                    const next = [...form.procedures]
                    next[idx] = { ...row, surgeon: e.target.value }
                    update("procedures", next)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove row"
                  onClick={() =>
                    update(
                      "procedures",
                      form.procedures.filter((_, i) => i !== idx),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("procedures", [
                ...form.procedures,
                { name: "", date: "", surgeon: "" },
              ])
            }
          >
            <Plus className="size-4" />
            Add procedure
          </Button>
        </div>
      </Section>

      <Section title="Medications during stay">
        <MedRows
          rows={form.medications_during_stay}
          onChange={(rows) => update("medications_during_stay", rows)}
        />
      </Section>

      <Section title="Discharge medications">
        <MedRows
          rows={form.discharge_medications}
          onChange={(rows) => update("discharge_medications", rows)}
        />
      </Section>

      <Section title="Follow-up & advice">
        <div className="grid gap-4">
          <Field label="Follow-up instructions">
            <textarea
              className={textareaClass}
              value={form.follow_up_instructions}
              onChange={(e) =>
                update("follow_up_instructions", e.target.value)
              }
            />
          </Field>
          <Field label="Follow-up date">
            <Input
              type="date"
              value={form.follow_up_date}
              onChange={(e) => update("follow_up_date", e.target.value)}
            />
          </Field>
          <Field label="Diet advice">
            <textarea
              className={textareaClass}
              value={form.diet_advice}
              onChange={(e) => update("diet_advice", e.target.value)}
            />
          </Field>
          <Field label="Allergies">
            <textarea
              className={textareaClass}
              value={form.allergies}
              onChange={(e) => update("allergies", e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Clinical team">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Consultant">
            <Input
              value={form.consultant}
              onChange={(e) => update("consultant", e.target.value)}
            />
          </Field>
          <Field label="Surgeon">
            <Input
              value={form.surgeon}
              onChange={(e) => update("surgeon", e.target.value)}
            />
          </Field>
          <Field label="Anesthetist">
            <Input
              value={form.anesthetist}
              onChange={(e) => update("anesthetist", e.target.value)}
            />
          </Field>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/60 bg-white/65 p-6 shadow-md shadow-orange-950/5 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55">
      <h2 className="font-semibold text-foreground text-sm tracking-tight">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function MedRows({
  rows,
  onChange,
}: {
  rows: MedRow[]
  onChange: (r: MedRow[]) => void
}) {
  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="grid gap-3 rounded-xl border border-border/50 bg-white/45 p-4 backdrop-blur-sm sm:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <Input
            placeholder="Name"
            value={row.name}
            onChange={(e) => {
              const next = [...rows]
              next[idx] = { ...row, name: e.target.value }
              onChange(next)
            }}
          />
          <Input
            placeholder="Dose"
            value={row.dose}
            onChange={(e) => {
              const next = [...rows]
              next[idx] = { ...row, dose: e.target.value }
              onChange(next)
            }}
          />
          <Input
            placeholder="Frequency"
            value={row.frequency}
            onChange={(e) => {
              const next = [...rows]
              next[idx] = { ...row, frequency: e.target.value }
              onChange(next)
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove row"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rows, { name: "", dose: "", frequency: "" }])
        }
      >
        <Plus className="size-4" />
        Add medication
      </Button>
    </div>
  )
}
