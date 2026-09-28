import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { PageHeader } from '../../components/ui/page-header'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { QueuePresenceBadge } from '../../components/ui/queue-presence-badge'
import { QueueActionDialog, type ConfirmedQueueAction } from '../../components/ui/queue-action-dialog'
import { SearchInput } from '../../components/ui/search-input'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { ActionItem, ActionMenu } from '../../components/ui/action-menu'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { useAuth } from '../../hooks/use-auth'
import { useAdminQueueScope } from '../../hooks/use-admin-queue-scope'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { useAdminRealtimeContext } from '../../hooks/use-admin-realtime-context'
import { formatTime, formatWait } from '../../lib/format'
import { userMessage } from '../../lib/api'
import { queueService } from '../../services/api'
import { queueSessionLabel, queueSessionVariant } from '../../lib/queue-session'
import { QUEUE_STATUSES, formatQueueStatusLabel, type QueueEntry, type QueueStatus } from '../../types'

export function AdminQueuePage() {
  const { user } = useAuth()
  const { selectedQueueId } = useAdminQueueScope()
  const clinicId = user?.clinic?.identifier
  const { data, error, loading, reload } = useQueueSnapshot(clinicId, 8000, selectedQueueId)
  const realtime = useAdminRealtimeContext()
  const presenceById = new Map(realtime.presence.map((item) => [item.queue_entry_id, item]))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [pending, setPending] = useState<QueueEntry | null>(null)
  const [pendingAction, setPendingAction] = useState<ConfirmedQueueAction | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetPending, setResetPending] = useState(false)
  const [resetConfirmed, setResetConfirmed] = useState(false)
  const [calling, setCalling] = useState(false)
  const [sessionStarting, setSessionStarting] = useState(false)
  const [sessionEnding, setSessionEnding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const entries = (data?.entries ?? []).filter((item) => {
    const matchesQuery = `${item.queueNumber} ${item.studentName} ${item.studentId}`.toLowerCase().includes(query.toLowerCase())
    const matchesStatus = status === 'all' || item.status === status
    return matchesQuery && matchesStatus
  })

  async function callNext() {
    if (!clinicId || !selectedQueueId) return
    setCalling(true)
    try {
      const entry = await queueService.callNext(clinicId, selectedQueueId)
      toast.success(`Calling ${entry.queueNumber}`)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setCalling(false)
    }
  }

  async function serveNext() {
    if (!clinicId || !selectedQueueId) return
    setCalling(true)
    try {
      const entry = await queueService.serveNext(clinicId, selectedQueueId)
      toast.success(`Now serving ${entry.queueNumber}`)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setCalling(false)
    }
  }

  async function run(action: 'call' | 'serve' | 'complete' | 'skip' | 'cancel' | 'return_to_waiting' | 'awaiting_return' | 'call_again' | 'delete', entry: QueueEntry) {
    try {
      if (action === 'delete') {
        await queueService.deleteEntry(clinicId ?? entry.clinicId, entry.id)
        toast.success(`Deleted ${entry.queueNumber}.`)
      } else {
        await queueService.updateStatus(entry.id, action)
        const label = action === 'call_again' ? 'called again' : action === 'awaiting_return' ? 'placed on hold awaiting return' : action === 'return_to_waiting' ? 'returned to waiting' : action === 'complete' ? 'completed' : action === 'call' ? 'called' : action === 'serve' ? 'served' : action === 'cancel' ? 'cancelled' : 'marked no-show'
        toast.success(`${entry.queueNumber} ${label}.`)
      }
      setPending(null)
      setPendingAction(null)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  function confirmQueueAction(entry: QueueEntry, action: ConfirmedQueueAction) {
    void run(action, entry)
  }

  function requestQueueAction(entry: QueueEntry, action: ConfirmedQueueAction) {
    setPending(entry)
    setPendingAction(action)
  }

  async function resetQueue() {
    if (!clinicId || !selectedQueueId) return
    setResetting(true)
    try {
      await queueService.resetQueue(clinicId, selectedQueueId)
      toast.success(`Queue number reset for today's ${data?.clinic.queuePrefix ?? 'queue'} session.`)
      setResetPending(false)
      setResetConfirmed(false)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setResetting(false)
    }
  }

  async function startSession() {
    if (!selectedQueueId) return
    setSessionStarting(true)
    try {
      const result = await queueService.startSession(selectedQueueId)
      toast.success(result.resumed ? "Today's queue session resumed." : "Today's queue session started.")
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSessionStarting(false)
    }
  }

  async function endSession() {
    if (!selectedQueueId) return
    setSessionEnding(true)
    try {
      const result = await queueService.endSession(selectedQueueId)
      toast.success(result.ended ? "Today's queue session ended." : "Today's queue session was already inactive.")
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSessionEnding(false)
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
  const sessionStatus = data?.clinic.sessionStatus ?? 'UNKNOWN'

  function renderQueueActions(item: QueueEntry) {
    return (
      <ActionMenu label="Manage">
        {item.status === 'WAITING' ? (
          <>
            <ActionItem onClick={() => void run('call', item)}>Call</ActionItem>
            <ActionItem onClick={() => requestQueueAction(item, 'cancel')}>Cancel</ActionItem>
            <ActionItem onClick={() => requestQueueAction(item, 'skip')}>Mark No-show</ActionItem>
          </>
        ) : null}
        {item.status === 'CALLED' ? (
          <>
            <ActionItem onClick={() => void run('serve', item)}>Serve</ActionItem>
            <ActionItem onClick={() => void run('return_to_waiting', item)}>Return to Waiting</ActionItem>
            <ActionItem onClick={() => requestQueueAction(item, 'cancel')}>Cancel</ActionItem>
            <ActionItem onClick={() => requestQueueAction(item, 'skip')}>Mark No-show</ActionItem>
          </>
        ) : null}
        {item.status === 'SERVING' ? (
          <>
            <ActionItem onClick={() => requestQueueAction(item, 'awaiting_return')}>Awaiting Return</ActionItem>
            <ActionItem onClick={() => void run('complete', item)}>Finish Service</ActionItem>
            <ActionItem onClick={() => requestQueueAction(item, 'cancel')}>Cancel</ActionItem>
          </>
        ) : null}
        {item.status === 'AWAITING_RETURN' ? (
          <ActionItem onClick={() => void run('call_again', item)}>Call Again</ActionItem>
        ) : null}
        {['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(item.status) ? (
          <ActionItem destructive onClick={() => requestQueueAction(item, 'delete')}>Delete</ActionItem>
        ) : null}
      </ActionMenu>
    )
  }

  return (
    <div>
      <PageHeader
        title="Queue Management"
        description="Call, serve, skip, or cancel students in the live queue."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" onClick={() => void callNext()} loading={calling} disabled={sessionStatus !== 'ACTIVE'}>
              {calling ? 'Calling...' : 'Call next'}
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className={calledEntry ? 'border-status-calling/45 bg-status-calling/10 text-status-calling' : ''}
                onClick={() => void serveNext()}
                loading={calling}
                disabled={sessionStatus !== 'ACTIVE'}
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
            <Button size="sm" variant="outline" onClick={() => setResetPending(true)} loading={resetting} disabled={sessionStatus !== 'ACTIVE'}>
              {resetting ? 'Resetting...' : 'Reset Queue Number'}
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Today's session</span>
            <Badge variant={queueSessionVariant(sessionStatus)}>{queueSessionLabel(sessionStatus)}</Badge>
            {sessionStatus === 'ACTIVE' && data?.clinic.sessionDate ? <span className="text-xs text-muted-foreground">{data.clinic.sessionDate}</span> : null}
            {sessionStatus === 'NOT_STARTED' ? <span className="text-sm text-muted-foreground">Start a session before resetting or serving this queue.</span> : null}
          </div>
          {(sessionStatus === 'NOT_STARTED' || sessionStatus === 'ENDED') && data?.clinic.availability !== 'CLOSED' ? (
            <Button onClick={() => void startSession()} loading={sessionStarting} disabled={!selectedQueueId}>
              {sessionStatus === 'ENDED' ? "Resume Today's Session" : "Start Today's Session"}
            </Button>
          ) : null}
          {selectedQueueId ? (
            <Button variant="outline" onClick={() => void endSession()} loading={sessionEnding} disabled={!selectedQueueId}>
              End Today's Session
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{serving?.status === 'CALLED' ? 'Currently called' : 'Currently serving'}</CardTitle>
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
                serving.status === 'AWAITING_RETURN'
                  ? 'border-amber-500/35 bg-amber-500/10'
                  : '',
              ].join(' ')}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <QueueNumber
                    value={serving.queueNumber}
                    size="lg"
                    className={serving.status === 'CALLED' ? 'queue-number-calling' : serving.status === 'AWAITING_RETURN' ? 'text-amber-500' : 'text-status-serving'}
                  />
                  <p className="mt-2 font-medium">{serving.studentName}</p>
                  <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {serving.status === 'AWAITING_RETURN' ? 'Awaiting return' : 'Started: ' + formatTime(serving.calledAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {serving.status === 'CALLED' ? <Button onClick={() => void run('serve', serving)}>Serve</Button> : null}
                  {serving.status === 'CALLED' ? <Button variant="outline" onClick={() => void run('return_to_waiting', serving)}>Return to Waiting</Button> : null}
                  {serving.status === 'SERVING' ? <Button variant="outline" onClick={() => requestQueueAction(serving, 'awaiting_return')}>Awaiting Return</Button> : null}
                  {serving.status === 'SERVING' ? <Button onClick={() => void run('complete', serving)}>Finish Service</Button> : null}
                  {serving.status === 'AWAITING_RETURN' ? <Button onClick={() => void run('call_again', serving)}>Call Again</Button> : null}
                  {['CALLED', 'SERVING'].includes(serving.status) ? <Button variant="outline" onClick={() => requestQueueAction(serving, 'cancel')}>Cancel</Button> : null}
                  {['WAITING', 'CALLED'].includes(serving.status) ? <Button variant="outline" onClick={() => requestQueueAction(serving, 'skip')}>Mark as no-show</Button> : null}
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
                      <div className="flex flex-wrap gap-2">
                        {renderQueueActions(item)}
                      </div>
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
                  <div className="flex flex-wrap justify-end gap-2">
                    {renderQueueActions(item)}
                  </div>
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

      <QueueActionDialog
        entry={pending}
        action={pendingAction}
        busy={calling}
        onClose={() => { setPending(null); setPendingAction(null) }}
        onConfirm={confirmQueueAction}
      />

      <Dialog
        open={resetPending}
        onClose={() => {
          setResetPending(false)
          setResetConfirmed(false)
        }}
        title="Reset queue number?"
        description={`This resets the next queue number to ${data?.clinic.queuePrefix ?? 'A'}001 for the active session. Existing queue history will remain unchanged.`}
        footer={
          <>
            <Button variant="outline" onClick={() => { setResetPending(false); setResetConfirmed(false) }}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={!resetConfirmed || resetting}
              onClick={() => void resetQueue()}
            >
              {resetting ? 'Resetting...' : 'Reset Queue'}
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
            I understand this only resets the current session number sequence; it does not delete history or analytics.
          </span>
        </label>
      </Dialog>
    </div>
  )
}
