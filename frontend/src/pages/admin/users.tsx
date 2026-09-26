import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { Badge } from '../../components/ui/badge'
import { TBody, TD, TH, THead, TR, Table } from '../../components/ui/table'
import { adminUsersService } from '../../services/api'
import { userMessage } from '../../lib/api'
import type { AdminAccount } from '../../types'

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminAccount[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const data = await adminUsersService.list()
      setUsers(data.users)
      setError(null)
    } catch (caught) {
      setUsers([])
      setError(userMessage(caught))
    } finally {
      setLoading(false)
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
