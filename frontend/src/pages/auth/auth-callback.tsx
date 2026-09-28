import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Logo } from '../../components/brand/logo'
import { Button } from '../../components/ui/button'
import { useAuth } from '../../hooks/use-auth'
import { userMessage } from '../../lib/api'
import { supabase } from '../../lib/supabase'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const { refresh } = useAuth()

  useEffect(() => {
    let cancelled = false

    async function handleCallback() {
      try {
        const code = searchParams.get('code')
        const next = searchParams.get('next') ?? '/auth/setup-password'

        if (code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError || !data.session) {
            throw exchangeError ?? new Error('Your invitation link could not be validated.')
          }

          await refresh()
          if (!cancelled) {
            const redirect = next.startsWith('/') ? next : '/auth/setup-password'
            navigate(redirect, { replace: true })
          }
          return
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (!session) {
          throw new Error('Your invitation session is missing or invalid.')
        }

        await refresh()
        if (!cancelled) {
          navigate('/auth/setup-password', { replace: true })
        }
      } catch (caught) {
        if (!cancelled) {
          setError(userMessage(caught, 'general'))
          toast.error(userMessage(caught, 'general'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void handleCallback()

    return () => {
      cancelled = true
    }
  }, [navigate, refresh, searchParams])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-center">
          <Logo />
        </div>

        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">QUEUE-NECT</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {loading ? 'Validating invitation...' : error ? 'Invitation unavailable' : 'Invitation accepted'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {loading ? 'Checking your secure invitation link and session.' : error ?? 'Your invitation is being processed.'}
          </p>
        </div>

        {error ? (
          <div className="mt-6">
            <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/clinic/login', { replace: true })}>
              Return to sign in
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
