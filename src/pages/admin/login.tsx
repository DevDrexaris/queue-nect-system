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

export function AdminLoginPage() {
  const { loginAdmin } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    try {
      const user = await loginAdmin(values.email, values.password)
      toast.success('Signed in.')
      navigate(user.role === 'SUPER_ADMIN' ? '/super-admin' : '/admin', { replace: true })
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between p-10">
        <Logo size="lg" inverted />
        <div>
          <h1 className="max-w-md text-4xl font-semibold tracking-tight">Smart queuing for school clinics.</h1>
          <p className="mt-4 max-w-sm text-sm text-primary-foreground/75">
            Call the next student, keep the waiting room calm, and give people a number they can trust.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">QUEUE-NECT · Smart Queuing. Better Service.</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Clinic / Staff Login</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage your clinic queue.</p>
          <form className="mt-6 space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
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
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-2 text-muted-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <FieldError message={form.formState.errors.password?.message} />
            </div>
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Logging in...' : 'Login'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            Forgot password is not available yet. Password reset requires email delivery.
          </p>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              Back to Queue-Nect
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
