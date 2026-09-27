import { useState } from 'react'
import { Lock, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { PageHeader } from '../../components/ui/page-header'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { SearchInput } from '../../components/ui/search-input'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { ActionItem, ActionMenu } from '../../components/ui/action-menu'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { useAuth } from '../../hooks/use-auth'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { formatTime, formatWait } from '../../lib/format'
import { userMessage } from '../../lib/api'
import { queueService } from '../../services/api'
import { QUEUE_STATUSES, formatQueueStatusLabel, type QueueEntry, type QueueStatus } from '../../types'

export function AdminQueuePage() {
  const { user } = useAuth()
  const clinicId = user?.clinic?.identifier
  const { data, error, loading, reload } = useQueueSnapshot(clinicId, 8000)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string>('all')
  const [pending, setPending] = useState<QueueEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<QueueEntry | null>(null)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
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

  async function run(action: 'call' | 'serve' | 'skip' | 'cancel' | 'recall', entry: QueueEntry) {
    try {
      await queueService.updateStatus(entry.id, action)
      toast.success(`Updated ${entry.queueNumber}`)
      setPending(null)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  async function removeQueueEntry(entry: QueueEntry) {
    try {
      await queueService.deleteEntry(entry.id)
      toast.success(`Deleted ${entry.queueNumber}`)
      setDeleteTarget(null)
      setDeleteConfirmed(false)
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
      toast.success('Queue reset to A001')
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
                variant={calledEntry ? 'default' : 'outline'}
                className={calledEntry ? 'border-emerald-500 bg-emerald-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.45)] ring-2 ring-emerald-300/70 animate-pulse' : ''}
                onClick={() => void serveNext()}
                loading={calling}
              >
                Serve next
              </Button>
              {calledEntry ? (
                <div className="pointer-events-none absolute -top-7 right-0 z-10 inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-emerald-300/80 bg-emerald-500/10 px-2 py-1 text-[9px] font-medium tracking-[0.12em] text-emerald-700 shadow-[0_4px_14px_rgba(16,185,129,0.18)] backdrop-blur-sm animate-[queue-call-toast_220ms_ease-out]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
                  SERVE NOW
                </div>
              ) : null}
            </div>
            <Button size="sm" variant="destructive" onClick={() => setResetPending(true)} loading={resetting}>
              {resetting ? 'Resetting...' : 'Reset queue'}
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
                'relative overflow-hidden rounded-xl border p-4 sm:p-5',
                serving.status === 'CALLED'
                  ? 'border-amber-400/80 [box-shadow:0_0_0_1px_rgba(251,146,60,0.36),0_0_22px_rgba(251,146,60,0.18)] animate-[queue-card-glow-amber_1.35s_ease-in-out_infinite]'
                  : '',
                serving.status === 'SERVING'
                  ? 'border-emerald-400/80 [box-shadow:0_0_0_1px_rgba(16,185,129,0.28),0_0_26px_rgba(16,185,129,0.16)] animate-[queue-card-glow-emerald_1.35s_ease-in-out_infinite]'
                  : '',
              ].join(' ')}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <QueueNumber
                  value={serving.queueNumber}
                  size="lg"
                  className="text-black drop-shadow-[1px_1px_0_rgba(255,255,255,0.8)]"
                />
                <p className="mt-2 font-medium">{serving.studentName}</p>
                <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">Started: {formatTime(serving.calledAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {serving.status === 'CALLED' ? (
                  <Button variant="outline" onClick={() => void run('recall', serving)}>
                    Stop calling
                  </Button>
                ) : null}
                <Button onClick={() => void run('serve', serving)}>Finish service</Button>
                <Button variant="outline" onClick={() => void run('skip', serving)}>
                  Skip
                </Button>
                <Button variant="ghost" onClick={() => void run('recall', serving)}>
                  Set waiting
                </Button>
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
                      <QueueNumber value={item.queueNumber} size="sm" />
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
                    </TD>
                    <TD>
                      <ActionMenu label="Manage">
                        {item.status === 'CALLED' ? (
                          <ActionItem onClick={() => void run('recall', item)}>Stop calling</ActionItem>
                        ) : null}
                        <ActionItem destructive onClick={() => setPending(item)}>
                          Cancel
                        </ActionItem>
                        <ActionItem
                          destructive
                          disabled={['WAITING', 'CALLED', 'SERVING'].includes(item.status)}
                          icon={<Lock className="size-4" />}
                          onClick={() => setDeleteTarget(item)}
                        >
                          Delete
                        </ActionItem>
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
                  <QueueNumber value={item.queueNumber} size="sm" />
                  <ActionMenu label="Manage">
                    {item.status === 'CALLED' ? (
                      <ActionItem onClick={() => void run('recall', item)}>Stop calling</ActionItem>
                    ) : null}
                    <ActionItem destructive onClick={() => setPending(item)}>
                      Cancel
                    </ActionItem>
                    <ActionItem
                      destructive
                      disabled={['WAITING', 'CALLED', 'SERVING'].includes(item.status)}
                      icon={<Lock className="size-4" />}
                      onClick={() => setDeleteTarget(item)}
                    >
                      Delete
                    </ActionItem>
                  </ActionMenu>
                </div>
                <p className="mt-2 font-medium">{item.studentName}</p>
                <p className="text-sm text-muted-foreground">{item.purpose}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <QueueStatusBadge status={item.status} />
                  <span className="text-xs text-muted-foreground">Waited {formatWait(item.estimatedWaitMinutes)}</span>
                </div>
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
            ? `${pending.queueNumber} will be removed from the active queue. This cannot be undone.`
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
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteConfirmed(false)
        }}
        title="Delete inactive queue number?"
        description={deleteTarget ? `This permanently removes ${deleteTarget.queueNumber} from the queue log. Only do this for numbers that are already cancelled, skipped, or otherwise no longer needed.` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmed(false) }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteConfirmed || !deleteTarget}
              onClick={() => deleteTarget && void removeQueueEntry(deleteTarget)}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <label className="mt-2 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={deleteConfirmed}
            onChange={(event) => setDeleteConfirmed(event.target.checked)}
            className="mt-1 size-4"
          />
          <span>
            I confirm this queue number is inactive and I want to permanently delete it from the session.
          </span>
        </label>
      </Dialog>

      <Dialog
        open={resetPending}
        onClose={() => {
          setResetPending(false)
          setResetConfirmed(false)
        }}
        title="Reset today’s queue?"
        description="This permanently clears all current queue entries for today and resets the counter back to A001. This should only be used when you are starting a fresh queue session or have finished the day’s queue and want to restart cleanly."
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
              {resetting ? 'Resetting...' : 'I understand, reset queue'}
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
            I confirm this is a fresh start for the queue and understand that all active queue entries for today will be cleared.
          </span>
        </label>
      </Dialog>
    </div>
  )
}
