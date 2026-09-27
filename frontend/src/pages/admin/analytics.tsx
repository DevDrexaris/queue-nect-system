import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { PageHeader } from '../../components/ui/page-header'
import { SimpleBarChart } from '../../components/ui/simple-bar-chart'
import { StatCard } from '../../components/ui/stat-card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { useAuth } from '../../hooks/use-auth'
import { useAdminRealtimeContext } from '../../hooks/use-admin-realtime-context'
import { analyticsService } from '../../services/api'
import { formatWait } from '../../lib/format'

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type Analytics = {
  total: number
  completed: number
  cancelled: number
  noShow: number
  waiting: number
  serving: number
  awaitingReturn: number
  averageWaitMinutes: number | null
  averageServiceMinutes: number | null
  hourly: { label: string; value: number }[]
  daily: { label: string; value: number }[]
  purposes: { label: string; value: number; count: number; percent: number }[]
}

export function AdminAnalyticsPage() {
  const { user } = useAuth()
  const { queueRevision } = useAdminRealtimeContext()
  const clinicId = user?.clinic?.identifier
  const [fromDate, setFromDate] = useState(() => localDateValue(new Date()))
  const [toDate, setToDate] = useState(() => localDateValue(new Date()))
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!clinicId) {
      setData(null)
      setError('Clinic information is unavailable. Please sign in again.')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const summary = await analyticsService.summary(clinicId, fromDate, toDate)
      setData(summary)
      setError(null)
    } catch (caught) {
      console.error('[Queue-Nect] Analytics load failed:', caught)
      setError('Unable to load analytics. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [clinicId, fromDate, toDate])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (queueRevision > 0) void load()
  }, [queueRevision, load])

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Queue volume and service times for this clinic."
        actions={
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">From<input aria-label="Analytics start date" className="mt-1 block h-9 rounded-md border border-border bg-input px-2 text-sm text-foreground" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="text-xs text-muted-foreground">To<input aria-label="Analytics end date" className="mt-1 block h-9 rounded-md border border-border bg-input px-2 text-sm text-foreground" type="date" value={toDate} min={fromDate} max={localDateValue(new Date())} onChange={(event) => setToDate(event.target.value)} /></label>
          </div>
        }
      />
      {loading ? (
        <LoadingState label="Loading analytics..." />
      ) : error ? (
        <ErrorState title="Unable to load analytics." description={error} onRetry={() => void load()} />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total visitors" value={data.total} />
            <StatCard label="Completed" value={data.completed} />
            <StatCard label="Cancelled" value={data.cancelled} />
            <StatCard label="No show" value={data.noShow} />
            <StatCard label="Currently waiting" value={data.waiting} />
            <StatCard label="Currently serving" value={data.serving} />
            <StatCard label="Awaiting return" value={data.awaitingReturn ?? 0} />
            <StatCard label="Average waiting time" value={formatWait(data.averageWaitMinutes)} />
            <StatCard label="Average service time" value={formatWait(data.averageServiceMinutes)} />
          </div>
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Hourly traffic</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleBarChart data={data.hourly} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Daily traffic</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleBarChart data={data.daily} />
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Purpose distribution</CardTitle>
              </CardHeader>
              <CardContent>
                {data.purposes.length ? (
                  <div className="space-y-3">
                    {data.purposes.map((item) => (
                      <div key={item.label} className="grid grid-cols-[minmax(7rem,1fr)_3fr_auto] items-center gap-3 text-sm">
                        <span className="truncate" title={item.label}>{item.label}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, item.percent)}%` }} /></div>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{item.count} · {item.percent}%</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="py-10 text-center text-sm text-muted-foreground">No visit purposes in this date range.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
