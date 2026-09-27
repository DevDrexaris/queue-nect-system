import { useContext } from 'react'
import { AdminRealtimeContext } from '../providers/admin-realtime-context'

export function useAdminRealtimeContext() {
  const context = useContext(AdminRealtimeContext)
  if (!context) throw new Error('Admin realtime context is unavailable')
  return context
}