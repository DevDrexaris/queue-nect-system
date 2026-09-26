import { Link } from 'react-router-dom'
import { Logo } from '../components/brand/logo'
import { buttonVariants } from '../components/ui/button'
import { cn } from '../lib/utils'

export function HomePage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <Link to="/clinic/login" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          Clinic / Staff Login
        </Link>
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
