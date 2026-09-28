import { Activity, Trash2 } from 'lucide-react'
import { Button } from './button'
import type { AdminActivityEvent } from '../../hooks/use-admin-realtime'

const messages: Record<string, (queueNumber: string) => string> = {
  QUEUE_JOINED: (number) => `${number} joined the queue.`,
  QUEUE_CALLED: (number) => `${number} is now being called.`,
  QUEUE_SERVING: (number) => `${number} started service.`,
  QUEUE_AVAILABILITY_OPENED: () => 'Staff opened the queue.',
  QUEUE_AVAILABILITY_PAUSED: () => 'Staff paused new queue registrations.',
  QUEUE_AVAILABILITY_CLOSED: () => 'Staff closed the queue.',
  LOCATION_CREATED: (name) => `Staff added ${name}.`,
  LOCATION_UPDATED: (name) => `Staff updated ${name}.`,
  LOCATION_ARCHIVED: (name) => `Staff archived ${name}.`,
  QUEUE_CREATED: (name) => `Staff added the ${name} queue.`,
  QUEUE_UPDATED: (name) => `Staff updated the ${name} queue.`,
  QUEUE_ARCHIVED: (name) => `Staff archived the ${name} queue.`,
  QUEUE_COMPLETED: (number) => `${number} completed service.`,
  QUEUE_CANCELLED_BY_STUDENT: (number) => `${number} cancelled their queue.`,
  QUEUE_CANCELLED_BY_ADMIN: (number) => `${number} was cancelled by staff.`,
  QUEUE_NO_SHOW: (number) => `${number} was marked as no-show.`,
  STUDENT_ONLINE: (number) => `${number} is online.`,
  STUDENT_IDLE: (number) => `${number} is inactive.`,
  STUDENT_BACKGROUND: (number) => `${number} entered background.`,
  STUDENT_RETURNED: (number) => `${number} returned to Queue-Nect.`,
  STUDENT_OFFLINE: (number) => `${number} is offline.`,
  SYSTEM_ERROR: () => 'A system error occurred.',
}

function eventTone(action: string) {
  if (action.includes('CANCELLED') || action === 'SYSTEM_ERROR') return 'text-destructive'
  if (action.includes('BACKGROUND') || action.includes('IDLE') || action.includes('OFFLINE')) return 'text-warning'
  if (action.includes('COMPLETED') || action.includes('SERVING') || action === 'STUDENT_RETURNED') return 'text-success'
  if (action === 'QUEUE_CALLED') return 'text-status-calling'
  return 'text-accent'
}

function eventText(event: AdminActivityEvent) {
  const number = event.details?.queue_number || event.details?.name || 'Queue'
  return messages[event.action]?.(number) ?? 'Queue activity updated.'
}

export function ActivityLogsPanel({
  events,
  status,
  activeCount,
  open,
  onOpenChange,
  onClear,
}: {
  events: AdminActivityEvent[]
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  activeCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onClear: () => void
}) {
  const statusLabel = status === 'connected' ? 'Realtime connected' : status === 'reconnecting' ? 'Realtime reconnecting' : status === 'connecting' ? 'Connecting realtime' : 'Realtime disconnected'
  const dotColor = status === 'connected' ? 'bg-emerald-500' : status === 'reconnecting' || status === 'connecting' ? 'bg-amber-500' : 'bg-red-500'

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label={`${statusLabel}. ${activeCount} active students. Open activity logs.`}
        aria-expanded={open}
        title={`${statusLabel} · ${activeCount} active`}
        className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors"
      >
        <span className={`size-2 rounded-full ${dotColor}`} />
        <span className="hidden sm:inline">{status === 'connected' ? 'Realtime' : status === 'reconnecting' ? 'Reconnecting' : status === 'connecting' ? 'Connecting' : 'Offline'}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono tabular-nums text-foreground">{activeCount} Active</span>
      </button>
      <Button variant="ghost" size="icon" aria-label="Activity logs" title="Activity logs" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <Activity className="size-4" />
      </Button>
      {open ? (
        <section className="absolute top-full right-0 z-50 mt-2 flex max-h-[min(70dvh,34rem)] w-[min(92vw,34rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl" aria-label="Activity logs">
          <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${dotColor}`} />
              <h2 className="text-xs font-semibold tracking-wide">ACTIVITY LOG</h2>
              <span className="text-xs text-muted-foreground">{events.length}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onClear}>
              <Trash2 className="size-3.5" /> Clear
            </Button>
          </header>
          <ol className="min-h-32 flex-1 space-y-0.5 overflow-y-auto p-2" aria-live="polite">
            {events.length ? events.map((event) => (
              <li key={event.id} className="grid grid-cols-[4.5rem_1fr] gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/60">
                <time className="font-mono tabular-nums text-muted-foreground" dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                </time>
                <span className={eventTone(event.action)}>{eventText(event)}</span>
              </li>
            )) : (
              <li className="flex h-28 items-center justify-center text-sm text-muted-foreground">No recent activity.</li>
            )}
          </ol>
          <footer className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Organization activity · newest first
          </footer>
        </section>
      ) : null}
    </div>
  )
}
