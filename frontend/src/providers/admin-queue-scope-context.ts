import { createContext } from 'react'
import type { OrganizationLocation, OrganizationQueue } from '../types'

export type AdminQueueScopeState = {
  locations: OrganizationLocation[]
  queues: OrganizationQueue[]
  selectedQueueId?: string
  selectQueue: (queueId: string) => void
  reloadQueueCatalog: () => Promise<void>
}

export const AdminQueueScopeContext = createContext<AdminQueueScopeState | null>(null)
