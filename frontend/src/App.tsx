import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useMemo } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"

import { AdminGate } from "@/components/AdminGate"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import { SuperAdminGate } from "@/components/SuperAdminGate"
import { AppShell } from "@/components/layout/AppShell"
import { AuthProvider } from "@/contexts/AuthContext"
import AuditLogsPage from "@/pages/admin/AuditLogsPage"
import AnalyticsPage from "@/pages/admin/AnalyticsPage"
import HealthPage from "@/pages/admin/HealthPage"
import DashboardPage from "@/pages/DashboardPage"
import DocumentEditPage from "@/pages/DocumentEditPage"
import DocumentViewPage from "@/pages/DocumentViewPage"
import LoginPage from "@/pages/LoginPage"
import ProfilePage from "@/pages/ProfilePage"
import SummaryComparePage from "@/pages/SummaryComparePage"
import SummaryViewPage from "@/pages/SummaryViewPage"
import UploadPage from "@/pages/UploadPage"
import HospitalConfigPage from "@/pages/superadmin/HospitalConfigPage"
import RetentionPage from "@/pages/superadmin/RetentionPage"
import SchemesPage from "@/pages/superadmin/SchemesPage"
import UsersPage from "@/pages/superadmin/UsersPage"

export default function App() {
  const queryClient = useMemo(() => new QueryClient(), [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/documents/:id" element={<DocumentViewPage />} />
              <Route path="/documents/:id/edit" element={<DocumentEditPage />} />
              <Route path="/documents/:id/summary" element={<SummaryViewPage />} />
              <Route
                path="/documents/:id/summary/compare"
                element={<SummaryComparePage />}
              />
              <Route
                path="/admin/audit-logs"
                element={
                  <AdminGate>
                    <AuditLogsPage />
                  </AdminGate>
                }
              />
              <Route
                path="/admin/analytics"
                element={
                  <AdminGate>
                    <AnalyticsPage />
                  </AdminGate>
                }
              />
              <Route
                path="/admin/health"
                element={
                  <AdminGate>
                    <HealthPage />
                  </AdminGate>
                }
              />
              <Route
                path="/superadmin/users"
                element={
                  <SuperAdminGate>
                    <UsersPage />
                  </SuperAdminGate>
                }
              />
              <Route
                path="/superadmin/hospital"
                element={
                  <SuperAdminGate>
                    <HospitalConfigPage />
                  </SuperAdminGate>
                }
              />
              <Route
                path="/superadmin/schemes"
                element={
                  <SuperAdminGate>
                    <SchemesPage />
                  </SuperAdminGate>
                }
              />
              <Route
                path="/superadmin/retention"
                element={
                  <SuperAdminGate>
                    <RetentionPage />
                  </SuperAdminGate>
                }
              />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <Toaster
            position="bottom-right"
            theme="light"
            richColors
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  "!rounded-xl !border-border/80 !shadow-[var(--shadow-card)] !backdrop-blur-md",
                success:
                  "!border-primary/35 !bg-background !text-foreground [&_[data-title]]:!text-foreground",
                error: "!border-destructive/25 !bg-background",
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
