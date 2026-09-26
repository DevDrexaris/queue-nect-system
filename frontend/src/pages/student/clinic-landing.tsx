import { Link, useParams } from 'react-router-dom'
import { Ticket } from 'lucide-react'
import { buttonVariants } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import { Card, CardContent } from '../../components/ui/card'
import { QueueNumber } from '../../components/ui/queue-number'
import { Skeleton } from '../../components/ui/states'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'

export function ClinicLandingPage() {
  const { clinicId = '' } = useParams()
  const { data, error, loading, reload } = useQueueSnapshot(clinicId, 8000)
  const clinicName = data?.clinic.name || clinicId.replace(/-/g, ' ')

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Welcome to</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight capitalize">{clinicName}</h1>
        <p className="mt-1 text-muted-foreground">Digital Queue</p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Current queue</p>
            <div className="mt-2">
              {loading ? (
                <Skeleton className="h-9 w-24" />
              ) : data?.entries[0]?.queueNumber ? (
                <QueueNumber value={data.entries[0].queueNumber} size="md" />
              ) : (
                <p className="text-lg font-medium text-muted-foreground">None</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Currently serving</p>
            <div className="mt-2">
              {loading ? (
                <Skeleton className="h-9 w-24" />
              ) : data?.nowServing ? (
                <QueueNumber value={data.nowServing.queueNumber} size="md" />
              ) : (
                <p className="text-lg font-medium text-muted-foreground">None</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-muted-foreground">
          Live numbers are unavailable.{' '}
          <button type="button" className="font-medium text-accent underline" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : null}

      <div className="space-y-3">
        <Link to={`/queue/${clinicId}/join`} className={cn(buttonVariants({ size: 'lg' }), 'h-12 w-full')}>
          Join queue
        </Link>
        <Link to="/queue/status" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-12 w-full')}>
          Check my queue
        </Link>
      </div>
      <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <Ticket className="size-3.5" />
        Keep this page handy after you join. No app download required.
      </p>
    </div>
  )
}
