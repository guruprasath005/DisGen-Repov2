import { zodResolver } from "@hookform/resolvers/zod"
import { AxiosError } from "axios"
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react"
import { useForm } from "react-hook-form"
import { Navigate, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"

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
import { useAuth } from "@/hooks/useAuth"

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const { login, accessToken, user, isLoading } = useAuth()
  const navigate = useNavigate()

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  })

  async function onSubmit(values: LoginForm) {
    try {
      await login(values.username, values.password)
      toast.success("Signed in securely")
      navigate("/dashboard", { replace: true })
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status
        if (status === 401) {
          toast.error("Invalid username or password")
          return
        }
        if (status === 429) {
          toast.error("Too many attempts. Try again later.")
          return
        }
        if (status === 423) {
          toast.error(
            typeof err.response?.data?.detail === "string"
              ? err.response.data.detail
              : "Account temporarily locked",
          )
          return
        }
      }
      toast.error("Unable to sign in. Please try again.")
    }
  }

  if (!isLoading && accessToken && user) {
    return <Navigate to="/dashboard" replace />
  }

  if (isLoading) {
    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center gap-4 overflow-hidden bg-background">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-50/78 via-background to-sky-50/34"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-clinical-mesh opacity-[0.86]"
          aria-hidden
        />
        <Loader2
          className="relative z-10 size-12 animate-spin text-primary"
          aria-hidden
        />
        <p className="relative z-10 text-sm text-muted-foreground">
          Checking secure session…
        </p>
      </div>
    )
  }

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-50/74 via-background to-sky-50/32"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-clinical-mesh opacity-[0.88]"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-4 py-12">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-5 flex size-[3.75rem] items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-md)] shadow-primary/28 ring-[3px] ring-white/35">
            <ShieldCheck className="size-[2.1rem]" strokeWidth={2.25} aria-hidden />
          </div>
          <p className="mb-1 font-medium text-[11px] text-primary uppercase tracking-[0.14em]">
            Hospital workspace
          </p>
          <h1 className="font-semibold tracking-tight text-foreground text-3xl sm:text-4xl">
            DisGen
          </h1>
          <p className="mt-2 max-w-md text-pretty text-muted-foreground text-sm sm:text-base leading-relaxed">
            Clinical discharge intelligence — enterprise security, full audit
            trails, and PHI-safe workflows.
          </p>
        </div>

        <Card className="w-full max-w-md border-white/58 bg-white/64 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/52">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl font-semibold tracking-tight">
              Staff sign in
            </CardTitle>
            <CardDescription>
              Enter your hospital credentials. Sessions stay in-memory only —
              never cached in this browser&apos;s storage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-5"
              onSubmit={form.handleSubmit(onSubmit)}
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  spellCheck={false}
                  aria-invalid={!!form.formState.errors.username}
                  {...form.register("username")}
                />
                {form.formState.errors.username && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.username.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="h-10 w-full gap-2 rounded-xl text-[15px] shadow-[var(--shadow-sm)] shadow-primary/22 transition-[box-shadow,transform] hover:shadow-[var(--shadow-md)] hover:shadow-primary/28"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  "Signing in…"
                ) : (
                  <>
                    Continue <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-10 max-w-lg text-center text-[11px] text-muted-foreground/92 leading-relaxed">
          Protected health information (PHI) is processed only on approved
          hospital infrastructure. Unauthorized access is prohibited and subject
          to audit.
        </p>
      </div>
    </div>
  )
}
