import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AdminActivityEvent = {
  id: string
  queue_id: string | null
  action: string
  details: { queue_number?: string; presence?: string; status?: string; name?: string } | null
  created_at: string
}

export type QueuePresence = {
  queue_entry_id: string
  organization_id: string
  queue_id: string | null
  queue_number: string
  presence: 'ONLINE' | 'IDLE' | 'BACKGROUND' | 'OFFLINE'
  last_seen_at: string
}

export function useAdminRealtime(organizationId: string | undefined, queueId?: string, staffScoped = false) {
  const [events, setEvents] = useState<AdminActivityEvent[]>([])
  const [presence, setPresence] = useState<QueuePresence[]>([])
  const [queueRevision, setQueueRevision] = useState(0)
  const [now, setNow] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting')
  const offlineNotified = useRef(new Set<string>())
  const presenceRef = useRef<QueuePresence[]>([])
  const scopedQueueId = staffScoped ? queueId : undefined

  useEffect(() => {
    if (!organizationId || (staffScoped && !scopedQueueId)) {
      setEvents([])
      setPresence([])
      presenceRef.current = []
      setStatus('disconnected')
      return
    }
    setEvents([])
    setPresence([])
    presenceRef.current = []
    let connectedOnce = false
    let disposed = false
    const applyPresence = (next: QueuePresence[]) => {
      presenceRef.current = next
      setPresence(next)
    }

    const load = async () => {
      let activityQuery = supabase.from('activity_log')
        .select('id, queue_id, action, details, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(100)
      let presenceQuery = supabase.from('queue_presence')
        .select('queue_entry_id, organization_id, queue_id, queue_number, presence, last_seen_at')
        .eq('organization_id', organizationId)
      if (scopedQueueId) {
        activityQuery = activityQuery.eq('queue_id', scopedQueueId)
        presenceQuery = presenceQuery.eq('queue_id', scopedQueueId)
      }
      const [activityResult, presenceResult] = await Promise.all([activityQuery, presenceQuery])
      if (disposed) return
      if (!activityResult.error) setEvents((activityResult.data ?? []) as AdminActivityEvent[])
      if (!presenceResult.error) applyPresence((presenceResult.data ?? []) as QueuePresence[])
    }

    const scopeFilter = scopedQueueId ? `queue_id=eq.${scopedQueueId}` : `organization_id=eq.${organizationId}`
    const channel = supabase
      .channel(`admin-operations:${organizationId}:${scopedQueueId ?? 'organization'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'activity_log', filter: scopeFilter,
      }, (payload) => {
        if (payload.eventType !== 'INSERT') return
        const event = payload.new as AdminActivityEvent
        if (scopedQueueId && event.queue_id !== scopedQueueId) return
        setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 100))
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue_presence', filter: scopeFilter,
      }, (payload) => {
        const row = payload.new as QueuePresence
        if (scopedQueueId && row.queue_id !== scopedQueueId) return
        applyPresence(payload.eventType === 'DELETE'
          ? presenceRef.current.filter((item) => item.queue_entry_id !== (payload.old as QueuePresence).queue_entry_id)
          : [row, ...presenceRef.current.filter((item) => item.queue_entry_id !== row.queue_entry_id)])
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue_entries', filter: scopeFilter,
      }, () => {
        setQueueRevision((value) => value + 1)
        void load()
      })
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
            queue_id: item.queue_id,
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
  }, [organizationId, scopedQueueId, staffScoped])

  function clearEvents() {
    setEvents([])
  }

  return {
    events: scopedQueueId ? events.filter((event) => event.queue_id === scopedQueueId) : events,
    presence: scopedQueueId ? presence.filter((item) => item.queue_id === scopedQueueId) : presence,
    status,
    now,
    queueRevision,
    clearEvents,
  }
}
