import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/ui/page-header'
import { useAuth } from '../../hooks/use-auth'
import { clinicSettingsSchema } from '../../lib/schemas'
import { userMessage } from '../../lib/api'
import { clinicService } from '../../services/api'
import type { z } from 'zod'

type Values = z.infer<typeof clinicSettingsSchema>

export function AdminSettingsPage() {
  const { user } = useAuth()
  const form = useForm<Values>({
    resolver: zodResolver(clinicSettingsSchema),
    defaultValues: {
      name: user?.clinic?.name || '',
      schoolName: user?.clinic?.schoolName || '',
      address: user?.clinic?.address || '',
      contact: user?.clinic?.contact || '',
      queuePrefix: user?.clinic?.queuePrefix || 'A',
      announcement: user?.clinic?.announcement || '',
      voiceAnnouncement: false,
    },
  })

  async function onSubmit(values: Values) {
    try {
      await clinicService.update(values)
      toast.success('Settings saved.')
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  const prefix = form.watch('queuePrefix') || 'A'

  return (
    <div>
      <PageHeader title="Clinic Settings" description="These settings apply to the student queue and TV display." />
      <form className="grid gap-6 xl:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          <CardHeader>
            <CardTitle>Clinic profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Clinic Name</Label>
              <Input id="name" {...form.register('name')} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div>
              <Label htmlFor="schoolName">School Name</Label>
              <Input id="schoolName" {...form.register('schoolName')} />
              <FieldError message={form.formState.errors.schoolName?.message} />
            </div>
            <div>
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...form.register('address')} />
            </div>
            <div>
              <Label htmlFor="contact">Contact</Label>
              <Input id="contact" {...form.register('contact')} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Queue and display</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="queuePrefix">Queue Prefix</Label>
              <Input id="queuePrefix" maxLength={3} {...form.register('queuePrefix')} />
              <p className="mt-1 text-xs text-muted-foreground">
                Numbers will look like {prefix.toUpperCase()}001, {prefix.toUpperCase()}002.
              </p>
              <FieldError message={form.formState.errors.queuePrefix?.message} />
            </div>
            <div>
              <Label htmlFor="announcement">Waiting room announcement</Label>
              <Input id="announcement" {...form.register('announcement')} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('voiceAnnouncement')} />
              Voice announcement on TV display
            </label>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving...' : 'Save settings'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
