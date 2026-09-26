const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function formatTime(iso?: string | null) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatDate(iso?: string | null) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return '—'
  return `${formatDate(iso)} ${formatTime(iso)}`
}

export function formatRelative(iso?: string | null) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const abs = Math.abs(deltaSeconds)
  if (abs < 60) return relativeFormatter.format(Math.round(deltaSeconds), 'second')
  if (abs < 3600) return relativeFormatter.format(Math.round(deltaSeconds / 60), 'minute')
  if (abs < 86400) return relativeFormatter.format(Math.round(deltaSeconds / 3600), 'hour')
  return relativeFormatter.format(Math.round(deltaSeconds / 86400), 'day')
}

export function greetingForNow(now = new Date()) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function formatDuration(startIso?: string | null, endIso?: string | null) {
  if (!startIso || !endIso) return '—'
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'
  const minutes = Math.round((end - start) / 60000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function formatWait(minutes?: number | null) {
  if (minutes == null) return '—'
  if (minutes < 1) return '<1 min'
  return `~${minutes} min`
}
