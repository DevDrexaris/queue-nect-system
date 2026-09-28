import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Dialog } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/field'
import { PageHeader } from '../../components/ui/page-header'
import { Select } from '../../components/ui/select'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { useAdminQueueScope } from '../../hooks/use-admin-queue-scope'
import { useAuth } from '../../hooks/use-auth'
import { userMessage } from '../../lib/api'
import { organizationStructureService, queueService } from '../../services/api'
import { queueSessionLabel, queueSessionVariant } from '../../lib/queue-session'
import type { LocationType, OrganizationLocation, OrganizationQueue, QueueAvailability } from '../../types'

const locationTypes: LocationType[] = ['Building', 'Clinic', 'Branch', 'Department', 'Other']
const queueStates: Exclude<QueueAvailability, 'UNKNOWN'>[] = ['OPEN', 'PAUSED', 'CLOSED']

type LocationForm = {
  name: string
  locationType: LocationType
  description: string
  addressOrFloor: string
  contactInformation: string
  isActive: boolean
}

type QueueForm = {
  locationId: string
  name: string
  queuePrefix: string
  description: string
  serviceArea: string
  admissionStatus: Exclude<QueueAvailability, 'UNKNOWN'>
  openingTime: string
  closingTime: string
  timeZone: string
  isActive: boolean
}

const emptyLocation: LocationForm = {
  name: '', locationType: 'Building', description: '', addressOrFloor: '', contactInformation: '', isActive: true,
}
const emptyQueue: QueueForm = {
  locationId: '', name: '', queuePrefix: 'A', description: '', serviceArea: '', admissionStatus: 'OPEN',
  openingTime: '', closingTime: '', timeZone: '', isActive: true,
}

