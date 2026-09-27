import type { QueuePresence } from '../../hooks/use-admin-realtime'

export function QueuePresenceBadge({ presence, now }: { presence?: QueuePresence; now: number }) {
  if (!presence) return <span className="text-xs text-muted-foreground">Presence pending</span>

  const isStale = now - new Date(presence.last_seen_at).getTime() > 90_000
  const state = isStale && presence.presence !== 'BACKGROUND' ? 'OFFLINE' : presence.presence
  const labels: Record<QueuePresence['presence'], string> = {
    ONLINE: 'Online',
    IDLE: 'Inactive',
    BACKGROUND: 'Background',
    OFFLINE: 'Offline',
  }
  const colors: Record<QueuePresence['presence'], string> = {
    ONLINE: 'bg-emerald-500',
    IDLE: 'bg-amber-500',
    BACKGROUND: 'bg-amber-500',
    OFFLINE: 'bg-muted-foreground',
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={`Presence: ${labels[state]}`}>
      <span className={`size-1.5 rounded-full ${colors[state]}`} />
      {labels[state]}
    </span>
  )
}
