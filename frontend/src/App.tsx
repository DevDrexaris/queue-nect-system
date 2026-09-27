import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './providers/auth-provider'
import { AppToaster } from './components/ui/toaster'
import { StudentLayout } from './components/layout/student-layout'
import { AdminLayout } from './components/layout/admin-layout'
import { SuperAdminLayout } from './components/layout/super-admin-layout'
import { DisplayLayout } from './components/layout/display-layout'
import { RequireRole } from './components/layout/require-role'
import { HomePage } from './pages/home'
import { JoinQueuePage } from './pages/student/join-queue'
import { QueueSuccessPage } from './pages/student/queue-success'
import { QueueStatusPage } from './pages/student/queue-status'
import { QueueTokenGate } from './pages/student/queue-token-gate'
import { QueueAccessRequiredPage } from './pages/student/queue-access-required'
import { AdminLoginPage } from './pages/admin/login'
import { AdminDashboardPage } from './pages/admin/dashboard'
import { AdminQueuePage } from './pages/admin/queue'
import { AdminStudentsPage } from './pages/admin/students'
import { AdminHistoryPage } from './pages/admin/history'
import { AdminAnalyticsPage } from './pages/admin/analytics'
import { AdminQrCodePage } from './pages/admin/qr-code'
import { AdminUsersPage } from './pages/admin/users'
import { AdminSettingsPage } from './pages/admin/settings'
import { AdminProfilePage } from './pages/admin/profile'
import { SuperAdminLoginPage } from './pages/super-admin/login'
import { SuperAdminDashboardPage } from './pages/super-admin/dashboard'
import { SuperAdminOrganizationsPage } from './pages/super-admin/organizations'
import { SuperAdminAdministratorsPage } from './pages/super-admin/administrators'
import { SuperAdminActivityPage } from './pages/super-admin/activity'
import { SuperAdminSettingsPage } from './pages/super-admin/settings'
import { TvDisplayPage } from './pages/display/tv-display'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppToaster />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/queue/status" element={<StudentLayout />}>
            <Route index element={<QueueStatusPage />} />
          </Route>
          <Route path="/q/:token" element={<QueueTokenGate />} />
          <Route path="/queue/access-required" element={<QueueAccessRequiredPage />} />
          <Route path="/queue/:clinicId" element={<QueueAccessRequiredPage />} />
          <Route path="/queue/:clinicId/join" element={<StudentLayout />}>
            <Route index element={<JoinQueuePage />} />
          </Route>
          <Route path="/queue/:clinicId/confirmed" element={<StudentLayout />}>
            <Route index element={<QueueSuccessPage />} />
          </Route>
          <Route path="/display" element={<DisplayLayout />}>
            <Route index element={<TvDisplayPage />} />
            <Route path=":clinicId" element={<TvDisplayPage />} />
          </Route>
          <Route path="/tv" element={<DisplayLayout />}>
            <Route index element={<TvDisplayPage />} />
            <Route path=":clinicId" element={<TvDisplayPage />} />
          </Route>
          <Route path="/clinic/login" element={<AdminLoginPage />} />
          <Route path="/admin/login" element={<Navigate to="/clinic/login" replace />} />
          <Route element={<RequireRole roles={['ADMIN', 'ORG_ADMIN', 'STAFF']} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="queue" element={<AdminQueuePage />} />
              <Route path="students" element={<AdminStudentsPage />} />
              <Route path="history" element={<AdminHistoryPage />} />
              <Route path="analytics" element={<AdminAnalyticsPage />} />
              <Route path="qr-code" element={<AdminQrCodePage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="profile" element={<AdminProfilePage />} />
            </Route>
          </Route>
          <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
          <Route element={<RequireRole roles={['SUPER_ADMIN']} />}>
            <Route path="/super-admin" element={<SuperAdminLayout />}>
              <Route index element={<SuperAdminDashboardPage />} />
              <Route path="organizations" element={<SuperAdminOrganizationsPage />} />
              <Route path="administrators" element={<SuperAdminAdministratorsPage />} />
              <Route path="activity" element={<SuperAdminActivityPage />} />
              <Route path="settings" element={<SuperAdminSettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
