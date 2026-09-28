import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Logo } from '../../components/brand/logo'
import { Button } from '../../components/ui/button'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { useAuth } from '../../hooks/use-auth'
import { userMessage } from '../../lib/api'
import { changePasswordSchema } from '../../lib/schemas'
import { supabase } from '../../lib/supabase'

export function AuthSetupPasswordPage() {
  const navigate = useNavigate()
  const { refresh, user } = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const form = useForm({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onTouched',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  useEffect(() => {
    async function ensureSession() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!session) {
          navigate('/clinic/login', { replace: true })
          return
        }

        await refresh()
      } catch (caught) {
        toast.error(userMessage(caught, 'general'))
        navigate('/clinic/login', { replace: true })
      }
    }

    void ensureSession()
  }, [navigate, refresh])

  async function onSubmit(values: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !session) {
        throw new Error('Your invitation session is missing or invalid.')
      }

      if (!user) {
        await refresh()
      }

      const { error } = await supabase.auth.updateUser({ password: values.newPassword })
      if (error) throw error

      toast.success('Password updated successfully.')

      if (user?.role === 'SUPER_ADMIN') {
        navigate('/super-admin', { replace: true })
        return
      }

      navigate('/admin', { replace: true })
    } catch (caught) {
      toast.error(userMessage(caught, 'general'))
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-center">
          <Logo />
        </div>

        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">QUEUE-NECT</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Set your password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a secure password to finish your account setup.
          </p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="newPassword">New password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                className="pr-11"
                {...form.register('newPassword')}
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <FieldError message={form.formState.errors.newPassword?.message} />
          </div>

          <div>
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                className="pr-11"
                {...form.register('confirmPassword')}
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-2 text-muted-foreground hover:text-foreground"
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                onClick={() => setShowConfirm((value) => !value)}
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <FieldError message={form.formState.errors.confirmPassword?.message} />
          </div>

          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving password...' : 'Set password and continue'}
          </Button>
        </form>
      </div>
    </div>
  )
}
