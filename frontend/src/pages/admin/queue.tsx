import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
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
  const [resetting, setResetting] = useState(false)
  const [calling, setCalling] = useState(false)

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
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    } finally {
      setResetting(false)
    }
  }

  if (!clinicId) return <ErrorState title="No clinic assigned." />
  if (loading) return <LoadingState label="Loading queue..." />
  if (error && !data) return <ErrorState title="Unable to load queue." description={error} onRetry={() => void reload()} />

  const serving = data?.nowServing

  return (
    <div>
      <PageHeader
        title="Queue Management"
        description="Call, serve, skip, or cancel students in the live queue."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void callNext()} loading={calling}>
              {calling ? 'Calling...' : 'Call next'}
            </Button>
            <Button variant="outline" onClick={() => void serveNext()} loading={calling}>
              Serve next
            </Button>
            <Button variant="destructive" onClick={() => void resetQueue()} loading={resetting}>
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <QueueNumber value={serving.queueNumber} size="lg" />
                <p className="mt-2 font-medium">{serving.studentName}</p>
                <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                <p className="mt-1 text-xs text-muted-foreground">Started: {formatTime(serving.calledAt)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void run('serve', serving)}>Finish service</Button>
                <Button variant="outline" onClick={() => void run('skip', serving)}>
                  Skip
                </Button>
                <Button variant="ghost" onClick={() => void run('recall', serving)}>
                  Set waiting
                </Button>
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
        <Button variant="outline" onClick={() => void reload()}>
          <RefreshCw className="size-4" />
          Refresh
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
                      <ActionMenu>
                        <ActionItem onClick={() => void run('call', item)}>Call</ActionItem>
                        <ActionItem onClick={() => void run('serve', item)}>Serve</ActionItem>
                        <ActionItem onClick={() => void run('recall', item)}>Set waiting</ActionItem>
                        <ActionItem onClick={() => void run('skip', item)}>Skip</ActionItem>
                        <ActionItem destructive onClick={() => setPending(item)}>
                          Cancel
                        </ActionItem>
                        <ActionItem
                          destructive
                          disabled={['WAITING', 'CALLED', 'SERVING'].includes(item.status)}
                          onClick={() => void removeQueueEntry(item)}
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
                  <ActionMenu>
                    <ActionItem onClick={() => void run('call', item)}>Call</ActionItem>
                    <ActionItem onClick={() => void run('serve', item)}>Serve</ActionItem>
                    <ActionItem onClick={() => void run('recall', item)}>Set waiting</ActionItem>
                    <ActionItem onClick={() => void run('skip', item)}>Skip</ActionItem>
                    <ActionItem destructive onClick={() => setPending(item)}>
                      Cancel
                    </ActionItem>
                    <ActionItem
                      destructive
                      disabled={['WAITING', 'CALLED', 'SERVING'].includes(item.status)}
                      onClick={() => void removeQueueEntry(item)}
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
    </div>
  )
}
