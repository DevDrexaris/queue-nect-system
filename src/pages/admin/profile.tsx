import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/ui/page-header'
import { useAuth } from '../../hooks/use-auth'
import { authService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { changePasswordSchema } from '../../lib/schemas'
import type { z } from 'zod'

type Values = z.infer<typeof changePasswordSchema>

export function AdminProfilePage() {
  const { user, logout } = useAuth()
  const form = useForm<Values>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(values: Values) {
    try {
      await authService.changePassword(values.currentPassword, values.newPassword)
      toast.success('Password updated.')
      form.reset()
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  return (
    <div>
      <PageHeader title="My Profile" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">Name</span>
              <br />
              {user?.name}
            </p>
            <p>
              <span className="text-muted-foreground">Email</span>
              <br />
              {user?.email}
            </p>
            <p>
              <span className="text-muted-foreground">Role</span>
              <br />
              {user?.role}
            </p>
            <Button variant="outline" onClick={() => void logout()}>
              Logout
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div>
                <Label htmlFor="currentPassword">Current password</Label>
                <Input id="currentPassword" type="password" {...form.register('currentPassword')} />
                <FieldError message={form.formState.errors.currentPassword?.message} />
              </div>
              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input id="newPassword" type="password" {...form.register('newPassword')} />
                <FieldError message={form.formState.errors.newPassword?.message} />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input id="confirmPassword" type="password" {...form.register('confirmPassword')} />
                <FieldError message={form.formState.errors.confirmPassword?.message} />
              </div>
              <Button type="submit" loading={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving...' : 'Update password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
