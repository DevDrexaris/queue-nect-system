import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { PageHeader } from '../../components/ui/page-header'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { QueuePresenceBadge } from '../../components/ui/queue-presence-badge'
import { SearchInput } from '../../components/ui/search-input'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { ActionItem, ActionMenu } from '../../components/ui/action-menu'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { useAuth } from '../../hooks/use-auth'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { useAdminRealtimeContext } from '../../hooks/use-admin-realtime-context'
import { formatTime, formatWait } from '../../lib/format'
import { userMessage } from '../../lib/api'
import { queueService } from '../../services/api'
import { QUEUE_STATUSES, formatQueueStatusLabel, type QueueEntry, type QueueStatus } from '../../types'

export function AdminQueuePage() {
  const { user } = useAuth()
  const clinicId = user?.clinic?.identifier
  const { data, error, loading, reload } = useQueueSnapshot(clinicId, 8000)
  const realtime = useAdminRealtimeContext()
  const presenceById = new Map(realtime.presence.map((item) => [item.queue_entry_id, item]))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [pending, setPending] = useState<QueueEntry | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [resetConfirmed, setResetConfirmed] = useState(false)
  const [calling, setCalling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const entries = (data?.entries ?? []).filter((item) => {
    const matchesQuery = `${item.queueNumber} ${item.studentName} ${item.studentId}`.toLowerCase().includes(query.toLowerCase())
    const matchesStatus = status === 'all' || item.status === status
    return matchesQuery && matchesStatus
  })

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

  async function run(action: 'call' | 'serve' | 'complete' | 'skip' | 'cancel', entry: QueueEntry) {
    try {
      await queueService.updateStatus(entry.id, action)
      toast.success(`Updated ${entry.queueNumber}`)
      setPending(null)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  async function resetQueue() {
    if (!clinicId) return
    setResetting(true)
    try {
      await queueService.resetQueue(clinicId)
      toast.success('Active entries cancelled; queue numbers remain reserved.')
      setResetPending(false)
      setResetConfirmed(false)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setResetting(false)
    }
  }

  async function refreshQueue() {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  if (!clinicId) return <ErrorState title="No clinic assigned." />
  if (loading) return <LoadingState label="Loading queue..." />
  if (error && !data) return <ErrorState title="Unable to load queue." description={error} onRetry={() => void reload()} />

  const serving = data?.nowServing
  const calledEntry = data?.entries.find((item) => item.status === 'CALLED') ?? null

  return (
    <div>
      <PageHeader
        title="Queue Management"
        description="Call, serve, skip, or cancel students in the live queue."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" onClick={() => void callNext()} loading={calling}>
              {calling ? 'Calling...' : 'Call next'}
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className={calledEntry ? 'border-status-calling/45 bg-status-calling/10 text-status-calling' : ''}
                onClick={() => void serveNext()}
                loading={calling}
              >
                Serve next
              </Button>
              {calledEntry ? (
                <div className="pointer-events-none absolute -top-5 right-0 z-10 inline-flex items-center gap-1 rounded-full border border-status-calling/25 bg-status-calling/10 px-1.5 py-0.5 text-[8px] font-medium tracking-[0.12em] text-status-calling animate-[queue-call-toast_220ms_ease-out]">
                  <span className="size-1.5 animate-pulse rounded-full bg-status-calling" />
                  CALLING
                </div>
              ) : null}
            </div>
            <Button size="sm" variant="destructive" onClick={() => setResetPending(true)} loading={resetting}>
              {resetting ? 'Cancelling...' : 'Cancel active'}
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Currently serving</CardTitle>
        </CardHeader>
        <CardContent>
          {serving ? (
            <div
              className={[
                'relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-colors duration-300 sm:p-5',
                serving.status === 'CALLED'
                  ? 'border-status-calling/45 bg-status-calling/10'
                  : '',
                serving.status === 'SERVING'
                  ? 'border-status-serving/40 bg-status-serving/10'
                  : '',
              ].join(' ')}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <QueueNumber
                  value={serving.queueNumber}
                  size="lg"
                  className={serving.status === 'CALLED' ? 'queue-number-calling' : 'text-status-serving'}
                />
                <p className="mt-2 font-medium">{serving.studentName}</p>
                <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">Started: {formatTime(serving.calledAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {serving.status === 'SERVING' ? <Button onClick={() => void run('complete', serving)}>Finish service</Button> : null}
                {serving.status === 'CALLED' ? <Button variant="outline" onClick={() => void run('skip', serving)}>Mark no-show</Button> : null}
              </div>
              </div>
            </div>
          ) : (
            <EmptyState title="No student is currently being served." />
          )}
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchInput
          placeholder="Search by name, ID, or queue number"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search queue"
          className="md:max-w-sm md:flex-1"
        />
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="md:w-48">
          <option value="all">All statuses</option>
          {QUEUE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {formatQueueStatusLabel(item)}
            </option>
          ))}
        </Select>
        <Button variant="outline" onClick={() => void refreshQueue()} loading={refreshing}>
          <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="No queue requests yet." description="Try another filter or wait for a student to join." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Queue #</TH>
                  <TH>Student</TH>
                  <TH>Purpose</TH>
                  <TH>Time joined</TH>
                  <TH>Waited</TH>
                  <TH>Status</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {entries.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <QueueNumber value={item.queueNumber} size="sm" className={item.status === 'CALLED' ? 'queue-number-calling' : undefined} />
                    </TD>
                    <TD>
                      <p className="font-medium">{item.studentName}</p>
                      <p className="text-xs text-muted-foreground">{item.studentId}</p>
                    </TD>
                    <TD>{item.purpose}</TD>
                    <TD>{formatTime(item.joinedAt)}</TD>
                    <TD>{formatWait(item.estimatedWaitMinutes)}</TD>
                    <TD>
                      <QueueStatusBadge status={item.status as QueueStatus} />
                      <div className="mt-1"><QueuePresenceBadge presence={presenceById.get(item.id)} now={realtime.now} /></div>
                    </TD>
                    <TD>
                      <ActionMenu label="Manage">
                        {item.status === 'WAITING' ? (
                          <ActionItem onClick={() => void run('call', item)}>Call</ActionItem>
                        ) : null}
                        {item.status === 'CALLED' ? <ActionItem onClick={() => void run('serve', item)}>Start service</ActionItem> : null}
                        {item.status === 'SERVING' ? <ActionItem onClick={() => void run('complete', item)}>Complete service</ActionItem> : null}
                        {['WAITING', 'CALLED'].includes(item.status) ? <ActionItem onClick={() => void run('skip', item)}>Mark no-show</ActionItem> : null}
                        {['WAITING', 'CALLED', 'SERVING'].includes(item.status) ? (
                          <ActionItem destructive onClick={() => setPending(item)}>Cancel</ActionItem>
                        ) : null}
                      </ActionMenu>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="space-y-3 md:hidden">
            {entries.map((item) => (
              <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <QueueNumber value={item.queueNumber} size="sm" className={item.status === 'CALLED' ? 'queue-number-calling' : undefined} />
                  <ActionMenu label="Manage">
                    {item.status === 'WAITING' ? (
                      <ActionItem onClick={() => void run('call', item)}>Call</ActionItem>
                    ) : null}
                    {item.status === 'CALLED' ? <ActionItem onClick={() => void run('serve', item)}>Start service</ActionItem> : null}
                    {item.status === 'SERVING' ? <ActionItem onClick={() => void run('complete', item)}>Complete service</ActionItem> : null}
                    {['WAITING', 'CALLED'].includes(item.status) ? <ActionItem onClick={() => void run('skip', item)}>Mark no-show</ActionItem> : null}
                    {['WAITING', 'CALLED', 'SERVING'].includes(item.status) ? (
                      <ActionItem destructive onClick={() => setPending(item)}>Cancel</ActionItem>
                    ) : null}
                  </ActionMenu>
                </div>
                <p className="mt-2 font-medium">{item.studentName}</p>
                <p className="text-sm text-muted-foreground">{item.purpose}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <QueueStatusBadge status={item.status} />
                  <span className="text-xs text-muted-foreground">Waited {formatWait(item.estimatedWaitMinutes)}</span>
                </div>
                <div className="mt-2"><QueuePresenceBadge presence={presenceById.get(item.id)} now={realtime.now} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="Cancel this queue?"
        description={
          pending
            ? `${pending.queueNumber} will be cancelled and retained in queue history. It cannot be restored.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => pending && void run('cancel', pending)}>
              Confirm
            </Button>
          </>
        }
      />

      <Dialog
        open={resetPending}
        onClose={() => {
          setResetPending(false)
          setResetConfirmed(false)
        }}
        title="Cancel all active entries?"
        description="Waiting and called entries will be cancelled and retained in queue history. Queue numbers will not be reused. New students may still join this session."
        footer={
          <>
            <Button variant="outline" onClick={() => { setResetPending(false); setResetConfirmed(false) }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!resetConfirmed || resetting}
              onClick={() => void resetQueue()}
            >
              {resetting ? 'Cancelling...' : 'Cancel active entries'}
            </Button>
          </>
        }
      >
        <label className="mt-2 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={resetConfirmed}
            onChange={(event) => setResetConfirmed(event.target.checked)}
            className="mt-1 size-4"
          />
          <span>
            I understand active entries will be cancelled and queue numbers will remain reserved.
          </span>
        </label>
      </Dialog>
    </div>
  )
}
