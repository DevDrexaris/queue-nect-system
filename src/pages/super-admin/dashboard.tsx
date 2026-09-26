import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { PageHeader } from '../../components/ui/page-header'
import { StatCard } from '../../components/ui/stat-card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states'
import { superAdminService } from '../../services/api'
import { userMessage } from '../../lib/api'
import type { Organization } from '../../types'

export function SuperAdminDashboardPage() {
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await superAdminService.organizations()
      setOrgs(data.organizations)
      setError(null)
    } catch (caught) {
      setOrgs(null)
      setError(userMessage(caught))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (error && !orgs) return <ErrorState title="Unable to load system overview." description={error} onRetry={() => void load()} />
  if (!orgs) return <LoadingState label="Loading system overview..." />

  const active = orgs.filter((item) => item.status === 'active').length

  return (
    <div>
      <PageHeader title="Platform dashboard" description="Organizations and clinic administrators across Queue-Nect." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Organizations" value={orgs.length} icon={Building2} />
        <StatCard label="Active" value={active} />
        <StatCard label="Disabled" value={orgs.length - active} />
      </div>
      {orgs.length === 0 ? (
        <EmptyState className="mt-8" title="No organizations yet." description="Create a school clinic to generate its QR code and admin account." />
      ) : null}
    </div>
  )
}
