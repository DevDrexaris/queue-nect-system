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
import { useAdminTheme } from '../../hooks/use-admin-theme'
import { cn } from '../../lib/utils'

export function SuperAdminLoginPage() {
  const { loginSuperAdmin } = useAuth()
  const { isDark } = useAdminTheme()
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
    <div className={cn('flex min-h-dvh items-center justify-center px-4 py-10', isDark ? 'dark bg-[#07111f]' : 'bg-slate-100')}>
      <div className={cn('w-full max-w-md rounded-2xl border p-6', isDark ? 'border-white/10 bg-white/5 text-white shadow-xl backdrop-blur' : 'border-slate-200 bg-white text-slate-900 shadow-sm')}>
        <div className="mb-6 flex items-center justify-center">
          <Logo inverted={isDark} brandClassName={isDark ? 'text-3xl' : undefined} />
        </div>

        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">System access</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Super Admin Sign in
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
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
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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

        <p className="mt-5 text-center text-sm text-slate-600 dark:text-slate-400">
          <Link to="/" className="font-medium text-slate-900 hover:text-slate-700 dark:text-slate-200 dark:hover:text-white">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  )
}
