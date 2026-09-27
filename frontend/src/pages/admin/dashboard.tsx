import { useMemo, useState } from 'react'
import { CheckCircle2, Clock3, ListOrdered, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { PageHeader } from '../../components/ui/page-header'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { StatCard } from '../../components/ui/stat-card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { ActionItem, ActionMenu } from '../../components/ui/action-menu'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { useAuth } from '../../hooks/use-auth'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { greetingForNow, formatRelative } from '../../lib/format'
import { userMessage } from '../../lib/api'
import { queueService } from '../../services/api'
import type { QueueEntry } from '../../types'

export function AdminDashboardPage() {
  const { user } = useAuth()
  const clinicId = user?.clinic?.identifier
  const { data, error, loading, reload } = useQueueSnapshot(clinicId, 8000)
  const [calling, setCalling] = useState(false)

  const today = data?.entries ?? []

  async function callNext() {
    if (!clinicId) return
    setCalling(true)
    try {
      const entry = await queueService.callNext(clinicId)
      toast.success(`Calling ${entry.queueNumber}`)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setCalling(false)
    }
  }

  async function serveNext() {
    if (!clinicId) return
    setCalling(true)
    try {
      const entry = await queueService.serveNext(clinicId)
      toast.success(`Now serving ${entry.queueNumber}`)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setCalling(false)
    }
  }

  async function act(entry: QueueEntry, action: 'serve' | 'skip' | 'cancel' | 'recall') {
    try {
      await queueService.updateStatus(entry.id, action)
      toast.success(`Updated ${entry.queueNumber}`)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  const serving = data?.nowServing
  const upNext = data?.upNext ?? []

  const stats = useMemo(
    () => [
      { label: "Today's Queue", value: data?.todayCount ?? 0, icon: ListOrdered },
      { label: 'Waiting', value: data?.waitingCount ?? 0, icon: Clock3 },
      { label: 'Serving', value: data?.servingCount ?? 0, icon: UserRound },
      { label: 'Completed', value: data?.completedCount ?? 0, icon: CheckCircle2 },
    ],
    [data],
  )

  if (!clinicId) {
    return <ErrorState title="No clinic assigned." description="This administrator is not linked to a clinic." />
  }
  if (loading) return <LoadingState label="Loading dashboard..." />
  if (error && !data) return <ErrorState title="Unable to load queue." description={error} onRetry={() => void reload()} />

  return (
    <div>
      <PageHeader
        title={`${greetingForNow()}, ${user?.name || 'Admin'}`}
        description={user?.clinic?.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void callNext()} loading={calling}>
              {calling ? 'Calling...' : 'Call next'}
            </Button>
            <Button variant="outline" onClick={() => void serveNext()} loading={calling}>
              Serve next
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Currently serving</CardTitle>
          </CardHeader>
          <CardContent>
            {serving ? (
              <div>
                <QueueNumber value={serving.queueNumber} size="lg" />
                <p className="mt-2 text-sm font-medium">{serving.studentName}</p>
                <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => void act(serving, 'serve')}>Finish service</Button>
                  <Button variant="outline" onClick={() => void act(serving, 'skip')}>
                    Skip
                  </Button>
                  <Button variant="ghost" onClick={() => void act(serving, 'recall')}>
                    Set waiting
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState title="No student is currently being served." description="Call the next person when you are ready." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Up next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upNext.length ? (
              upNext.slice(0, 3).map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <QueueNumber value={item.queueNumber} size="sm" />
                  <span className="text-sm text-muted-foreground">{item.purpose}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No one is waiting.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Today's queue</CardTitle>
        </CardHeader>
        <CardContent>
          {today.length === 0 ? (
            <EmptyState title="No queue requests yet." description="Students will appear here after they join." />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Queue</TH>
                      <TH>Student</TH>
                      <TH>Purpose</TH>
                      <TH>Joined</TH>
                      <TH>Status</TH>
                      <TH>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {today.map((item) => (
                      <TR key={item.id}>
                        <TD>
                          <QueueNumber value={item.queueNumber} size="sm" />
                        </TD>
                        <TD>{item.studentName}</TD>
                        <TD>{item.purpose}</TD>
                        <TD>{formatRelative(item.joinedAt)}</TD>
                        <TD>
                          <QueueStatusBadge status={item.status} />
                        </TD>
                        <TD>
                          <ActionMenu>
                            <ActionItem onClick={() => void queueService.updateStatus(item.id, 'call').then(reload)}>Call</ActionItem>
                            <ActionItem onClick={() => void act(item, 'serve')}>Serve</ActionItem>
                            <ActionItem onClick={() => void act(item, 'skip')}>Skip</ActionItem>
                            <ActionItem destructive onClick={() => void act(item, 'cancel')}>
                              Cancel
                            </ActionItem>
                          </ActionMenu>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <div className="space-y-3 md:hidden">
                {today.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <QueueNumber value={item.queueNumber} size="sm" />
                      <QueueStatusBadge status={item.status} />
                    </div>
                    <p className="mt-2 text-sm font-medium">{item.studentName}</p>
                    <p className="text-sm text-muted-foreground">{item.purpose}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
