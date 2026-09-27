import { useCallback, useState } from 'react'
import { useEffect } from 'react'
import { queueService } from '../services/api'
import { userMessage } from '../lib/api'
import { supabaseAnon } from '../lib/supabase'
import type { QueueSnapshot } from '../types'

export function useQueueSnapshot(clinicIdentifier: string | undefined, _intervalMs?: number) {
  const [data, setData] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting')

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

  useEffect(() => {
    if (!clinicIdentifier) return

    let connectedOnce = false
    const channel = supabaseAnon
      .channel(`public-queue:${clinicIdentifier}`)
      .on('broadcast', { event: 'queue_changed' }, () => void load())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected')
          if (connectedOnce) void load()
          connectedOnce = true
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus(connectedOnce ? 'reconnecting' : 'disconnected')
        }
      })

    const initialLoad = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(initialLoad)
      void supabaseAnon.removeChannel(channel)
    }
  }, [clinicIdentifier, load])

  return { data, error, loading, reload: load, realtimeStatus }
}