export function AdminLocationsPage() {
  const { user } = useAuth()
  const organizationId = user?.clinic?.id
  const canManage = user?.role === 'ADMIN' || user?.role === 'ORG_ADMIN' || user?.role === 'SUPER_ADMIN'
  const { locations, queues, reloadQueueCatalog } = useAdminQueueScope()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [locationTarget, setLocationTarget] = useState<OrganizationLocation | null>(null)
  const [queueTarget, setQueueTarget] = useState<OrganizationQueue | null>(null)
  const [locationForm, setLocationForm] = useState<LocationForm>(emptyLocation)
  const [queueForm, setQueueForm] = useState<QueueForm>(emptyQueue)
  const [saving, setSaving] = useState(false)
  const [startingQueueId, setStartingQueueId] = useState<string | null>(null)
  const [endingQueueId, setEndingQueueId] = useState<string | null>(null)
  const [stats, setStats] = useState<Awaited<ReturnType<typeof organizationStructureService.stats>> | null>(null)

  async function loadStats() {
    if (!organizationId) return
    try {
      setStats(await organizationStructureService.stats(organizationId))
    } catch (caught) {
      console.error('[Queue-Nect] Location queue statistics failed:', caught)
      setStats(null)
    }
  }

  useEffect(() => {
    void loadStats()
  }, [organizationId])

  function editLocation(location?: OrganizationLocation) {
    setLocationTarget(location ?? null)
    setLocationForm(location ? {
      name: location.name,
      locationType: location.locationType,
      description: location.description ?? '',
      addressOrFloor: location.addressOrFloor ?? '',
      contactInformation: location.contactInformation ?? '',
      isActive: location.isActive,
    } : emptyLocation)
    setLocationOpen(true)
  }

  function editQueue(queue?: OrganizationQueue, locationId?: string) {
    setQueueTarget(queue ?? null)
    setQueueForm(queue ? {
      locationId: queue.locationId,
      name: queue.name,
      queuePrefix: queue.queuePrefix,
      description: queue.description ?? '',
      serviceArea: queue.serviceArea ?? '',
      admissionStatus: queue.admissionStatus,
      openingTime: queue.openingTime ?? '',
      closingTime: queue.closingTime ?? '',
      timeZone: queue.timeZone ?? '',
      isActive: queue.isActive,
    } : { ...emptyQueue, locationId: locationId ?? locations.find((item) => item.isActive)?.id ?? '' })
    setQueueOpen(true)
  }

  async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationId || saving) return
    setSaving(true)
    try {
      if (locationTarget) {
        await organizationStructureService.updateLocation({ ...locationTarget, ...locationForm })
      } else {
        await organizationStructureService.createLocation(organizationId, locationForm)
      }
      await reloadQueueCatalog()
      await loadStats()
      setLocationOpen(false)
      toast.success(locationTarget ? 'Location updated.' : 'Location created.')
    } catch (caught) {
      console.error('[Queue-Nect] Location save failed:', caught)
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSaving(false)
    }
  }

  async function saveQueue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!organizationId || saving) return
    setSaving(true)
    try {
      const values = {
        ...queueForm,
        openingTime: queueForm.openingTime || null,
        closingTime: queueForm.closingTime || null,
        timeZone: queueForm.timeZone || null,
        operatingDays: null,
      }
      if (queueTarget) {
        await organizationStructureService.updateQueue({ ...queueTarget, ...values })
      } else {
        await organizationStructureService.createQueue(organizationId, values)
      }
      await reloadQueueCatalog()
      await loadStats()
      setQueueOpen(false)
      toast.success(queueTarget ? 'Queue updated.' : 'Queue created.')
    } catch (caught) {
      console.error('[Queue-Nect] Queue save failed:', caught)
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSaving(false)
    }
  }

  async function archiveLocation(location: OrganizationLocation) {
    if (!window.confirm(`Archive ${location.name}? Existing queue records will be preserved.`)) return
    setLoading(true)
    try {
      await organizationStructureService.archiveLocation(location.id)
      await reloadQueueCatalog()
      await loadStats()
      toast.success('Location archived.')
      setError(null)
    } catch (caught) {
      console.error('[Queue-Nect] Location archive failed:', caught)
      setError(userMessage(caught, 'staff'))
    } finally {
      setLoading(false)
    }
  }

  async function archiveQueue(queue: OrganizationQueue) {
    if (!window.confirm(`Archive ${queue.name}? Existing queue records will be preserved.`)) return
    setLoading(true)
    try {
      await organizationStructureService.archiveQueue(queue.id)
      await reloadQueueCatalog()
      await loadStats()
      toast.success('Queue archived.')
      setError(null)
    } catch (caught) {
      console.error('[Queue-Nect] Queue archive failed:', caught)
      setError(userMessage(caught, 'staff'))
    } finally {
      setLoading(false)
    }
  }

  async function startQueueSession(queue: OrganizationQueue) {
    setStartingQueueId(queue.id)
    try {
      const result = await queueService.startSession(queue.id)
      toast.success(result.resumed ? "Today's session resumed." : "Today's session started.")
      await Promise.all([reloadQueueCatalog(), loadStats()])
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setStartingQueueId(null)
    }
  }

  async function endQueueSession(queue: OrganizationQueue) {
    setEndingQueueId(queue.id)
    try {
      const result = await queueService.endSession(queue.id)
      toast.success(result.ended ? "Today's session ended." : "Today's session was already inactive.")
      await Promise.all([reloadQueueCatalog(), loadStats()])
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setEndingQueueId(null)
    }
  }

  if (!organizationId) return <ErrorState title="No organization assigned." />
  if (loading) return <LoadingState label="Loading locations and queues..." />
  if (error) return <ErrorState title="Unable to update locations or queues." description={error} />

  return (
    <div>
      <PageHeader
        title="Locations & Queues"
        description="Organize this organization’s service points and admission queues."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => editLocation()}>Add Location</Button>
              <Button onClick={() => editQueue()}>Add Queue</Button>
            </div>
          ) : null
        }
      />

      {stats ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Organization Queue Summary</CardTitle>
            <CardDescription>Current-session counts combined across active locations.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div><p className="text-xs text-muted-foreground">Visitors</p><p className="mt-1 text-xl font-semibold">{stats.combined.total}</p></div>
            <div><p className="text-xs text-muted-foreground">Waiting</p><p className="mt-1 text-xl font-semibold">{stats.combined.waiting}</p></div>
            <div><p className="text-xs text-muted-foreground">Serving</p><p className="mt-1 text-xl font-semibold">{stats.combined.serving}</p></div>
            <div><p className="text-xs text-muted-foreground">Awaiting Return</p><p className="mt-1 text-xl font-semibold">{stats.combined.awaitingReturn}</p></div>
            <div><p className="text-xs text-muted-foreground">Completed</p><p className="mt-1 text-xl font-semibold">{stats.combined.completed}</p></div>
          </CardContent>
        </Card>
      ) : null}

      {locations.length === 0 ? (
        <EmptyState title="No locations found." description="Add a location to organize queues for this organization." />
      ) : (
        <div className="space-y-4">
          {locations.map((location) => {
            const locationQueues = queues.filter((queue) => queue.locationId === location.id)
            const locationStats = stats?.locations.find((item) => item.locationId === location.id)
            return (
              <Card key={location.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{location.name}</CardTitle>
                      <Badge variant={location.isActive ? 'success' : 'outline'}>{location.isActive ? 'Active' : 'Inactive'}</Badge>
                      {location.isDefault ? <Badge variant="outline">Default</Badge> : null}
                    </div>
                    <CardDescription className="mt-1">{location.locationType}{location.addressOrFloor ? ` · ${location.addressOrFloor}` : ''}</CardDescription>
                    {location.description ? <p className="mt-2 text-sm text-muted-foreground">{location.description}</p> : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => editLocation(location)}>Edit</Button>
                      {!location.isDefault && location.isActive ? <Button size="sm" variant="destructive" onClick={() => void archiveLocation(location)}>Archive</Button> : null}
                      <Button size="sm" onClick={() => editQueue(undefined, location.id)}>Add Queue</Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {locationStats ? (
                    <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-5">
                      <span>Visitors: <strong>{locationStats.total}</strong></span>
                      <span>Waiting: <strong>{locationStats.waiting}</strong></span>
                      <span>Serving: <strong>{locationStats.serving}</strong></span>
                      <span>Awaiting: <strong>{locationStats.awaitingReturn}</strong></span>
                      <span>Completed: <strong>{locationStats.completed}</strong></span>
                    </div>
                  ) : null}
                  {locationQueues.length ? (
                    <div className="divide-y divide-border">
                      {locationQueues.map((queue) => (
                        <div key={queue.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium">{queue.name}</p>
                              <Badge variant={queue.admissionStatus === 'OPEN' ? 'success' : queue.admissionStatus === 'PAUSED' ? 'warning' : 'outline'}>{queue.admissionStatus}</Badge>
                              <Badge variant={queueSessionVariant(queue.sessionStatus)}>{queueSessionLabel(queue.sessionStatus)}</Badge>
                              {!queue.isActive ? <Badge variant="outline">Archived</Badge> : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">Prefix {queue.queuePrefix}{queue.serviceArea ? ` · ${queue.serviceArea}` : ''}</p>
                            {locationStats?.queues.find((item) => item.queueId === queue.id) ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {locationStats.queues.find((item) => item.queueId === queue.id)?.total ?? 0} visitors · {locationStats.queues.find((item) => item.queueId === queue.id)?.waiting ?? 0} waiting · {locationStats.queues.find((item) => item.queueId === queue.id)?.serving ?? 0} serving
                              </p>
                            ) : null}
                            {queue.description ? <p className="mt-1 text-sm text-muted-foreground">{queue.description}</p> : null}
                          </div>
                          {canManage ? (
                            <div className="flex flex-wrap gap-2">
                              {queue.isActive && queue.admissionStatus !== 'CLOSED' && (queue.sessionStatus === 'NOT_STARTED' || queue.sessionStatus === 'ENDED') ? (
                                <Button size="sm" loading={startingQueueId === queue.id} onClick={() => void startQueueSession(queue)}>
                                  {queue.sessionStatus === 'ENDED' ? 'Resume Session' : 'Start Today\'s Session'}
                                </Button>
                              ) : null}
                              {queue.isActive ? (
                                <Button size="sm" variant="outline" loading={endingQueueId === queue.id} onClick={() => void endQueueSession(queue)}>
                                  End Session
                                </Button>
                              ) : null}
                              <Button size="sm" variant="outline" onClick={() => editQueue(queue)}>Edit</Button>
                              {!queue.isDefault && queue.isActive ? <Button size="sm" variant="destructive" onClick={() => void archiveQueue(queue)}>Archive</Button> : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : <p className="py-4 text-sm text-muted-foreground">No queues in this location.</p>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog
        open={locationOpen}
        onClose={() => { if (!saving) setLocationOpen(false) }}
        title={locationTarget ? 'Edit Location' : 'Add Location'}
        className="sm:max-w-lg"
        description="Create a building, clinic, branch, department, or other service location."
        footer={<><Button variant="outline" disabled={saving} onClick={() => setLocationOpen(false)}>Cancel</Button><Button type="submit" form="location-form" loading={saving}>{locationTarget ? 'Save Location' : 'Create Location'}</Button></>}
      >
        <form id="location-form" className="space-y-4" onSubmit={(event) => void saveLocation(event)}>
          <div>
            <Label htmlFor="location-name">Location / Building Name</Label>
            <Input id="location-name" value={locationForm.name} maxLength={120} required onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div>
            <Label htmlFor="location-type">Location Type</Label>
            <Select id="location-type" value={locationForm.locationType} onChange={(event) => setLocationForm((current) => ({ ...current, locationType: event.target.value as LocationType }))}>
              {locationTypes.map((type) => <option key={type}>{type}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="location-description">Description (optional)</Label><Input id="location-description" value={locationForm.description} onChange={(event) => setLocationForm((current) => ({ ...current, description: event.target.value }))} /></div>
          <div><Label htmlFor="location-address">Address or Floor (optional)</Label><Input id="location-address" value={locationForm.addressOrFloor} onChange={(event) => setLocationForm((current) => ({ ...current, addressOrFloor: event.target.value }))} /></div>
          <div><Label htmlFor="location-contact">Contact Information (optional)</Label><Input id="location-contact" value={locationForm.contactInformation} onChange={(event) => setLocationForm((current) => ({ ...current, contactInformation: event.target.value }))} /></div>
          {locationTarget ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={locationForm.isActive} disabled={locationTarget.isDefault} onChange={(event) => setLocationForm((current) => ({ ...current, isActive: event.target.checked }))} />Active</label> : null}
        </form>
      </Dialog>

      <Dialog
        open={queueOpen}
        onClose={() => { if (!saving) setQueueOpen(false) }}
        title={queueTarget ? 'Edit Queue' : 'Add Queue'}
        className="sm:max-w-xl"
        description="Configure an independent service queue for this organization."
        footer={<><Button variant="outline" disabled={saving} onClick={() => setQueueOpen(false)}>Cancel</Button><Button type="submit" form="queue-form" loading={saving}>{queueTarget ? 'Save Queue' : 'Create Queue'}</Button></>}
      >
        <form id="queue-form" className="space-y-4" onSubmit={(event) => void saveQueue(event)}>
          <div><Label htmlFor="queue-name">Queue / Service Name</Label><Input id="queue-name" value={queueForm.name} maxLength={120} required onChange={(event) => setQueueForm((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="queue-prefix">Queue Prefix</Label><Input id="queue-prefix" value={queueForm.queuePrefix} maxLength={5} required onChange={(event) => setQueueForm((current) => ({ ...current, queuePrefix: event.target.value.toUpperCase() }))} /></div>
            <div><Label htmlFor="queue-location">Assign Location</Label><Select id="queue-location" value={queueForm.locationId} required onChange={(event) => setQueueForm((current) => ({ ...current, locationId: event.target.value }))}><option value="" disabled>Select location</option>{locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select></div>
          </div>
          <div><Label htmlFor="queue-description">Description (optional)</Label><Input id="queue-description" value={queueForm.description} onChange={(event) => setQueueForm((current) => ({ ...current, description: event.target.value }))} /></div>
          <div><Label htmlFor="queue-service-area">Service Area / Counter (optional)</Label><Input id="queue-service-area" value={queueForm.serviceArea} onChange={(event) => setQueueForm((current) => ({ ...current, serviceArea: event.target.value }))} /></div>
          <div><Label htmlFor="queue-availability">Queue Availability</Label><Select id="queue-availability" value={queueForm.admissionStatus} onChange={(event) => setQueueForm((current) => ({ ...current, admissionStatus: event.target.value as QueueForm['admissionStatus'] }))}>{queueStates.map((state) => <option key={state}>{state}</option>)}</Select></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="queue-open-time">Opening Time (optional)</Label><Input id="queue-open-time" type="time" value={queueForm.openingTime} onChange={(event) => setQueueForm((current) => ({ ...current, openingTime: event.target.value }))} /></div>
            <div><Label htmlFor="queue-close-time">Closing Time (optional)</Label><Input id="queue-close-time" type="time" value={queueForm.closingTime} onChange={(event) => setQueueForm((current) => ({ ...current, closingTime: event.target.value }))} /></div>
          </div>
          <div><Label htmlFor="queue-time-zone">Time Zone (optional)</Label><Input id="queue-time-zone" placeholder="Asia/Manila" value={queueForm.timeZone} onChange={(event) => setQueueForm((current) => ({ ...current, timeZone: event.target.value }))} /></div>
          {queueTarget ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={queueForm.isActive} disabled={queueTarget.isDefault} onChange={(event) => setQueueForm((current) => ({ ...current, isActive: event.target.checked }))} />Active</label> : null}
        </form>
      </Dialog>
    </div>
  )
}
