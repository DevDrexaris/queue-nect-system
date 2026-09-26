import { PageHeader } from '../../components/ui/page-header'
import { EmptyState } from '../../components/ui/states'
import { Activity } from 'lucide-react'

export function SuperAdminActivityPage() {
  return (
    <div>
      <PageHeader title="System Activity" description="Audit events will appear here when the activity API is available." />
      <EmptyState icon={Activity} title="No system activity yet." description="There are no recorded platform events to display." />
    </div>
  )
}
