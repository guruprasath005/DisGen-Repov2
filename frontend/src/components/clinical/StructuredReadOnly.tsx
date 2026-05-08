import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

function field(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  if (v == null || v === "") return "—"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return JSON.stringify(v)
}

function chipList(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return "—"
  return items.map(String).join(", ")
}

function Cell({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/40 bg-white/40 px-3 py-2 shadow-sm backdrop-blur-sm",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 whitespace-pre-wrap text-sm leading-snug text-foreground">
        {children}
      </div>
    </div>
  )
}

export function StructuredReadOnly({
  data,
}: {
  data: Record<string, unknown>
}) {
  const investigations = Array.isArray(data.investigations)
    ? (data.investigations as Record<string, unknown>[])
    : []
  const procedures = Array.isArray(data.procedures)
    ? (data.procedures as Record<string, unknown>[])
    : []
  const medsStay = Array.isArray(data.medications_during_stay)
    ? (data.medications_during_stay as Record<string, unknown>[])
    : []
  const medsDc = Array.isArray(data.discharge_medications)
    ? (data.discharge_medications as Record<string, unknown>[])
    : []
  const donor = data.donor_details as Record<string, unknown> | null | undefined
  const opDetails = data.operative_details as Record<string, unknown> | null | undefined
  const postOpCourse = Array.isArray(data.post_operative_course)
    ? (data.post_operative_course as Record<string, unknown>[])
    : []
  const imaging = Array.isArray(data.imaging)
    ? (data.imaging as Record<string, unknown>[])
    : []
  const serology = Array.isArray(data.serology)
    ? (data.serology as Record<string, unknown>[])
    : []
  const urinefindings = Array.isArray(data.urine_findings)
    ? (data.urine_findings as Record<string, unknown>[])
    : []
  const pastMedical = Array.isArray(data.past_medical_history)
    ? (data.past_medical_history as string[])
    : []
  const pastSurgical = Array.isArray(data.past_surgical_history)
    ? (data.past_surgical_history as string[])
    : []
  const comorbidities = Array.isArray(data.comorbidities)
    ? (data.comorbidities as string[])
    : []

  const hasDonor = donor && Object.values(donor).some((v) => v != null && v !== "")
  const hasOpDetails = opDetails && Object.values(opDetails).some((v) => v != null && v !== "")
  const hasClinicalBg = pastMedical.length > 0 || pastSurgical.length > 0 || comorbidities.length > 0

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Patient & identifiers
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Cell label="Patient name">{field(data, "patient_name")}</Cell>
          <Cell label="Age">{field(data, "age")}</Cell>
          <Cell label="Gender">{field(data, "gender")}</Cell>
          <Cell label="UHID">{field(data, "uhid")}</Cell>
          <Cell label="ABHA ID">{field(data, "abha_id")}</Cell>
          <Cell label="Phone">{field(data, "phone")}</Cell>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Admission / discharge
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Cell label="Admission date">{field(data, "admission_date")}</Cell>
          <Cell label="Discharge date">{field(data, "discharge_date")}</Cell>
          <Cell label="Department">{field(data, "department")}</Cell>
          <Cell label="Ward">{field(data, "ward")}</Cell>
          <Cell label="Bed">{field(data, "bed_number")}</Cell>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Diagnosis
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Cell label="Primary diagnosis">{field(data, "primary_diagnosis")}</Cell>
          <Cell label="Secondary diagnoses">
            {chipList(data.secondary_diagnoses)}
          </Cell>
          <Cell label="Presenting complaints" className="sm:col-span-2">
            {chipList(data.presenting_complaints)}
          </Cell>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vitals
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Cell label="Blood pressure">{field(data, "blood_pressure")}</Cell>
          <Cell label="Pulse">{field(data, "pulse_rate")}</Cell>
          <Cell label="Resp. rate">{field(data, "respiratory_rate")}</Cell>
          <Cell label="Temperature">{field(data, "temperature")}</Cell>
          <Cell label="SpO₂">{field(data, "oxygen_saturation")}</Cell>
          <Cell label="Weight">{field(data, "weight")}</Cell>
          <Cell label="Height">{field(data, "height")}</Cell>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Investigations
        </h3>
        {investigations.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-2">
            {investigations.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium text-foreground">
                  {String(row.name ?? "—")}
                </span>
                {(row.value != null || row.result != null) && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {String(row.value ?? row.result)}
                    {row.unit ? ` ${row.unit}` : ""}
                  </span>
                )}
                {row.date ? (
                  <span className="block text-xs text-muted-foreground">
                    {String(row.date)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Procedures
        </h3>
        {procedures.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-2">
            {procedures.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.name ?? "—")}</span>
                {row.date ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {String(row.date)}
                  </span>
                ) : null}
                {(row.surgeon ?? row.notes) ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {String(row.surgeon ?? row.notes)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Medications (during stay)
        </h3>
        {medsStay.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-2">
            {medsStay.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.name ?? "—")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {row.dose ? `${String(row.dose)}` : ""}
                  {row.frequency ? ` · ${String(row.frequency)}` : ""}
                  {row.route ? ` · ${String(row.route)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Discharge medications
        </h3>
        {medsDc.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-2">
            {medsDc.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.name ?? "—")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {row.dose ? `${String(row.dose)}` : ""}
                  {row.frequency ? ` · ${String(row.frequency)}` : ""}
                  {row.duration ? ` · ${String(row.duration)}` : ""}
                  {row.instructions
                    ? ` · ${String(row.instructions)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Follow-up & advice
        </h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <Cell label="Follow-up instructions">
            {field(data, "follow_up_instructions")}
          </Cell>
          <Cell label="Follow-up date">{field(data, "follow_up_date")}</Cell>
          <Cell label="Diet advice">{field(data, "diet_advice")}</Cell>
          <Cell label="Allergies">{field(data, "allergies")}</Cell>
        </div>
        {Array.isArray(data.discharge_advice) && (data.discharge_advice as unknown[]).length > 0 && (
          <div className="mt-2 rounded-lg border border-border/40 bg-white/40 px-3 py-2.5 shadow-sm backdrop-blur-sm">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Discharge advice
            </p>
            <ul className="mt-1.5 space-y-1">
              {(data.discharge_advice as string[]).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-snug text-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/50" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Clinical team
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <Cell label="Consultant">{field(data, "consultant")}</Cell>
          <Cell label="Surgeon">{field(data, "surgeon")}</Cell>
          <Cell label="Anesthetist">{field(data, "anesthetist")}</Cell>
        </div>
      </section>

      {/* ── Extended clinical details ─────────────────────────────────────── */}

      {!!data.blood_group && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Blood group
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Cell label="Blood group">{field(data, "blood_group")}</Cell>
          </div>
        </section>
      )}

      {hasDonor && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Donor details
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Cell label="Name">{String(donor!.name ?? "—")}</Cell>
            <Cell label="Age / Sex">
              {[donor!.age, donor!.gender].filter(Boolean).join(" / ") || "—"}
            </Cell>
            <Cell label="Blood group">{String(donor!.blood_group ?? "—")}</Cell>
            <Cell label="Relation">{String(donor!.relation ?? "—")}</Cell>
            <Cell label="IP number">{String(donor!.ip_number ?? "—")}</Cell>
          </div>
        </section>
      )}

      {hasClinicalBg && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Clinical background
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {pastMedical.length > 0 && (
              <Cell label="Past medical history" className="sm:col-span-2">
                {pastMedical.join(" · ")}
              </Cell>
            )}
            {pastSurgical.length > 0 && (
              <Cell label="Past surgical history">
                {pastSurgical.join(" · ")}
              </Cell>
            )}
            {comorbidities.length > 0 && (
              <Cell label="Comorbidities">{comorbidities.join(" · ")}</Cell>
            )}
          </div>
        </section>
      )}

      {!!data.hospital_course && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Hospital course
          </h3>
          <Cell label="Course in hospital" className="w-full">
            {field(data, "hospital_course")}
          </Cell>
        </section>
      )}

      {hasOpDetails && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Operative details
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {!!opDetails!.approach && (
              <Cell label="Approach">{String(opDetails!.approach)}</Cell>
            )}
            {!!opDetails!.anastomosis && (
              <Cell label="Anastomosis">{String(opDetails!.anastomosis)}</Cell>
            )}
            {!!opDetails!.stent_details && (
              <Cell label="Stent details">{String(opDetails!.stent_details)}</Cell>
            )}
            {!!opDetails!.findings && (
              <Cell label="Findings">{String(opDetails!.findings)}</Cell>
            )}
            {!!opDetails!.notes && (
              <Cell label="Notes" className="sm:col-span-2">{String(opDetails!.notes)}</Cell>
            )}
          </div>
        </section>
      )}

      {postOpCourse.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Post-operative course
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-white/40">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Day</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Parameter</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Value</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Unit</th>
                </tr>
              </thead>
              <tbody>
                {postOpCourse.map((row, i) => (
                  <tr key={i} className="border-b border-border/20 bg-white/20 last:border-0">
                    <td className="px-3 py-2 font-medium">{String(row.day ?? "—")}</td>
                    <td className="px-3 py-2">{String(row.parameter ?? "—")}</td>
                    <td className="px-3 py-2">{String(row.value ?? "—")}</td>
                    <td className="px-3 py-2 text-muted-foreground">{String(row.unit ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {urinefindings.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Urine findings
          </h3>
          <ul className="space-y-2">
            {urinefindings.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.name ?? "—")}</span>
                {row.value != null && (
                  <span className="text-muted-foreground">
                    {" "}— {String(row.value)}{row.unit ? ` ${String(row.unit)}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {serology.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Serology
          </h3>
          <ul className="space-y-2">
            {serology.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.name ?? "—")}</span>
                {row.result != null && (
                  <span className="text-muted-foreground"> — {String(row.result)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {imaging.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Imaging
          </h3>
          <ul className="space-y-2">
            {imaging.map((row, i) => (
              <li
                key={i}
                className="rounded-lg border border-border/40 bg-white/35 px-3 py-2 text-sm backdrop-blur-sm"
              >
                <span className="font-medium">{String(row.modality ?? "—")}</span>
                {!!row.finding && (
                  <span className="text-muted-foreground"> — {String(row.finding)}</span>
                )}
                {!!row.date && (
                  <span className="block text-xs text-muted-foreground">{String(row.date)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
