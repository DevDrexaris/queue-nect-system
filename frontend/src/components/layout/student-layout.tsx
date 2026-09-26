import { NavLink, Outlet, useParams } from 'react-router-dom'
import { Logo } from '../brand/logo'
import { ConnectionBanner } from '../ui/connection-banner'

export function StudentLayout() {
  const { clinicId } = useParams()
  const base = clinicId ? `/queue/${clinicId}` : '/queue'

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <ConnectionBanner />
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <Logo size="sm" />
          <span className="max-w-[50%] truncate text-sm text-muted-foreground">{clinicId || 'Clinic queue'}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-6 pb-24">
        <Outlet />
      </main>
      {clinicId ? (
        <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto grid max-w-lg grid-cols-2">
            <NavLink
              to={base}
              end
              className={({ isActive }) =>
                `py-3 text-center text-sm font-medium ${isActive ? 'text-accent' : 'text-muted-foreground'}`
              }
            >
              Join queue
            </NavLink>
            <NavLink
              to="/queue/status"
              className={({ isActive }) =>
                `py-3 text-center text-sm font-medium ${isActive ? 'text-accent' : 'text-muted-foreground'}`
              }
            >
              My queue
            </NavLink>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
