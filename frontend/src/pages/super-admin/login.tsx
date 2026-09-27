import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { loginSchema, type LoginValues } from '../../lib/schemas'
import { ThemeSelector } from '../../components/ui/theme-selector'

export function SuperAdminLoginPage() {
  const { loginSuperAdmin } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    try {
      await loginSuperAdmin(values.email, values.password)
      toast.success('Signed in.')
      navigate('/super-admin', { replace: true })
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <ThemeSelector />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-center">
          <Logo />
        </div>

        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">System access</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Super Admin Sign in
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage organizations, administrators, and queue settings.
          </p>
        </div>

        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" {...form.register('email')} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-11"
                {...form.register('password')}
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
            <FieldError message={form.formState.errors.password?.message} />
          </div>

          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link to="/" className="font-medium text-foreground hover:text-accent">
            Back to home
          </Link>
        </p>
        </div>
      </div>
    </div>
  )
}
