import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import axios from "axios"
import { Building2, FileOutput, Palette } from "lucide-react"
import { toast } from "sonner"

import { fetchSchemes } from "@/api/schemes"
import {
  fetchHospitalConfig,
  updateHospitalConfig,
  type HospitalConfigUpdateBody,
  type HospitalConfigResponse,
} from "@/api/superadmin"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

const inputClass =
  "h-10 rounded-xl border-input/95 bg-background shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)]"

const textareaClass = cn(
  "w-full resize-y rounded-xl border border-input/95 bg-background px-3 py-2.5 text-sm shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)] outline-none",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/45",
)

const selectClass = cn(
  "h-10 w-full rounded-xl border border-input/95 bg-background px-3 text-sm shadow-[inset_0_1px_2px_rgb(15_23_42_/_0.06)] outline-none",
  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/45",
)

export default function HospitalConfigPage() {
  const qc = useQueryClient()
  const hospitalQuery = useQuery({
    queryKey: ["superadmin", "hospital"],
    queryFn: fetchHospitalConfig,
  })
  const schemesQuery = useQuery({
    queryKey: ["schemes"],
    queryFn: fetchSchemes,
  })

  const cfg = hospitalQuery.data
  const schemes = schemesQuery.data ?? []

  return (
    <div className="space-y-10 pb-12">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <Building2 className="size-5" aria-hidden />
          </div>
          <h1 className="font-semibold text-2xl text-foreground tracking-tight">
            Hospital profile
          </h1>
        </div>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-relaxed">
          Legal identity, contact routing, and export branding applied to PDF
          summaries and correspondence generated within this tenant. Changes are
          audited and visible on the next issued document.
        </p>
      </div>

      {hospitalQuery.isLoading || schemesQuery.isLoading || !cfg ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : hospitalQuery.error ? (
        <Card className="border-destructive/30 bg-destructive/[0.04] shadow-[var(--shadow-card)]">
          <CardContent className="p-6 text-destructive text-sm">
            Unable to load hospital configuration. Confirm super-admin access and
            try again.
          </CardContent>
        </Card>
      ) : (
        <HospitalForm
          key={cfg.updated_at}
          initial={cfg}
          schemes={schemes}
          qc={qc}
        />
      )}
    </div>
  )
}

