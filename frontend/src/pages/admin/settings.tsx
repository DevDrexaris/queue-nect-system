import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const form = useForm<Values>({
    resolver: zodResolver(clinicSettingsSchema),
    defaultValues: {
      name: user?.clinic?.name || '',
      schoolName: user?.clinic?.schoolName || '',
      address: user?.clinic?.address || '',
      contact: user?.clinic?.contact || '',
      queuePrefix: user?.clinic?.queuePrefix || 'A',
      announcement: user?.clinic?.announcement || '',
      announcementsEnabled: user?.clinic?.announcementsEnabled ?? true,
      announcementUseCustom: user?.clinic?.announcementUseCustom ?? false,
      announcementTemplate: user?.clinic?.announcementTemplate || 'Queue {queue_number}, please proceed to {service_area}.',
      announcementServiceArea: user?.clinic?.announcementServiceArea || 'the service desk',
      announcementVoice: user?.clinic?.announcementVoice || '',
      announcementRate: user?.clinic?.announcementRate ?? 0.95,
      announcementVolume: user?.clinic?.announcementVolume ?? 1,
    },
  })

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const updateVoices = () => setVoices(window.speechSynthesis.getVoices())
    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
  }, [])

  async function onSubmit(values: Values) {
    try {
      await clinicService.update(values)
      toast.success('Settings saved.')
    } catch (error) {
      toast.error(userMessage(error))
    }
  }

  const prefix = form.watch('queuePrefix') || 'A'
  const preview = (form.watch('announcementUseCustom')
    ? form.watch('announcementTemplate')
    : 'Queue {queue_number}, please proceed to {service_area}.')
    .replaceAll('{queue_number}', `${prefix.toUpperCase()} zero zero four`)
    .replaceAll('{organization_name}', user?.clinic?.name || 'the clinic')
    .replaceAll('{service_area}', form.watch('announcementServiceArea') || 'the service desk')

  function playPreview() {
    if (!('speechSynthesis' in window)) {
      toast.error('Voice announcements are not supported by this browser.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(preview)
    utterance.rate = form.getValues('announcementRate')
    utterance.volume = form.getValues('announcementVolume')
    utterance.voice = voices.find((voice) => voice.name === form.getValues('announcementVoice')) ?? null
    window.speechSynthesis.speak(utterance)
  }

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
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Waiting room announcements</h3>
              <p className="mt-1 text-xs text-muted-foreground">The TV will announce once when a queue is called.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('announcementsEnabled')} />
              Automatic queue announcements
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('announcementUseCustom')} />
              Use a custom message
            </label>
            {form.watch('announcementUseCustom') ? (
              <div>
                <Label htmlFor="announcementTemplate">Custom message</Label>
                <Input id="announcementTemplate" {...form.register('announcementTemplate')} />
              </div>
            ) : null}
            <div>
              <Label htmlFor="announcementServiceArea">Service area</Label>
              <Input id="announcementServiceArea" {...form.register('announcementServiceArea')} />
            </div>
            <div>
              <Label htmlFor="announcementVoice">Announcement voice</Label>
              <select id="announcementVoice" className="h-11 w-full rounded-lg border border-border bg-input px-3 text-sm" {...form.register('announcementVoice')}>
                <option value="">Default voice</option>
                {voices.map((voice) => <option key={`${voice.name}:${voice.lang}`} value={voice.name}>{voice.name} ({voice.lang})</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="text-sm">
                Speech rate <span className="text-muted-foreground">{form.watch('announcementRate').toFixed(2)}</span>
                <input className="mt-2 block w-full" type="range" min="0.5" max="1.5" step="0.05" {...form.register('announcementRate', { valueAsNumber: true })} />
              </label>
              <label className="text-sm">
                Volume <span className="text-muted-foreground">{Math.round(form.watch('announcementVolume') * 100)}%</span>
                <input className="mt-2 block w-full" type="range" min="0" max="1" step="0.05" {...form.register('announcementVolume', { valueAsNumber: true })} />
              </label>
            </div>
            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              <p className="mt-1 text-sm">{preview}</p>
              <Button className="mt-3" type="button" variant="outline" size="sm" onClick={playPreview}>Test announcement</Button>
            </div>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving...' : 'Save settings'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
