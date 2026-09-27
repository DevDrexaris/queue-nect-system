import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Card, CardContent } from '../../components/ui/card'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { buttonVariants } from '../../components/ui/button'
import { formatElapsedMinutes } from '../../lib/format'
import { cn } from '../../lib/utils'
import { useStudentQueueRealtime } from '../../hooks/use-student-presence'
import type { QueueEntry } from '../../types'

export function QueueSuccessPage() {
  const { clinicId = '' } = useParams()
  const location = useLocation()
  const entry = (location.state as { entry?: QueueEntry } | null)?.entry
  useStudentQueueRealtime(() => undefined)

  if (!entry) return <Navigate to={`/queue/${clinicId}`} replace />

  const isCompleted = entry.status === 'COMPLETED' || entry.status === 'SERVED'

  return (
    <div className="space-y-6 text-center">
      <div>
        <p className="text-sm font-medium tracking-wide text-accent uppercase">You are in the queue</p>
        <h1 className="mt-3 text-sm font-medium text-muted-foreground">Your queue number</h1>
        <div className="mt-2">
          <QueueNumber value={entry.queueNumber} size="lg" />
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 text-left">
          <div>
            <p className="text-xs text-muted-foreground uppercase">People ahead</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{entry.peopleAhead ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">{isCompleted ? 'Time spent' : 'Waiting time'}</p>
            <p className="mt-1 text-2xl font-semibold">
              {isCompleted ? formatElapsedMinutes(entry.joinedAt, entry.servedAt ?? undefined) : formatElapsedMinutes(entry.joinedAt)}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground uppercase">Status</p>
            <div className="mt-2">
              <QueueStatusBadge status={entry.status} />
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">Please keep this page open.</p>
      <Link to="/queue/status" className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full')}>
        View queue status
      </Link>
    </div>
  )
}
