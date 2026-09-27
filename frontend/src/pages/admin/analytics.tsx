import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { PageHeader } from '../../components/ui/page-header'
import { SimpleBarChart } from '../../components/ui/simple-bar-chart'
import { StatCard } from '../../components/ui/stat-card'
import { ErrorState, LoadingState } from '../../components/ui/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../../hooks/use-auth'
import { usePolling } from '../../hooks/use-polling'
import { analyticsService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { formatWait } from '../../lib/format'

const ranges = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
] as const

type Range = (typeof ranges)[number]['id']

type Analytics = {
  total: number
  completed: number
  cancelled: number
  noShow: number
  averageWaitMinutes: number | null
  averageServiceMinutes: number | null
  hourly: { label: string; value: number }[]
  daily: { label: string; value: number }[]
  purposes: { label: string; value: number }[]
}

export function AdminAnalyticsPage() {
  const { user } = useAuth()
  const clinicId = user?.clinic?.identifier
  const [range, setRange] = useState<Range>('today')
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
      const summary = await analyticsService.summary(range, clinicId)
      setData(summary)
      setError(null)
    } catch (caught) {
      setData(null)
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [clinicId, range])

  useEffect(() => {
    void load()
  }, [load])

  usePolling(() => {
    void load()
  }, 5000, Boolean(clinicId))

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Queue volume and service times for this clinic."
        actions={
          <div className="flex rounded-lg border border-border p-1">
            {ranges.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={range === item.id ? 'default' : 'ghost'}
                onClick={() => setRange(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        }
      />
      {loading ? (
        <LoadingState label="Loading analytics..." />
      ) : error ? (
        <ErrorState title="Unable to load analytics." description={error} onRetry={() => void load()} />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Total queue requests" value={data.total} />
            <StatCard label="Completed" value={data.completed} />
            <StatCard label="Cancelled" value={data.cancelled} />
            <StatCard label="No show" value={data.noShow} />
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
                <SimpleBarChart data={data.purposes} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}
