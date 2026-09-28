import { useContext } from 'react'
import { AdminQueueScopeContext } from '../providers/admin-queue-scope-context'

export function useAdminQueueScope() {
  const scope = useContext(AdminQueueScopeContext)
  if (!scope) throw new Error('Admin queue scope is unavailable.')
  return scope
}
