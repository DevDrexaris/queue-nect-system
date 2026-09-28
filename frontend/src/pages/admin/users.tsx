import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Select } from '../../components/ui/select'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { adminUsersService, organizationStructureService } from '../../services/api'
import { userMessage } from '../../lib/api'
import type { AdminAccount } from '../../types'
import { useAuth } from '../../hooks/use-auth'
import { useAdminQueueScope } from '../../hooks/use-admin-queue-scope'
import { toast } from 'sonner'

type StaffAssignment = { locationId: string; queueId: string }

export function AdminUsersPage() {
  const { user } = useAuth()
  const { locations, queues } = useAdminQueueScope()
  const canAssign = user?.role === 'ADMIN' || user?.role === 'ORG_ADMIN' || user?.role === 'SUPER_ADMIN'
  const [users, setUsers] = useState<AdminAccount[]>([])
  const [assignments, setAssignments] = useState<Record<string, StaffAssignment>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    void load()
  }, [])

  return (
    <div>
      <PageHeader
        title="Admin Users"
        description="Staff accounts for this clinic. Super Admin roles cannot be assigned here."
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
    </div>
  )
}
