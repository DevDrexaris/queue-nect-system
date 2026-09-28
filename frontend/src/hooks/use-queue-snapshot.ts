import { useCallback, useRef, useState } from 'react'
import { useEffect } from 'react'
import { queueService } from '../services/api'
import { userMessage } from '../lib/api'
import { supabaseAnon } from '../lib/supabase'
import type { QueueAvailability, QueueSnapshot } from '../types'

export function useQueueSnapshot(clinicIdentifier: string | undefined, _intervalMs?: number, queueId?: string) {
  const [data, setData] = useState<QueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting')
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!clinicIdentifier) {
      if (requestId !== requestIdRef.current) return
      setLoading(false)
      setError('Clinic not found.')
      setData(null)
      return
    }
    try {
      const snapshot = await queueService.getSnapshot(clinicIdentifier, queueId)
      if (requestId !== requestIdRef.current) return
      setData(snapshot)
      setError(null)
    } catch (caught) {
      if (requestId !== requestIdRef.current) return
      setError(userMessage(caught))
      setData(null)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [clinicIdentifier, queueId])

  const loadRef = useRef(load)
  loadRef.current = load

  const updateAvailability = useCallback((availability: QueueAvailability) => {
    requestIdRef.current += 1
    setData((current) => current
      ? { ...current, clinic: { ...current.clinic, availability } }
      : current)
  }, [])

  useEffect(() => {
    if (!clinicIdentifier) return

    let connectedOnce = false
    let disposed = false
    let channel: ReturnType<typeof supabaseAnon.channel> | null = null
    let channelStatus = 'CLOSED'
    let channelConnecting = false
    let channelGeneration = 0
    let reconnectTimer: number | undefined
    let retryDelay = 500
    let lastRecoveryAt = 0

    const subscribe = async (force = false) => {
      if (disposed || channelConnecting || (!force && channelStatus === 'SUBSCRIBED')) return
      const previous = force ? channel : null
      if (force) {
        channel = null
        channelStatus = 'CLOSED'
      }
      channelConnecting = true
      if (previous) await supabaseAnon.removeChannel(previous)
      if (disposed) {
        channelConnecting = false
        return
      }

      const generation = ++channelGeneration
      channel = supabaseAnon
        .channel(`public-queue:${clinicIdentifier}`)
        .on('broadcast', { event: 'queue_changed' }, () => {
          if (!disposed && generation === channelGeneration) void loadRef.current()
        })
        .subscribe((status) => {
          if (disposed || generation !== channelGeneration) return
          channelStatus = status
          channelConnecting = false
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected')
          retryDelay = 500
          if (connectedOnce) void loadRef.current()
          connectedOnce = true
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus(connectedOnce ? 'reconnecting' : 'disconnected')
          channelConnecting = false
          window.clearTimeout(reconnectTimer)
          reconnectTimer = window.setTimeout(() => {
            if (!disposed && navigator.onLine) void subscribe(true)
          }, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 15_000)
        }
      })
    }

    const recover = () => {
      if (disposed || document.visibilityState !== 'visible' || !navigator.onLine) return
      const now = Date.now()
      if (now - lastRecoveryAt < 1000) return
      lastRecoveryAt = now
      void loadRef.current()
      if (channelStatus !== 'SUBSCRIBED') void subscribe(true)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recover()
    }
    const onOffline = () => setRealtimeStatus('disconnected')

    void subscribe()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', recover)
    window.addEventListener('focus', recover)
    window.addEventListener('online', recover)
    window.addEventListener('offline', onOffline)
    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', recover)
      window.removeEventListener('focus', recover)
      window.removeEventListener('online', recover)
      window.removeEventListener('offline', onOffline)
      if (channel) void supabaseAnon.removeChannel(channel)
    }
  }, [clinicIdentifier])

  useEffect(() => {
    void load()
  }, [load])

  return { data, error, loading, reload: load, realtimeStatus, updateAvailability }
}
