import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { queueService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { readStoredTicket } from '../../lib/ticket'
import { usePolling } from '../../hooks/use-polling'
import { useOnlineStatus } from '../../hooks/use-online-status'
import { Card, CardContent } from '../../components/ui/card'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { ConnectionBanner } from '../../components/ui/connection-banner'
import { Dialog } from '../../components/ui/dialog'
import { Button, buttonVariants } from '../../components/ui/button'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { formatElapsedMinutes, formatServiceRange, formatWait } from '../../lib/format'
import { cn } from '../../lib/utils'
import type { QueueEntry, QueueSnapshot } from '../../types'

function headline(entry: QueueEntry) {
  if (entry.status === 'CALLED') return 'Your number is next. Please proceed to the clinic.'
  if (entry.status === 'SERVING') return 'You are currently being served.'
  if (entry.status === 'SERVED' || entry.status === 'COMPLETED') return 'Queue completed.'
  if (entry.status === 'CANCELLED') return 'This queue request was cancelled.'
  if (entry.status === 'NO_SHOW') return 'Marked as no show.'
  return 'Please wait for your number to be called.'
}

function playQueueCallTone() {
  if (typeof window === 'undefined') return

  const AudioConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioConstructor) return

  try {
    const audioContext = new AudioConstructor()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.value = 0.12

    oscillator.connect(gain)
    gain.connect(audioContext.destination)

    const start = audioContext.currentTime
    oscillator.start(start)
    oscillator.stop(start + 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4)

    void audioContext.resume()
  } catch {
    // Browsers may block autoplay audio until a user gesture occurs; we best-effort play the beep.
  }
}

function playQueueCallSequence(times = 5, intervalMs = 220) {
  for (let index = 0; index < times; index += 1) {
    window.setTimeout(() => {
      playQueueCallTone()
    }, index * intervalMs)
  }
}

async function maybeShowQueueNotification(queueNumber: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return

  if (Notification.permission === 'default') {
    await Notification.requestPermission()
  }

  if (Notification.permission !== 'granted') return

  if (document.visibilityState === 'hidden') {
    new Notification('Queue-Nect', {
      body: `Your number ${queueNumber} is now being called.`,
      tag: 'queue-call',
    })
  }
}

export function QueueStatusPage() {
  const [ticket] = useState(() => readStoredTicket())
  const online = useOnlineStatus()
  const [entry, setEntry] = useState<QueueEntry | null>(null)
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(ticket))
  const [notificationEnabled, setNotificationEnabled] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [showCancelPrompt, setShowCancelPrompt] = useState(false)
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const lastCallKeyRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!ticket) return
    try {
      const [nextEntry, nextSnapshot] = await Promise.all([
        queueService.getEntry(ticket.clinicIdentifier, ticket.queueId),
        queueService.getSnapshot(ticket.clinicIdentifier),
      ])
      setEntry(nextEntry)
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (caught) {
      setEntry(null)
      setSnapshot(null)
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [ticket])

  usePolling(load, 5000, Boolean(ticket) && online)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationEnabled(Notification.permission === 'granted')
    }
  }, [])

  async function enableNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setNotificationEnabled(permission === 'granted')
  }

  useEffect(() => {
    if (!entry || entry.status !== 'CALLED') return

    const callKey = `${entry.id}:${entry.calledAt ?? 'unknown'}`
    if (lastCallKeyRef.current === callKey) return

    lastCallKeyRef.current = callKey
    playQueueCallSequence(5, 220)

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void maybeShowQueueNotification(entry.queueNumber)
      return
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      void maybeShowQueueNotification(entry.queueNumber)
    }
  }, [entry])

  async function cancelQueue() {
    if (!ticket || !entry) return
    setCanceling(true)
    try {
      await queueService.cancelEntry(ticket.clinicIdentifier, entry.id)
      setShowCancelPrompt(false)
      setCancelConfirmed(false)
      await load()
    } catch (caught) {
      setError(userMessage(caught))
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
  if (error || !entry) {
    return <ErrorState title="Unable to load queue." description={error || undefined} onRetry={() => void load()} />
  }

  if (entry.status === 'CANCELLED') {
    return (
      <div className="space-y-5 text-center">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
          <p className="text-xs font-medium tracking-[0.2em] uppercase text-emerald-700">Queue cancelled</p>
          <h1 className="mt-3 text-2xl font-semibold">Thank you for visiting.</h1>
          <p className="mt-3 text-sm leading-6 text-emerald-800">
            Your queue number has been cancelled successfully. Please scan the QR code again when you are ready to get a new queue number.
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
      <div
        className={cn(
          'rounded-xl border p-5 text-center',
          entry.status === 'CALLED' && 'border-amber-300 bg-amber-50',
          entry.status === 'SERVING' && 'border-blue-300 bg-blue-50',
          (entry.status === 'SERVED' || entry.status === 'COMPLETED') && 'border-emerald-300 bg-emerald-50',
        )}
      >
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your number</p>
        <div className="mt-2">
          <QueueNumber value={entry.queueNumber} size="lg" />
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
              <QueueStatusBadge status={entry.status} />
            </div>
            {'Notification' in window ? (
              <button
                type="button"
                onClick={() => void enableNotifications()}
                className={cn(
                  'mt-3 inline-flex items-center justify-center rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                  notificationEnabled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-border bg-muted text-foreground hover:bg-muted/80',
                )}
              >
                {notificationEnabled ? 'Notifications enabled' : 'Enable notifications'}
              </button>
            ) : null}
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
