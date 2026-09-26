import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Building2, LayoutDashboard, LogOut, Menu, Settings, Shield, Users, X } from 'lucide-react'
import { Logo } from '../brand/logo'
import { Button } from '../ui/button'
import { ConnectionBanner } from '../ui/connection-banner'
import { useAuth } from '../../hooks/use-auth'
import { SidebarNav, type NavSection } from './sidebar-nav'
import { toast } from 'sonner'

const sections: NavSection[] = [
  {
    title: 'Platform',
    items: [
      { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/super-admin/organizations', label: 'Organizations', icon: Building2 },
      { to: '/super-admin/administrators', label: 'Administrators', icon: Users },
      { to: '/super-admin/activity', label: 'System Activity', icon: Activity },
      { to: '/super-admin/settings', label: 'System Settings', icon: Settings },
    ],
  },
]

const titles: Record<string, string> = {
  '/super-admin': 'Dashboard',
  '/super-admin/organizations': 'Organizations',
  '/super-admin/administrators': 'Administrators',
  '/super-admin/activity': 'System Activity',
  '/super-admin/settings': 'System Settings',
}

export function SuperAdminLayout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const title = titles[location.pathname] || 'Super Admin'

  async function onLogout() {
    await logout()
    toast.success('You have been signed out.')
    navigate('/super-admin/login')
  }

  return (
    <div className="min-h-dvh bg-background">
      <ConnectionBanner />
      <div className="flex min-h-dvh">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-2 border-b border-border px-4">
            <Logo size="sm" />
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              Super
            </span>
          </div>
          <SidebarNav sections={sections} />
          <div className="border-t border-border p-3">
            <p className="px-2 text-sm font-medium">{user?.name || 'Super Admin'}</p>
            <Button variant="ghost" className="mt-1 w-full justify-start" onClick={() => void onLogout()}>
              <LogOut className="size-4" />
              Logout
            </Button>
          </div>
        </aside>

        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-foreground/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <aside className="relative z-10 flex h-full w-72 flex-col bg-card shadow-xl">
              <div className="flex h-16 items-center justify-between px-4">
                <Logo size="sm" />
                <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close navigation">
                  <X className="size-4" />
                </Button>
              </div>
              <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="size-[18px]" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Shield className="hidden size-4 text-muted-foreground sm:block" />
              <h1 className="truncate text-base font-semibold">{title}</h1>
            </div>
            <Link to="/super-admin/login" className="text-sm text-muted-foreground hover:text-foreground">
              Account
            </Link>
          </header>
          <main className="flex-1 p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
