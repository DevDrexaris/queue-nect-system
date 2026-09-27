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
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { buttonVariants } from '../../components/ui/button'
import { formatWait } from '../../lib/format'
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
  const lastNotifiedRef = useRef<string | null>(null)

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
    if (!entry || entry.status !== 'CALLED') return
    if (lastNotifiedRef.current === entry.id) return

    lastNotifiedRef.current = entry.id
    playQueueCallTone()

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void maybeShowQueueNotification(entry.queueNumber)
      return
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      void maybeShowQueueNotification(entry.queueNumber)
    }
  }, [entry])

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

  const serving = snapshot?.nowServing?.queueNumber
  const waiting = snapshot?.entries.filter((item) => item.status === 'WAITING' || item.id === entry.id).slice(0, 8) ?? []

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
            <p className="text-xs text-muted-foreground uppercase">Estimated wait</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatWait(entry.estimatedWaitMinutes)}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground uppercase">Status</p>
            <div className="mt-2">
              <QueueStatusBadge status={entry.status} />
            </div>
          </div>
        </CardContent>
      </Card>

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
    </div>
  )
}
