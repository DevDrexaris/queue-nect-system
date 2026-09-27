import { useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Building2,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  QrCode,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { Logo } from '../brand/logo'
import { Button } from '../ui/button'
import { ConnectionBanner } from '../ui/connection-banner'
import { useAuth } from '../../hooks/use-auth'
import { useOnlineStatus } from '../../hooks/use-online-status'
import { useAdminTheme } from '../../hooks/use-admin-theme'
import { SidebarNav, type NavSection } from './sidebar-nav'
import { toast } from 'sonner'

const sections: NavSection[] = [
  {
    title: 'Main',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/admin/queue', label: 'Queue Management', icon: ListOrdered },
    ],
  },
  {
    title: 'Management',
    items: [
      { to: '/admin/students', label: 'Students', icon: Users },
      { to: '/admin/history', label: 'Queue History', icon: History },
      { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin/qr-code', label: 'QR Code', icon: QrCode },
      { to: '/admin/users', label: 'Admin Users', icon: Building2 },
      { to: '/admin/settings', label: 'Clinic Settings', icon: Settings },
    ],
  },
]

const titles: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/queue': 'Queue Management',
  '/admin/students': 'Students',
  '/admin/history': 'Queue History',
  '/admin/analytics': 'Analytics',
  '/admin/qr-code': 'QR Code',
  '/admin/users': 'Admin Users',
  '/admin/settings': 'Clinic Settings',
  '/admin/profile': 'My Profile',
}

export function AdminLayout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const { isDark, toggleTheme } = useAdminTheme()
  const title = titles[location.pathname] || 'Admin'

  async function onLogout() {
    await logout()
    toast.success('You have been signed out.')
    navigate('/admin/login')
  }

  return (
    <div className={`${isDark ? 'dark ' : ''}min-h-dvh bg-background`}>
      <ConnectionBanner />
      <div className="flex min-h-dvh">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
          <div className="flex h-16 items-center border-b border-border px-4">
            <Link to="/admin" aria-label="Queue-Nect admin home">
              <Logo size="sm" />
            </Link>
          </div>
          <SidebarNav sections={sections} />
          <div className="border-t border-border p-3">
            <Link to="/admin/profile" className="block rounded-lg px-2 py-2 text-sm hover:bg-muted">
              <p className="font-medium">{user?.name || 'Administrator'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email || 'Session not verified'}</p>
            </Link>
            <Button variant="ghost" className="mt-1 w-full justify-start" onClick={() => void onLogout()}>
              <LogOut className="size-4" />
              Logout
            </Button>
          </div>
        </aside>

        {open ? (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="w-72 max-w-[85vw] shrink-0 border-r border-border bg-card/95 shadow-2xl backdrop-blur-sm">
              <aside className="flex h-full w-full flex-col bg-card/95">
                <div className="flex h-16 items-center justify-between border-b border-border px-4">
                  <Logo size="sm" />
                  <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close navigation">
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <SidebarNav sections={sections} onNavigate={() => setOpen(false)} />
                </div>
              </aside>
            </div>
            <button type="button" className="flex-1 bg-slate-950/10 backdrop-blur-[1px] transition-colors hover:bg-slate-950/15" aria-label="Close menu" onClick={() => setOpen(false)} />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="size-[18px]" />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              <p className="truncate text-xs text-muted-foreground">{user?.clinic?.name || 'Clinic'}</p>
            </div>
            <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:inline-flex" title={online ? 'Connected' : 'Offline'}>
              <span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {online ? 'Online' : 'Offline'}
            </span>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <Sun className="size-4" />
            </Button>
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setMenuOpen((value) => !value)} aria-haspopup="menu">
                {user?.name?.split(' ')[0] || 'Profile'}
              </Button>
              {menuOpen ? (
                <div role="menu" className="absolute right-0 mt-2 w-48 rounded-lg border border-border bg-card p-1 shadow-md">
                  <Link to="/admin/profile" className="block rounded-md px-3 py-2 text-sm hover:bg-muted" onClick={() => setMenuOpen(false)}>
                    My Profile
                  </Link>
                  <Link to="/admin/profile" className="block rounded-md px-3 py-2 text-sm hover:bg-muted" onClick={() => setMenuOpen(false)}>
                    Change Password
                  </Link>
                  <button type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => void onLogout()}>
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
