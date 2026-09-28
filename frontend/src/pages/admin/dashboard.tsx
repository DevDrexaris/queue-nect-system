import { useMemo, useState } from 'react'
import { CheckCircle2, Clock3, ListOrdered, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { PageHeader } from '../../components/ui/page-header'
import { Dialog } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/field'
import { Select } from '../../components/ui/select'
import { QueueNumber } from '../../components/ui/queue-number'
import { QueueStatusBadge } from '../../components/ui/queue-status-badge'
import { QueueActionDialog, type ConfirmedQueueAction } from '../../components/ui/queue-action-dialog'
import { Badge } from '../../components/ui/badge'
import { StatCard } from '../../components/ui/stat-card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { ActionItem, ActionMenu } from '../../components/ui/action-menu'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { useAuth } from '../../hooks/use-auth'
import { useAdminQueueScope } from '../../hooks/use-admin-queue-scope'
import { useQueueSnapshot } from '../../hooks/use-queue-snapshot'
import { greetingForNow, formatRelative } from '../../lib/format'
import { userMessage } from '../../lib/api'
import { queueSessionLabel, queueSessionVariant } from '../../lib/queue-session'
import { queueService } from '../../services/api'
import type { QueueAvailability, QueueEntry } from '../../types'

export function AdminDashboardPage() {
  const { user } = useAuth()
  const { locations, queues, selectedQueueId, reloadQueueCatalog } = useAdminQueueScope()
  const clinicId = user?.clinic?.identifier
  const { data, error, loading, reload, updateAvailability } = useQueueSnapshot(clinicId, 8000, selectedQueueId)
  const [calling, setCalling] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ entry: QueueEntry; action: ConfirmedQueueAction } | null>(null)
  const [availabilityTarget, setAvailabilityTarget] = useState<Exclude<QueueAvailability, 'UNKNOWN'> | null>(null)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [sessionStarting, setSessionStarting] = useState(false)
  const [sessionEnding, setSessionEnding] = useState(false)
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [walkInQueueId, setWalkInQueueId] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [walkInReference, setWalkInReference] = useState('')
  const [walkInSaving, setWalkInSaving] = useState(false)
  const [walkInEntry, setWalkInEntry] = useState<QueueEntry | null>(null)

  const today = data?.entries ?? []

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

  async function startSession() {
    if (!selectedQueueId) return
    setSessionStarting(true)
    try {
      const result = await queueService.startSession(selectedQueueId)
      toast.success(result.resumed ? "Today's queue session resumed." : "Today's queue session started.")
      await Promise.all([reload(), reloadQueueCatalog()])
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
      await Promise.all([reload(), reloadQueueCatalog()])
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSessionEnding(false)
    }
  }

  async function registerWalkIn() {
    if (!walkInQueueId || !walkInName.trim()) return
    const targetQueue = queues.find((queue) => queue.id === walkInQueueId && queue.isActive)
    if (!targetQueue || targetQueue.admissionStatus !== 'OPEN' || targetQueue.sessionStatus !== 'ACTIVE') {
      toast.error(targetQueue?.sessionStatus !== 'ACTIVE'
        ? "Today's queue session has not started. Start it before accepting registrations."
        : 'The selected queue is not open for new registrations.')
      return
    }
    setWalkInSaving(true)
    try {
      const entry = await queueService.registerWalkInPatient(walkInQueueId, walkInName.trim(), walkInReference)
      setWalkInEntry(entry)
      setWalkInName('')
      setWalkInReference('')
      toast.success(`Walk-in registered as ${entry.queueNumber}.`)
      await reload()
    } catch (caught) {
      console.error('[Queue-Nect] Walk-in registration failed:', caught)
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setWalkInSaving(false)
    }
  }

  function walkInTicketText(entry: QueueEntry) {
    const targetQueue = queues.find((queue) => queue.id === entry.queueId)
    const targetLocation = locations.find((item) => item.id === targetQueue?.locationId)
    const queueLabel = `${targetLocation?.name ? `${targetLocation.name} · ` : ''}${targetQueue?.name || 'Queue'}`
    return `${user?.clinic?.name || 'Queue-Nect'}\n${queueLabel}\nQueue number: ${entry.queueNumber}\nPatient: ${entry.studentName || ''}\n${new Date(entry.joinedAt).toLocaleString()}`
  }

  function printWalkInTicket() {
    if (!walkInEntry) return
    const printWindow = window.open('', '_blank', 'width=380,height=500')
    if (!printWindow) {
      toast.error('Allow pop-ups to print the queue ticket.')
      return
    }
    const printDocument = printWindow.document
    printDocument.title = `Queue ticket ${walkInEntry.queueNumber}`
    const style = printDocument.createElement('style')
    style.textContent = 'body{font-family:Arial,sans-serif;text-align:center;padding:24px;color:#111}h1{font-size:15px}strong{display:block;font-size:48px;margin:24px 0}p{font-size:14px}small{color:#555}'
    const ticket = printDocument.createElement('main')
    const clinic = printDocument.createElement('h1')
    clinic.textContent = user?.clinic?.name || 'Queue-Nect'
    const number = printDocument.createElement('strong')
    number.textContent = walkInEntry.queueNumber
    const patient = printDocument.createElement('p')
    patient.textContent = walkInEntry.studentName || ''
    const details = printDocument.createElement('small')
    details.textContent = walkInTicketText(walkInEntry)
    ticket.append(clinic, number, patient, details)
    printDocument.body.replaceChildren(style, ticket)
    printWindow.focus()
    printWindow.print()
  }

  async function copyWalkInTicket() {
    if (!walkInEntry) return
    try {
      await navigator.clipboard.writeText(walkInTicketText(walkInEntry))
      toast.success('Queue ticket copied.')
    } catch (caught) {
      console.error('[Queue-Nect] Copy walk-in ticket failed:', caught)
      toast.error('Unable to copy the ticket on this device.')
    }
  }

  async function act(entry: QueueEntry, action: ConfirmedQueueAction | 'serve' | 'complete' | 'return_to_waiting' | 'awaiting_return' | 'call_again' | 'cancel' | 'skip') {
    try {
      if (action === 'delete') {
        await queueService.deleteEntry(clinicId ?? entry.clinicId, entry.id)
        toast.success(`Deleted ${entry.queueNumber}`)
      } else {
        await queueService.updateStatus(entry.id, action)
        toast.success(`Updated ${entry.queueNumber}`)
      }
      setPendingAction(null)
      await reload()
    } catch (caught) {
      toast.error(userMessage(caught))
    }
  }

  const serving = data?.nowServing
  const calledEntry = data?.entries.find((item) => item.status === 'CALLED') ?? null
  const upNext = data?.upNext ?? []
  const availability = data?.clinic.availability ?? 'UNKNOWN'
  const sessionStatus = data?.clinic.sessionStatus ?? 'UNKNOWN'

  async function confirmAvailabilityChange() {
    if (!selectedQueueId || !availabilityTarget) return
    setAvailabilitySaving(true)
    try {
      const persisted = await queueService.setAvailability(selectedQueueId, availabilityTarget)
      updateAvailability(persisted)
      const message = persisted === 'OPEN'
        ? 'Queue is open for new visitors.'
        : persisted === 'PAUSED'
          ? 'New registrations are paused.'
          : 'Queue is closed to new visitors.'
      toast.success(message)
      setAvailabilityTarget(null)
    } catch (caught) {
      console.error('[Queue-Nect] Queue availability update failed:', caught)
      toast.error(userMessage(caught, 'staff'))
      await reload()
    } finally {
      setAvailabilitySaving(false)
    }
  }

  const availabilityLabel = availability === 'UNKNOWN' ? 'Unavailable' : availability
  const availabilityVariant = availability === 'OPEN'
    ? 'success'
    : availability === 'PAUSED'
      ? 'warning'
      : availability === 'CLOSED'
        ? 'danger'
        : 'outline'
  const availabilityDialog = availabilityTarget === 'CLOSED'
    ? {
        title: 'Close Queue?',
        description: 'New visitors will no longer be able to join. Existing queue entries will remain active and can still be managed by staff.',
        cancel: 'Keep Open',
        confirm: 'Close Queue',
      }
    : availabilityTarget === 'PAUSED'
      ? {
          title: 'Pause Queue?',
          description: 'New registrations will temporarily stop. Existing patients will remain in the queue.',
          cancel: 'Cancel',
          confirm: 'Pause Queue',
        }
      : {
          title: 'Open Queue?',
          description: 'Students will be able to register through the organization QR code.',
          cancel: availability === 'PAUSED' ? 'Keep Paused' : 'Keep Closed',
          confirm: availability === 'PAUSED' ? 'Resume Queue' : 'Open Queue',
        }

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" onClick={() => void callNext()} loading={calling} disabled={!selectedQueueId || sessionStatus !== 'ACTIVE'}>
              {calling ? 'Calling...' : 'Call next'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!queues.some((queue) => queue.id === selectedQueueId && queue.isActive && queue.admissionStatus === 'OPEN' && queue.sessionStatus === 'ACTIVE')}
              onClick={() => { setWalkInEntry(null); setWalkInQueueId(selectedQueueId ?? ''); setWalkInOpen(true) }}
            >
              Add Walk-in Patient
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className={calledEntry ? 'border-status-calling/45 bg-status-calling/10 text-status-calling' : ''}
                onClick={() => void serveNext()}
                loading={calling}
                disabled={!selectedQueueId || sessionStatus !== 'ACTIVE'}
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
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Queue Availability and Today's Session</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Availability</span>
              <Badge variant={availabilityVariant}>{availabilityLabel}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Session</span>
              <Badge variant={queueSessionVariant(sessionStatus)}>{queueSessionLabel(sessionStatus)}</Badge>
              {sessionStatus === 'ACTIVE' && data?.clinic.sessionDate ? <span className="text-xs text-muted-foreground">{data.clinic.sessionDate}</span> : null}
            </div>
            {availability === 'OPEN' && sessionStatus === 'NOT_STARTED' ? (
              <p className="text-sm text-muted-foreground">The queue is configured OPEN, but students cannot register until today's session starts.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {(sessionStatus === 'NOT_STARTED' || sessionStatus === 'ENDED') && availability !== 'CLOSED' ? (
              <Button onClick={() => void startSession()} loading={sessionStarting} disabled={!selectedQueueId}>
                {sessionStatus === 'ENDED' ? "Resume Today's Session" : "Start Today's Session"}
              </Button>
            ) : null}
            {selectedQueueId ? (
              <Button variant="outline" onClick={() => void endSession()} loading={sessionEnding} disabled={!selectedQueueId}>
                End Today's Session
              </Button>
            ) : null}
            {availability === 'OPEN' ? (
              <>
                <Button variant="outline" onClick={() => setAvailabilityTarget('PAUSED')}>Pause Queue</Button>
                <Button variant="destructive" onClick={() => setAvailabilityTarget('CLOSED')}>Close Queue</Button>
              </>
            ) : availability === 'PAUSED' ? (
              <>
                <Button onClick={() => setAvailabilityTarget('OPEN')}>Resume Queue</Button>
                <Button variant="destructive" onClick={() => setAvailabilityTarget('CLOSED')}>Close Queue</Button>
              </>
            ) : availability === 'CLOSED' ? (
              <Button onClick={() => setAvailabilityTarget('OPEN')}>Open Queue</Button>
            ) : (
              <span className="text-sm text-muted-foreground">Availability could not be verified. Controls are disabled.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>{serving?.status === 'CALLED' ? 'Currently called' : 'Currently serving'}</CardTitle>
          </CardHeader>
          <CardContent>
            {serving ? (
              <div
                className={[
                  'relative overflow-hidden rounded-xl border border-border bg-card p-4',
                  serving.status === 'CALLED'
                    ? 'border-status-calling/45 bg-status-calling/10'
                    : '',
                  serving.status === 'SERVING'
                    ? 'border-status-serving/40 bg-status-serving/10'
                    : '',
                ].join(' ')}
              >
                <QueueNumber
                  value={serving.queueNumber}
                  size="lg"
                  className={serving.status === 'CALLED' ? 'queue-number-calling' : 'text-status-serving'}
                />
                <p className="mt-2 text-sm font-medium">{serving.studentName}</p>
                <p className="text-sm text-muted-foreground">{serving.purpose}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {serving.status === 'CALLED' ? <Button onClick={() => void act(serving, 'serve')}>Serve</Button> : null}
                  {serving.status === 'CALLED' ? <Button variant="outline" onClick={() => void act(serving, 'return_to_waiting')}>Return to waiting</Button> : null}
                  {serving.status === 'SERVING' ? <Button onClick={() => void act(serving, 'complete')}>Finish service</Button> : null}
                  {['CALLED', 'SERVING'].includes(serving.status) ? <Button variant="destructive" onClick={() => setPendingAction({ entry: serving, action: 'cancel' })}>Cancel queue</Button> : null}
                  {serving.status === 'CALLED' ? <Button variant="outline" onClick={() => setPendingAction({ entry: serving, action: 'skip' })}>Mark as no-show</Button> : null}
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
                  <QueueNumber value={item.queueNumber} size="sm" className={item.status === 'CALLED' ? 'queue-number-calling' : undefined} />
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
                          <QueueNumber value={item.queueNumber} size="sm" className={item.status === 'CALLED' ? 'queue-number-calling' : undefined} />
                        </TD>
                        <TD>{item.studentName}</TD>
                        <TD>{item.purpose}</TD>
                        <TD>{formatRelative(item.joinedAt)}</TD>
                        <TD>
                          <QueueStatusBadge status={item.status} />
                        </TD>
                        <TD>
                          <ActionMenu>
                            {item.status === 'WAITING' ? (
                              <ActionItem onClick={() => void queueService.updateStatus(item.id, 'call').then(reload)}>Call</ActionItem>
                            ) : null}
                            {item.status === 'CALLED' ? <ActionItem onClick={() => void queueService.updateStatus(item.id, 'serve').then(reload)}>Serve</ActionItem> : null}
                            {item.status === 'CALLED' ? <ActionItem onClick={() => void act(item, 'return_to_waiting')}>Return to waiting</ActionItem> : null}
                            {item.status === 'SERVING' ? <ActionItem onClick={() => void act(item, 'complete')}>Complete service</ActionItem> : null}
                            {['WAITING', 'CALLED'].includes(item.status) ? <ActionItem onClick={() => setPendingAction({ entry: item, action: 'skip' })}>Mark as no-show</ActionItem> : null}
                            {['WAITING', 'CALLED', 'SERVING'].includes(item.status) ? <ActionItem destructive onClick={() => setPendingAction({ entry: item, action: 'cancel' })}>Cancel queue</ActionItem> : null}
                            {['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(item.status) ? <ActionItem destructive onClick={() => setPendingAction({ entry: item, action: 'delete' })}>Delete</ActionItem> : null}
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
                      <QueueNumber value={item.queueNumber} size="sm" className={item.status === 'CALLED' ? 'queue-number-calling' : undefined} />
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
      <QueueActionDialog
        entry={pendingAction?.entry ?? null}
        action={pendingAction?.action ?? null}
        busy={calling}
        onClose={() => setPendingAction(null)}
        onConfirm={(entry, action) => void act(entry, action)}
      />
      <Dialog
        open={walkInOpen}
        onClose={() => { if (!walkInSaving) setWalkInOpen(false) }}
        title={walkInEntry ? 'Walk-in Ticket' : 'Add Walk-in Patient'}
        description={walkInEntry ? 'The patient has been added to the existing queue.' : 'Register a patient directly in this organization’s active queue.'}
        footer={walkInEntry ? (
          <>
            <Button variant="outline" onClick={() => void copyWalkInTicket()}>Copy ticket</Button>
            <Button variant="outline" onClick={printWalkInTicket}>Print ticket</Button>
            <Button onClick={() => setWalkInOpen(false)}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={walkInSaving} onClick={() => setWalkInOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="walk-in-registration"
              loading={walkInSaving}
              disabled={!walkInName.trim() || !walkInQueueId || queues.find((queue) => queue.id === walkInQueueId)?.admissionStatus !== 'OPEN'}
            >
              Register Walk-in
            </Button>
          </>
        )}
      >
        {walkInEntry ? (
          <div className="rounded-lg border border-border bg-muted/40 p-5 text-center">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Queue number</p>
            <p className="mt-2 font-mono text-5xl font-bold tabular-nums text-foreground">{walkInEntry.queueNumber}</p>
            <p className="mt-3 font-medium">{walkInEntry.studentName}</p>
            <p className="mt-1 text-sm text-muted-foreground">Waiting</p>
          </div>
        ) : (
          <form
            id="walk-in-registration"
            className="space-y-4"
            onSubmit={(event) => { event.preventDefault(); void registerWalkIn() }}
          >
            <div>
              <Label htmlFor="walk-in-queue">Location / Queue</Label>
              <Select id="walk-in-queue" value={walkInQueueId} required onChange={(event) => setWalkInQueueId(event.target.value)}>
                <option value="" disabled>Select a queue</option>
                {queues.filter((queue) => queue.isActive).map((queue) => (
                  <option key={queue.id} value={queue.id} disabled={queue.admissionStatus !== 'OPEN'}>
                    {locations.find((location) => location.id === queue.locationId)?.name || 'Location'} · {queue.name} ({queue.admissionStatus})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="walk-in-name">Patient name</Label>
              <Input id="walk-in-name" autoComplete="name" maxLength={120} value={walkInName} onChange={(event) => setWalkInName(event.target.value)} required />
            </div>
            <div>
              <Label htmlFor="walk-in-reference">Patient / reference ID (optional)</Label>
              <Input id="walk-in-reference" autoComplete="off" maxLength={80} value={walkInReference} onChange={(event) => setWalkInReference(event.target.value)} />
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(availabilityTarget)}
        onClose={() => { if (!availabilitySaving) setAvailabilityTarget(null) }}
        title={availabilityDialog.title}
        description={availabilityDialog.description}
        footer={
          <>
            <Button variant="outline" disabled={availabilitySaving} onClick={() => setAvailabilityTarget(null)}>
              {availabilityDialog.cancel}
            </Button>
            <Button
              variant={availabilityTarget === 'CLOSED' ? 'destructive' : 'default'}
              loading={availabilitySaving}
              onClick={() => void confirmAvailabilityChange()}
            >
              {availabilitySaving ? 'Saving...' : availabilityDialog.confirm}
            </Button>
          </>
        }
      />
    </div>
  )
}
