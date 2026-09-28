import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { queueService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { readStoredTicket } from '../../lib/ticket'
import { useOnlineStatus } from '../../hooks/use-online-status'
import { useStudentQueueRealtime, type StudentQueueRealtimeEvent } from '../../hooks/use-student-presence'
import { Card, CardContent } from '../../components/ui/card'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { ConnectionBanner } from '../../components/ui/connection-banner'
import { Dialog } from '../../components/ui/dialog'
import { Button, buttonVariants } from '../../components/ui/button'
import { QueueEventAnimation } from '../../components/ui/queue-event-animation'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { formatElapsedMinutes, formatServiceRange, formatWait } from '../../lib/format'
import { cn } from '../../lib/utils'
import type { QueueEntry, QueueSnapshot, QueueStatus } from '../../types'

function headline(entry: QueueEntry) {
  if (entry.status === 'CALLED') return 'Your number is next. Please proceed to the clinic.'
  if (entry.status === 'SERVING') return 'You are currently being served.'
  if (entry.status === 'AWAITING_RETURN') return 'You are awaiting return. Please stay available for the next call.'
  if (entry.status === 'SERVED' || entry.status === 'COMPLETED') return 'Queue completed.'
  if (entry.status === 'CANCELLED') return entry.cancellationSource === 'ADMIN'
    ? 'Your queue has been cancelled by staff.'
    : 'You have left the queue.'
  if (entry.status === 'NO_SHOW') return 'Your queue was closed by staff. Please contact the staff desk if you believe this was done by mistake.'
  return 'Please wait for your number to be called.'
}

const NOTIFICATION_PREF = 'qn.queue-notifications'
const SOUND_PREF = 'qn.queue-call-sound'
const LAST_CALL_KEY = 'qn.last-notified-call'
const REALTIME_STATUSES: QueueStatus[] = ['WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN', 'COMPLETED', 'CANCELLED', 'NO_SHOW']

function storedPreference(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function storedCallKey() {
  try {
    return localStorage.getItem(LAST_CALL_KEY)
  } catch {
    return null
  }
}

function playQueueCallSequence(context: AudioContext, volume: number) {
  const start = context.currentTime + 0.03
  for (let index = 0; index < 5; index += 1) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const toneStart = start + index * 0.48
    oscillator.type = 'sine'
    oscillator.frequency.value = index % 2 ? 740 : 880
    gain.gain.setValueAtTime(0.0001, toneStart)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.015, volume * 0.11), toneStart + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.34)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(toneStart)
    oscillator.stop(toneStart + 0.36)
  }
}

