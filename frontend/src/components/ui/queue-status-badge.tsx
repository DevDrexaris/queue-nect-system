import { AlertTriangle, Bell, CheckCircle2, CircleDashed, LoaderCircle, XCircle } from 'lucide-react'
import type { QueueStatus } from '../../types'
import { cn } from '../../lib/utils'

const config: Record<
  QueueStatus,
  { label: string; className: string; icon: typeof Bell }
> = {
  WAITING: {
    label: 'Waiting',
    className: 'border border-status-waiting/20 bg-status-waiting/10 text-status-waiting',
    icon: CircleDashed,
  },
  CALLED: {
    label: 'Calling',
    className: 'border border-status-calling/25 bg-status-calling/10 text-status-calling',
    icon: Bell,
  },
  SERVING: {
    label: 'Serving',
    className: 'border border-status-serving/20 bg-status-serving/10 text-status-serving',
    icon: LoaderCircle,
  },
  COMPLETED: {
    label: 'Served',
    className: 'border border-border bg-muted text-status-completed',
    icon: CheckCircle2,
  },
  SERVED: {
    label: 'Served',
    className: 'border border-border bg-muted text-status-completed',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'border border-destructive/20 bg-destructive/10 text-status-cancelled',
    icon: XCircle,
  },
  NO_SHOW: {
    label: 'No show',
    className: 'border border-status-no-show/20 bg-status-no-show/10 text-status-no-show',
    icon: AlertTriangle,
  },
}

export function QueueStatusBadge({ status, className, label }: { status: QueueStatus; className?: string; label?: string }) {
  const item = config[status]
  const Icon = item.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
        item.className,
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label ?? item.label}
    </span>
  )
}
