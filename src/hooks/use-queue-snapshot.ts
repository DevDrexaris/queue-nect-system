import { useCallback, useState } from 'react'
import { queueService } from '../services/api'
import { userMessage } from '../lib/api'
import { usePolling } from './use-polling'
import type { QueueSnapshot } from '../types'

export function useQueueSnapshot(clinicIdentifier: string | undefined, intervalMs: number) {
  const [data, setData] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!clinicIdentifier) {
      setLoading(false)
      setError('Clinic not found.')
      setData(null)
      return
    }
    try {
      const snapshot = await queueService.getSnapshot(clinicIdentifier)
      setData(snapshot)
      setError(null)
    } catch (caught) {
      setError(userMessage(caught))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [clinicIdentifier])

  usePolling(load, intervalMs, Boolean(clinicIdentifier))

  return { data, error, loading, reload: load }
}