export function QueueStatusPage() {
  const [ticket] = useState(() => readStoredTicket())
  const online = useOnlineStatus()
  const [entry, setEntry] = useState<QueueEntry | null>(null)
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(ticket))
  const [notificationEnabled, setNotificationEnabled] = useState(() => storedPreference(NOTIFICATION_PREF, false) && 'Notification' in window && Notification.permission === 'granted')
  const [soundEnabled, setSoundEnabled] = useState(() => storedPreference(SOUND_PREF, true))
  const [callAlertOpen, setCallAlertOpen] = useState(false)
  const [callEventId, setCallEventId] = useState(0)
  const [canceling, setCanceling] = useState(false)
  const [showCancelPrompt, setShowCancelPrompt] = useState(false)
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const hasLoadedRef = useRef(false)
  const requestIdRef = useRef(0)
  const lastCallKeyRef = useRef<string | null>(storedCallKey())
  const lastRealtimeVersionRef = useRef(0)

  const triggerCallAlert = useCallback((nextEntry: QueueEntry, callKey: string) => {
    lastCallKeyRef.current = callKey
    try { localStorage.setItem(LAST_CALL_KEY, callKey) } catch { /* Storage may be blocked. */ }
    setCallEventId((value) => value + 1)
    setCallAlertOpen(true)

    if (soundEnabled && audioContextRef.current?.state === 'running') {
      playQueueCallSequence(audioContextRef.current, 1)
    }
    if (notificationEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification("Queue-Nect — You're being called", {
        body: `Queue ${nextEntry.queueNumber} is now being called. Please proceed to the service area.`,
        icon: '/favicon.svg',
        tag: `queue-call-${callKey}`,
      })
      notification.onclick = () => { window.focus(); window.location.assign('/queue/status') }
    }
  }, [notificationEnabled, soundEnabled])

  const load = useCallback(async (source: 'initial' | 'realtime' | 'resume' | 'manual' = 'manual') => {
    if (!ticket) return
    const requestId = ++requestIdRef.current
    try {
      const [nextEntry, nextSnapshot] = await Promise.all([
        queueService.getEntry(ticket.clinicIdentifier, ticket.queueId),
        queueService.getSnapshot(ticket.clinicIdentifier, ticket.serviceQueueId),
      ])
      if (requestId !== requestIdRef.current) return

      const isInitialLoad = !hasLoadedRef.current || source === 'initial'
      if (!isInitialLoad && source === 'realtime' && nextEntry.status === 'CALLED') {
        const callKey = nextEntry.calledAt ? `${nextEntry.id}:${nextEntry.calledAt}` : null
        if (callKey && callKey !== lastCallKeyRef.current) triggerCallAlert(nextEntry, callKey)
        if (!callKey) console.warn('[Queue-Nect] CALLED queue entry has no called_at timestamp; preserving state without a duplicate alert.', nextEntry)
      }

      setEntry(nextEntry)
      setSnapshot(nextSnapshot)
      setError(null)
      hasLoadedRef.current = true
    } catch (caught) {
      console.error('[Queue-Nect] Student queue load failed:', caught)
      setError(userMessage(caught, 'student'))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [ticket, triggerCallAlert])

  const applyRealtimeEvent = useCallback((event: StudentQueueRealtimeEvent) => {
    if (!ticket || !event.status || !REALTIME_STATUSES.includes(event.status as QueueStatus)) return
    if (event.queue_entry_id && event.queue_entry_id !== ticket.queueId) return
    if (!event.queue_entry_id && event.queue_number !== ticket.queueNumber) {
      console.warn('[Queue-Nect] Ignoring student realtime event without a matching queue entry.', event)
      return
    }

    const version = event.updated_at ? new Date(event.updated_at).getTime() : Date.now()
    if (event.updated_at && version < lastRealtimeVersionRef.current) return
    if (event.updated_at && version === lastRealtimeVersionRef.current) return
    lastRealtimeVersionRef.current = version

    const nextStatus = event.status as QueueStatus
    let nextEntry: QueueEntry | null = null
    setEntry((current) => {
      if (!current) return current
      nextEntry = {
        ...current,
        status: nextStatus,
        calledAt: event.called_at ?? current.calledAt,
        cancellationSource: event.cancellation_source ?? current.cancellationSource,
      }
      return nextEntry
    })
    setSnapshot((current) => {
      if (!current) return current
      return {
        ...current,
        entries: current.entries.map((item) => item.id === ticket.queueId
          ? { ...item, status: nextStatus, calledAt: event.called_at ?? item.calledAt }
          : item),
        nowServing: current.nowServing?.id === ticket.queueId
          ? { ...current.nowServing, status: nextStatus, calledAt: event.called_at ?? current.nowServing.calledAt }
          : current.nowServing,
      }
    })

    if (nextStatus === 'CALLED' && event.previous_status !== 'CALLED' && event.updated_at) {
      const callKey = `${ticket.queueId}:${event.updated_at}`
      const alertEntry = nextEntry ?? entry
      if (alertEntry && callKey !== lastCallKeyRef.current) triggerCallAlert({ ...alertEntry, status: 'CALLED', calledAt: event.called_at ?? alertEntry.calledAt }, callKey)
    }
  }, [entry, ticket, triggerCallAlert])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load('initial'), 0)
    return () => window.clearTimeout(initialLoad)
  }, [load])
  useStudentQueueRealtime((message) => {
    if (message.reason === 'realtime' && message.event) applyRealtimeEvent(message.event)
    else void load('resume')
  }, Boolean(ticket))

  async function enableNotifications() {
    if (!('Notification' in window)) {
      toast.error('Browser notifications are not supported here.')
      return
    }
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
    const enabled = permission === 'granted'
    setNotificationEnabled(enabled)
    localStorage.setItem(NOTIFICATION_PREF, String(enabled))
    if (!enabled) {
      toast.error(permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notifications could not be enabled.')
      return
    }
    await enableWebPush()
  }

  function setNotificationPreference(enabled: boolean) {
    if (!enabled) {
      setNotificationEnabled(false)
      localStorage.setItem(NOTIFICATION_PREF, 'false')
      return
    }
    void enableNotifications()
  }

  async function unlockAudio() {
    if (audioContextRef.current) {
      await audioContextRef.current.resume()
      return audioContextRef.current
    }
    const AudioConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioConstructor) return null
    audioContextRef.current = new AudioConstructor()
    await audioContextRef.current.resume()
    return audioContextRef.current
  }

  async function enableWebPush() {
    const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string | undefined
    if (!('serviceWorker' in navigator)) return
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      if (!publicKey || !('PushManager' in window) || !ticket?.statusToken) return
      const applicationServerKey = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
      const keys = subscription.toJSON().keys
      if (!keys?.p256dh || !keys.auth) return
      const { error: saveError } = await import('../../lib/supabase').then(({ supabaseAnon }) =>
        supabaseAnon.rpc('save_student_push_subscription', {
          p_status_token: ticket.statusToken,
          p_endpoint: subscription.endpoint,
          p_p256dh: keys.p256dh,
          p_auth: keys.auth,
        }),
      )
      if (saveError) throw saveError
    } catch (caught) {
      console.error('[Queue-Nect] Push setup failed:', caught)
      toast.error('Background notifications could not be set up on this device.')
    }
  }

  async function testCallAlert() {
    setCallAlertOpen(true)
    const context = await unlockAudio()
    if (context && soundEnabled) playQueueCallSequence(context, 0.6)
    if (notificationEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification("Queue-Nect — You're being called", {
        body: `Queue ${entry?.queueNumber ?? ticket?.queueNumber} is now being called. Please proceed to the service area.`,
        icon: '/favicon.svg',
        tag: 'queue-call-test',
      })
      notification.onclick = () => { window.focus(); window.location.assign('/queue/status') }
    }
  }

  async function cancelQueue() {
    if (!ticket || !entry) return
    setCanceling(true)
    try {
      await queueService.cancelEntry(ticket.clinicIdentifier, entry.id)
      setShowCancelPrompt(false)
      setCancelConfirmed(false)
      await load()
    } catch (caught) {
      setError(userMessage(caught, 'student'))
    } finally {
      setCanceling(false)
    }
  }

  if (!ticket) {
    return (
      <EmptyState
        title="You are not in a queue"
        description="Scan the clinic QR code and join the queue to see your live status here."
        action={
          <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to Queue-Nect
          </Link>
        }
      />
    )
  }

  if (loading) return <LoadingState label="Loading your queue status..." />
  if (!entry) {
    return <ErrorState title="Unable to load queue." description={error || undefined} onRetry={() => void load()} />
  }

  if (entry.status === 'CANCELLED') {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-6 text-foreground">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-destructive">Queue Cancelled</p>
          <h1 className="mt-3 text-2xl font-semibold">Thank you for visiting.</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {entry.cancellationSource === 'ADMIN' ? 'Your queue has been cancelled by staff.' : 'You have left the queue.'}
          </p>
        </div>

        <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full')}>
          Scan QR code again
        </Link>
      </div>
    )
  }

  const serving = snapshot?.nowServing?.queueNumber
  const waiting = snapshot?.entries.filter((item) => item.status === 'WAITING' || item.status === 'CALLED' || item.id === entry.id).slice(0, 8) ?? []
  const finalServiceTime = entry.servedAt || entry.joinedAt

  return (
    <div className="space-y-5">
      {!online ? <ConnectionBanner /> : null}
      {callAlertOpen && entry.status === 'CALLED' ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/80 p-4 sm:p-6"
          role="presentation"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingRight: 'max(1rem, env(safe-area-inset-right))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))', paddingLeft: 'max(1rem, env(safe-area-inset-left))' }}
        >
          <button type="button" className="absolute inset-0" aria-label="Close call alert" onClick={() => setCallAlertOpen(false)} />
          <section key={callEventId} role="alertdialog" aria-modal="true" aria-label="Your turn" className="relative isolate w-full max-w-sm overflow-hidden rounded-2xl border border-status-calling/35 bg-card p-6 text-center shadow-xl">
            <QueueEventAnimation kind="called" />
            <div className="relative z-10">
              <p className="text-xs font-semibold tracking-[0.2em] text-status-calling uppercase">Your turn</p>
              <QueueNumber value={entry.queueNumber} size="lg" className="queue-number-calling mt-3" />
              <p className="mt-3 text-sm text-foreground">Please proceed to the service area.</p>
              <Button className="mt-5" variant="outline" onClick={() => setCallAlertOpen(false)}>Close</Button>
            </div>
          </section>
        </div>
      ) : null}
      <div
        className={cn(
          'rounded-xl border p-5 text-center',
          entry.status === 'WAITING' && 'border-status-waiting/25 bg-status-waiting/10',
          entry.status === 'CALLED' && 'border-status-calling/35 bg-status-calling/10',
          entry.status === 'SERVING' && 'border-status-serving/25 bg-status-serving/10',
          (entry.status === 'SERVED' || entry.status === 'COMPLETED') && 'border-border bg-muted',
          entry.status === 'NO_SHOW' && 'border-status-no-show/25 bg-status-no-show/10',
        )}
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your number</p>
        <div className="mt-2">
          <QueueNumber value={entry.queueNumber} size="lg" className={entry.status === 'CALLED' ? 'queue-number-calling' : undefined} />
        </div>
        <p className="mt-4 text-sm font-medium">{headline(entry)}</p>
      </div>

      {entry.status === 'WAITING' || entry.status === 'CALLED' ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setShowCancelPrompt(true)} className="border-destructive text-destructive hover:bg-destructive/5">
            Cancel my queue
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Now serving</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{serving || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">People ahead</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{entry.peopleAhead ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">
              {entry.status === 'COMPLETED' || entry.status === 'SERVED' ? 'Time spent' : 'Estimated wait'}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {entry.status === 'COMPLETED' || entry.status === 'SERVED'
                ? formatElapsedMinutes(entry.joinedAt, entry.servedAt ?? entry.joinedAt)
                : formatWait(entry.estimatedWaitMinutes)}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground uppercase">Status</p>
            <div className="mt-2">
              <QueueStatusBadge status={entry.status} label={entry.status === 'NO_SHOW' ? 'Queue closed' : undefined} />
            </div>
            <div className="mt-4 grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={notificationEnabled} onChange={(event) => setNotificationPreference(event.target.checked)} />
                Queue notifications
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={soundEnabled} onChange={(event) => { setSoundEnabled(event.target.checked); localStorage.setItem(SOUND_PREF, String(event.target.checked)) }} />
                Call sound
              </label>
              <Button type="button" variant="outline" size="sm" className="sm:col-span-2" onClick={() => void testCallAlert()}>Test alert</Button>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Sound plays while this page is active. Background push requires browser support and organization setup.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {(entry.status === 'COMPLETED' || entry.status === 'SERVED') && finalServiceTime ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Took you {formatElapsedMinutes(entry.joinedAt, entry.servedAt ?? entry.joinedAt)}.</p>
          <p className="mt-1">From {formatServiceRange(entry.joinedAt, entry.servedAt ?? entry.joinedAt)}</p>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {waiting.map((item, index) => (
            <span key={item.id} className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-md px-2 py-1 font-mono text-xs',
                  item.id === entry.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.queueNumber}
              </span>
              {index < waiting.length - 1 ? <span className="text-muted-foreground">→</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      <Dialog
        open={showCancelPrompt}
        onClose={() => {
          setShowCancelPrompt(false)
          setCancelConfirmed(false)
        }}
        title="Cancel your queue?"
        description="This will remove your queue number from the active line. You can only cancel while your number is still waiting or called, before service begins."
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowCancelPrompt(false); setCancelConfirmed(false) }}>
              Keep my place
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelConfirmed || canceling}
              onClick={() => void cancelQueue()}
            >
              {canceling ? 'Cancelling...' : 'Yes, cancel now'}
            </Button>
          </>
        }
      >
        <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={cancelConfirmed}
            onChange={(event) => setCancelConfirmed(event.target.checked)}
            className="mt-1 size-4"
          />
          <span>I understand my queue number will be cancelled and I will need to rejoin if I return.</span>
        </label>
      </Dialog>
    </div>
  )
}