function HospitalForm({
  initial,
  schemes,
  qc,
}: {
  initial: HospitalConfigResponse
  schemes: Awaited<ReturnType<typeof fetchSchemes>>
  qc: ReturnType<typeof useQueryClient>
}) {
  const [name, setName] = React.useState(initial.name)
  const [address, setAddress] = React.useState(initial.address ?? "")
  const [phone, setPhone] = React.useState(initial.phone ?? "")
  const [email, setEmail] = React.useState(initial.email ?? "")
  const [registrationNumber, setRegistrationNumber] = React.useState(
    initial.registration_number ?? "",
  )
  const [gstin, setGstin] = React.useState(initial.gstin ?? "")
  const [defaultScheme, setDefaultScheme] = React.useState(initial.default_scheme)
  const [pdfHeaderColor, setPdfHeaderColor] = React.useState(
    initial.pdf_header_color,
  )
  const [pdfAccentColor, setPdfAccentColor] = React.useState(
    initial.pdf_accent_color,
  )
  const [logo, setLogo] = React.useState(initial.logo ?? "")

  const saveMutation = useMutation({
    mutationFn: (body: HospitalConfigUpdateBody) => updateHospitalConfig(body),
    onSuccess: async () => {
      toast.success("Hospital profile saved.")
      await qc.invalidateQueries({ queryKey: ["superadmin", "hospital"] })
    },
    onError: (e: unknown) => toast.error(extractErr(e)),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error("Hospital name is required.")
      return
    }
    const emailTrim = email.trim()
    const body: HospitalConfigUpdateBody = {
      name: trimmedName,
      logo: logo.trim() || null,
      address: address.trim() || null,
      phone: phone.trim() || null,
      email: emailTrim ? emailTrim : null,
      registration_number: registrationNumber.trim() || null,
      gstin: gstin.trim() || null,
      default_scheme: defaultScheme.trim() || initial.default_scheme,
      pdf_header_color: pdfHeaderColor.trim().toUpperCase(),
      pdf_accent_color: pdfAccentColor.trim().toUpperCase(),
    }
    saveMutation.mutate(body)
  }

  return (
    <form className="mx-auto max-w-3xl space-y-6" onSubmit={submit}>
      <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent shadow-[var(--shadow-card)]">
        <CardContent className="flex gap-4 py-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-primary ring-1 ring-primary/20">
            <FileOutput className="size-[18px]" aria-hidden />
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            These fields populate discharge PDF headers, institutional blocks on
            summaries, and default scheme selection for new clinical workflows.
            Use formal registration details exactly as they should appear on
            patient-facing artefacts.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-[var(--shadow-card)]">
        <CardHeader className="border-border/55 border-b pb-4">
          <CardTitle className="font-heading">Identity & registration</CardTitle>
          <CardDescription>
            Legal naming and statutory identifiers shown where the institution is
            cited.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label htmlFor="hospital-name">
              Hospital name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="hospital-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reg-number">Registration number</Label>
              <Input
                id="reg-number"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-[var(--shadow-card)]">
        <CardHeader className="border-border/55 border-b pb-4">
          <CardTitle className="font-heading">Contact & location</CardTitle>
          <CardDescription>
            Reach details used on correspondence lines and administrative PDF
            footers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="space-y-2">
            <Label htmlFor="hospital-address">Registered address</Label>
            <textarea
              id="hospital-address"
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={textareaClass}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hospital-phone">Phone</Label>
              <Input
                id="hospital-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hospital-email">Email</Label>
              <Input
                id="hospital-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-[var(--shadow-card)]">
        <CardHeader className="border-border/55 border-b pb-4">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/80 text-foreground ring-1 ring-border/70">
              <Palette className="size-4" aria-hidden />
            </div>
            <div>
              <CardTitle className="font-heading">
                Exports & visual branding
              </CardTitle>
              <CardDescription className="mt-1">
                Default discharge scheme for new summaries and chromatic styling for
                PDF chrome.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <Label htmlFor="default-scheme">Default discharge scheme</Label>
            <select
              id="default-scheme"
              className={selectClass}
              value={defaultScheme}
              onChange={(e) => setDefaultScheme(e.target.value)}
            >
              {schemes.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.label} ({s.name})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pdf-header">PDF header colour</Label>
              <div className="flex gap-2">
                <Input
                  id="pdf-header"
                  type="color"
                  value={pdfHeaderColor}
                  onChange={(e) => setPdfHeaderColor(e.target.value)}
                  className="h-10 w-14 shrink-0 cursor-pointer rounded-xl border-input/95 px-1 py-1"
                />
                <Input
                  aria-label="PDF header colour hex"
                  value={pdfHeaderColor}
                  onChange={(e) => setPdfHeaderColor(e.target.value)}
                  className={cn(inputClass, "min-w-0 flex-1 font-mono text-xs")}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pdf-accent">PDF accent colour</Label>
              <div className="flex gap-2">
                <Input
                  id="pdf-accent"
                  type="color"
                  value={pdfAccentColor}
                  onChange={(e) => setPdfAccentColor(e.target.value)}
                  className="h-10 w-14 shrink-0 cursor-pointer rounded-xl border-input/95 px-1 py-1"
                />
                <Input
                  aria-label="PDF accent colour hex"
                  value={pdfAccentColor}
                  onChange={(e) => setPdfAccentColor(e.target.value)}
                  className={cn(inputClass, "min-w-0 flex-1 font-mono text-xs")}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo-url">Logo URL</Label>
            <Input
              id="logo-url"
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
            <p className="text-muted-foreground text-xs">
              HTTPS endpoint to a raster or SVG asset suitable for print-density
              rendering.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 border-border/55 bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            Last committed update{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatUpdated(initial.updated_at)}
            </span>
          </p>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="w-full shadow-md shadow-orange-950/15 sm:w-auto"
          >
            {saveMutation.isPending ? "Saving…" : "Save hospital profile"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
