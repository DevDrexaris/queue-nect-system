import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Users } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { FieldError, Label } from '../../components/ui/field'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { adminUsersService, organizationStructureService } from '../../services/api'
import { userMessage } from '../../lib/api'
import { createStaffSchema } from '../../lib/schemas'
import type { AdminAccount } from '../../types'
import { useAuth } from '../../hooks/use-auth'
import { useAdminQueueScope } from '../../hooks/use-admin-queue-scope'
import { toast } from 'sonner'
import type { z } from 'zod'

type StaffValues = z.infer<typeof createStaffSchema>

type StaffAssignment = { locationId: string; queueId: string }

export function AdminUsersPage() {
  const { user } = useAuth()
  const { locations, queues } = useAdminQueueScope()
  const canAssign = user?.role === 'ADMIN' || user?.role === 'ORG_ADMIN' || user?.role === 'SUPER_ADMIN'
  const [users, setUsers] = useState<AdminAccount[]>([])
  const [assignments, setAssignments] = useState<Record<string, StaffAssignment>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const form = useForm<StaffValues>({
    resolver: zodResolver(createStaffSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      email: '',
      password: '',
      organizationId: user?.clinic?.id ?? '',
      locationId: '',
      queueId: '',
      method: 'temporary-password',
    },
  })

  async function load() {
    setLoading(true)
    try {
      const data = await adminUsersService.list()
      setUsers(data.users)
      setAssignments(Object.fromEntries(data.users.map((item) => [item.id, {
        locationId: item.locationId ?? '',
        queueId: item.queueId ?? '',
      }])))
      setError(null)
    } catch (caught) {
      setUsers([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  async function saveAssignment(item: AdminAccount) {
    const assignment = assignments[item.id]
    if (!assignment) return
    setSavingId(item.id)
    try {
      await organizationStructureService.assignStaff(item.id, assignment.locationId || null, assignment.queueId || null)
      setUsers((current) => current.map((row) => row.id === item.id
        ? { ...row, locationId: assignment.locationId || undefined, queueId: assignment.queueId || undefined }
        : row))
      toast.success(`Queue assignment saved for ${item.name}.`)
    } catch (caught) {
      console.error('[Queue-Nect] Staff assignment failed:', caught)
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setSavingId(null)
    }
  }

  async function onCreateStaff(values: StaffValues) {
    setCreating(true)
    try {
      const created = await adminUsersService.createStaff({
        name: values.name,
        email: values.email,
        password: values.method === 'temporary-password' ? values.password : '',
        organizationId: values.organizationId,
        locationId: values.locationId || null,
        queueId: values.queueId || null,
        mode: values.method,
      })

      setCreateOpen(false)
      form.reset({
        name: '',
        email: '',
        password: '',
        organizationId: user?.clinic?.id ?? '',
        locationId: '',
        queueId: '',
        method: 'temporary-password',
      })
      setUsers((current) => [created, ...current])
      toast.success(values.method === 'email-invitation'
        ? `Invitation sent to ${created.email}.`
        : `Staff account created for ${created.name}.`)
      await load()
    } catch (caught) {
      toast.error(userMessage(caught, 'staff'))
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (user?.clinic?.id) {
      form.setValue('organizationId', user.clinic.id)
    }
  }, [form, user?.clinic?.id])

  return (
    <div>
      <PageHeader
        title="Admin Users"
        description="Staff accounts for this clinic. Super Admin roles cannot be assigned here."
        actions={
          canAssign ? (
            <Button onClick={() => setCreateOpen(true)}>Create staff</Button>
          ) : undefined
        }
      />
      {loading ? (
        <LoadingState label="Loading admin users..." />
      ) : error ? (
        <ErrorState title="Unable to load admin users." description={error} onRetry={() => void load()} />
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No staff accounts found." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Location</TH>
              <TH>Queue</TH>
              {canAssign ? <TH>Assignment</TH> : null}
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((item) => (
              <TR key={item.id}>
                <TD>{item.name}</TD>
                <TD>{item.email}</TD>
                <TD>{item.role}</TD>
                <TD>
                  {canAssign ? (
                    <Select
                      aria-label={`Location assignment for ${item.name}`}
                      value={assignments[item.id]?.locationId ?? ''}
                      onChange={(event) => setAssignments((current) => ({
                        ...current,
                        [item.id]: { locationId: event.target.value, queueId: '' },
                      }))}
                    >
                      <option value="">Any location</option>
                      {locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </Select>
                  ) : locations.find((location) => location.id === item.locationId)?.name ?? 'Unassigned'}
                </TD>
                <TD>
                  {canAssign ? (
                    <Select
                      aria-label={`Queue assignment for ${item.name}`}
                      value={assignments[item.id]?.queueId ?? ''}
                      onChange={(event) => setAssignments((current) => ({
                        ...current,
                        [item.id]: { ...(current[item.id] ?? { locationId: '' }), queueId: event.target.value },
                      }))}
                    >
                      <option value="">Any queue</option>
                      {queues.filter((queue) => queue.isActive && (!assignments[item.id]?.locationId || queue.locationId === assignments[item.id]?.locationId)).map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
                    </Select>
                  ) : queues.find((queue) => queue.id === item.queueId)?.name ?? 'Unassigned'}
                </TD>
                {canAssign ? (
                  <TD><Button size="sm" variant="outline" loading={savingId === item.id} onClick={() => void saveAssignment(item)}>Save</Button></TD>
                ) : null}
                <TD>
                  <Badge variant={item.status === 'active' ? 'success' : 'outline'}>{item.status}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          form.reset({
            name: '',
            email: '',
            password: '',
            organizationId: user?.clinic?.id ?? '',
            locationId: '',
            queueId: '',
            method: 'temporary-password',
          })
        }}
        title="Create staff account"
        description="Choose how to create the staff account and assign the user to the correct organization, location, and queue."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={form.handleSubmit(onCreateStaff)} loading={creating}>
              Create staff
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="staff-method">Account creation method</Label>
            <Select
              id="staff-method"
              value={form.watch('method')}
              onChange={(event) => form.setValue('method', event.target.value as 'temporary-password' | 'email-invitation')}
            >
              <option value="temporary-password">Temporary password</option>
              <option value="email-invitation">Email invitation</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="staff-name">Full name</Label>
            <Input id="staff-name" {...form.register('name')} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>
          <div>
            <Label htmlFor="staff-email">Email</Label>
            <Input id="staff-email" type="email" {...form.register('email')} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>
          {form.watch('method') === 'temporary-password' ? (
            <div>
              <Label htmlFor="staff-password">Temporary password</Label>
              <Input id="staff-password" type="password" {...form.register('password')} />
              <FieldError message={form.formState.errors.password?.message} />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              An invitation email will be sent to this address, and the user will set their own password through the secure authentication flow.
            </div>
          )}
          <div>
            <Label htmlFor="staff-organization">Organization</Label>
            <Select id="staff-organization" {...form.register('organizationId')}>
              <option value="">Select organization</option>
              {user?.clinic?.id ? <option value={user.clinic.id}>{user.clinic.name}</option> : null}
            </Select>
            <FieldError message={form.formState.errors.organizationId?.message} />
          </div>
          <div>
            <Label htmlFor="staff-location">Location</Label>
            <Select
              id="staff-location"
              value={form.watch('locationId')}
              onChange={(event) => {
                form.setValue('locationId', event.target.value)
                form.setValue('queueId', '')
              }}
            >
              <option value="">Any location</option>
              {locations.filter((location) => location.isActive).map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </Select>
            <FieldError message={form.formState.errors.locationId?.message} />
          </div>
          <div>
            <Label htmlFor="staff-queue">Queue</Label>
            <Select
              id="staff-queue"
              value={form.watch('queueId')}
              onChange={(event) => form.setValue('queueId', event.target.value)}
            >
              <option value="">Any queue</option>
              {queues.filter((queue) => queue.isActive && (!form.watch('locationId') || queue.locationId === form.watch('locationId'))).map((queue) => (
                <option key={queue.id} value={queue.id}>{queue.name}</option>
              ))}
            </Select>
            <FieldError message={form.formState.errors.queueId?.message} />
          </div>
        </div>
      </Dialog>
    </div>
  )
}
