import type { QueueSessionStatus } from '../types'

export function queueSessionLabel(status: QueueSessionStatus | undefined) {
  if (status === 'ACTIVE') return 'ACTIVE'
  if (status === 'NOT_STARTED') return 'SESSION NOT STARTED'
  if (status === 'ENDED') return 'SESSION ENDED'
  return 'SESSION STATUS UNAVAILABLE'
}

export function queueSessionVariant(status: QueueSessionStatus | undefined): 'success' | 'warning' | 'outline' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'ENDED') return 'warning'
  return 'outline'
}
