import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AdminActivityEvent = {
  id: string
  action: string
  details: { queue_number?: string; presence?: string; status?: string } | null
  created_at: string
}

export type QueuePresence = {
  queue_entry_id: string
  organization_id: string
  queue_number: string
  presence: 'ONLINE' | 'IDLE' | 'BACKGROUND' | 'OFFLINE'
  last_seen_at: string
}

export function useAdminRealtime(organizationId: string | undefined) {
  const [events, setEvents] = useState<AdminActivityEvent[]>([])
  const [presence, setPresence] = useState<QueuePresence[]>([])
  const [now, setNow] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting')
  const offlineNotified = useRef(new Set<string>())
  const presenceRef = useRef<QueuePresence[]>([])

  useEffect(() => {
    if (!organizationId) return
    let connectedOnce = false
    let disposed = false
    const applyPresence = (next: QueuePresence[]) => {
      presenceRef.current = next
      setPresence(next)
    }

    const load = async () => {
      const [activityResult, presenceResult] = await Promise.all([
        supabase.from('activity_log').select('id, action, details, created_at')
          .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100),
        supabase.from('queue_presence').select('queue_entry_id, organization_id, queue_number, presence, last_seen_at')
          .eq('organization_id', organizationId),
      ])
      if (disposed) return
      if (!activityResult.error) setEvents((activityResult.data ?? []) as AdminActivityEvent[])
      if (!presenceResult.error) applyPresence((presenceResult.data ?? []) as QueuePresence[])
    }

    const channel = supabase
      .channel(`admin-operations:${organizationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'activity_log', filter: `organization_id=eq.${organizationId}`,
      }, (payload) => {
        if (payload.eventType !== 'INSERT') return
        const event = payload.new as AdminActivityEvent
        setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 100))
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue_presence', filter: `organization_id=eq.${organizationId}`,
      }, (payload) => {
        const row = payload.new as QueuePresence
        applyPresence(payload.eventType === 'DELETE'
          ? presenceRef.current.filter((item) => item.queue_entry_id !== (payload.old as QueuePresence).queue_entry_id)
          : [row, ...presenceRef.current.filter((item) => item.queue_entry_id !== row.queue_entry_id)])
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue_entries', filter: `organization_id=eq.${organizationId}`,
      }, () => void load())
      .subscribe((nextStatus) => {
        if (nextStatus === 'SUBSCRIBED') {
          setStatus('connected')
          if (connectedOnce) void load()
          connectedOnce = true
          return
        }
        if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') {
          setStatus(connectedOnce ? 'reconnecting' : 'disconnected')
        }
      })

    const initialClock = window.setTimeout(() => setNow(Date.now()), 0)
    const stalePresenceTimer = window.setInterval(() => {
      const currentTime = Date.now()
      setNow(currentTime)
      const offlineEvents: AdminActivityEvent[] = []
      for (const item of presenceRef.current) {
        const key = `${item.queue_entry_id}:${item.last_seen_at}`
        if (item.presence !== 'OFFLINE' && currentTime - new Date(item.last_seen_at).getTime() > 90_000 && !offlineNotified.current.has(key)) {
          offlineNotified.current.add(key)
          offlineEvents.push({
            id: `presence-offline:${key}`,
            action: 'STUDENT_OFFLINE',
            details: { queue_number: item.queue_number },
            created_at: new Date(currentTime).toISOString(),
          })
        }
      }
      if (offlineEvents.length) setEvents((events) => [...offlineEvents.reverse(), ...events].slice(0, 100))
    }, 15_000)

    void load()
    return () => {
      disposed = true
      window.clearTimeout(initialClock)
      window.clearInterval(stalePresenceTimer)
      setStatus('disconnected')
      void supabase.removeChannel(channel)
    }
  }, [organizationId])

  function clearEvents() {
    setEvents([])
  }

  return { events, presence, status, now, clearEvents }
}
