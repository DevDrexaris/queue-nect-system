import { Link, Navigate } from 'react-router-dom'
import { Logo } from '../components/brand/logo'
import { buttonVariants } from '../components/ui/button'
import { LoadingState } from '../components/ui/states'
import { useAuth } from '../hooks/use-auth'
import { cn } from '../lib/utils'
import { ThemeSelector } from '../components/ui/theme-selector'

export function HomePage() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingState label="Checking session..." />
  if (user) {
    return <Navigate to={user.role === 'SUPER_ADMIN' ? '/super-admin' : '/admin'} replace />
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Logo size="sm" />
        <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
          <ThemeSelector />
          <Link to="/clinic/login" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Clinic / Staff Login
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-sm font-medium text-accent">Digital Queue Management</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Skip the waiting line. Know when it’s your turn.
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          Queue-Nect helps schools and clinics organize patient and student flow with a clear queue, real-time status, and
          a professional staff dashboard.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/queue/status" className={cn(buttonVariants())}>
            Join a Queue
          </Link>
          <Link to="/clinic/login" className={cn(buttonVariants({ variant: 'outline' }))}>
            Clinic / Staff Login
          </Link>
        </div>
      </main>
    </div>
  )
}
