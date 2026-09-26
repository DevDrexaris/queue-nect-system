import { AlertTriangle, Bell, CheckCircle2, CircleDashed, LoaderCircle, XCircle } from 'lucide-react'
import type { QueueStatus } from '../../types'
import { cn } from '../../lib/utils'

const config: Record<
  QueueStatus,
  { label: string; className: string; icon: typeof Bell }
> = {
  WAITING: {
    label: 'Waiting',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    icon: CircleDashed,
  },
  CALLED: {
    label: 'Called',
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    icon: Bell,
  },
  SERVING: {
    label: 'Serving',
    className: 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
    icon: LoaderCircle,
  },
  SERVED: {
    label: 'Served',
    className: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    icon: XCircle,
  },
  NO_SHOW: {
    label: 'No show',
    className: 'bg-orange-50 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
    icon: AlertTriangle,
  },
}

export function QueueStatusBadge({ status, className }: { status: QueueStatus; className?: string }) {
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
      {item.label}
    </span>
  )
}
