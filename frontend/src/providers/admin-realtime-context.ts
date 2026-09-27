import { createContext } from 'react'
import type { AdminActivityEvent, QueuePresence } from '../hooks/use-admin-realtime'

export type AdminRealtimeState = {
  events: AdminActivityEvent[]
  presence: QueuePresence[]
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  now: number
  queueRevision: number
  clearEvents: () => void
}

export const AdminRealtimeContext = createContext<AdminRealtimeState | null>(null)