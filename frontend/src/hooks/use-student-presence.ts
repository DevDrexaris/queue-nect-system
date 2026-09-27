import { useEffect, useRef } from 'react'
import { supabaseAnon } from '../lib/supabase'
import { readStoredTicket } from '../lib/ticket'

type Presence = 'ONLINE' | 'IDLE' | 'BACKGROUND' | 'OFFLINE'
type QueueRealtimeReason = 'realtime' | 'resume'
const IDLE_AFTER_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 45 * 1000

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token)
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function useStudentQueueRealtime(onChange: (reason?: QueueRealtimeReason) => void, enabled = true) {
  const callback = useRef(onChange)

  useEffect(() => {
    callback.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled) return
    const ticket = readStoredTicket()
    if (!ticket?.statusToken) return

    let disposed = false
    let channel: ReturnType<typeof supabaseAnon.channel> | null = null
    let presence: Presence = 'ONLINE'
    let lastActivity = Date.now()
    let heartbeat: number | undefined
    let idleCheck: number | undefined
    let blurTimer: number | undefined
    let tokenHash: string | null = null
    let reconnectTimer: number | undefined
    let lastResumeAt = 0
    let channelStatus = 'CLOSED'
    let channelConnecting = false

    const updatePresence = async (next: Presence, heartbeat = false) => {
      if (disposed || next === presence && !heartbeat) return
      presence = next
      try {
        await supabaseAnon.rpc('update_student_queue_presence', {
          p_status_token: ticket.statusToken,
          p_presence: next,
        })
      } catch {
        // Presence is best-effort and never changes queue status.
      }
    }

    const markActive = () => {
      lastActivity = Date.now()
      if (document.visibilityState === 'visible') void updatePresence('ONLINE')
    }
    const subscribe = () => {
      if (disposed || !tokenHash || channelConnecting || channelStatus === 'SUBSCRIBED') return
      channelConnecting = true
      if (channel) void supabaseAnon.removeChannel(channel)
      channel = supabaseAnon
        .channel(`student-queue:${tokenHash}`, { config: { private: true } })
        .on('broadcast', { event: 'queue_status_changed' }, (message) => {
          const payload = message?.payload as { status?: string } | undefined
          if (!payload || !['WAITING', 'CALLED', 'SERVING', 'AWAITING_RETURN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(payload.status ?? '')) {
            console.warn('[Queue-Nect] Ignoring malformed student queue realtime event.', message)
            return
          }
          callback.current('realtime')
        })
        .subscribe((status) => {
          channelStatus = status
          channelConnecting = false
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            channelConnecting = false
            console.error('[Queue-Nect] Student queue realtime connection failed:', status)
          }
        })
    }

    const reconnect = () => {
      if (disposed || document.visibilityState !== 'visible' || !navigator.onLine) return
      const now = Date.now()
      if (now - lastResumeAt < 1000) return
      lastResumeAt = now
      void updatePresence('ONLINE', true)
      callback.current('resume')
      subscribe()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void updatePresence('BACKGROUND')
      else {
        markActive()
        reconnect()
      }
    }
    const onPageShow = () => {
      markActive()
      reconnect()
    }
    const onOnline = () => reconnect()
    const onBlur = () => {
      window.clearTimeout(blurTimer)
      blurTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible' && Date.now() - lastActivity >= IDLE_AFTER_MS) {
          void updatePresence('IDLE')
        }
      }, IDLE_AFTER_MS)
    }
    const heartbeatPresence = () => {
      if (disposed) return
      const next: Presence = document.visibilityState === 'hidden'
        ? 'BACKGROUND'
        : Date.now() - lastActivity >= IDLE_AFTER_MS
          ? 'IDLE'
          : 'ONLINE'
      void updatePresence(next, true)
    }

    void hashToken(ticket.statusToken).then((nextTokenHash) => {
      if (disposed) return
      tokenHash = nextTokenHash
      subscribe()
    }).catch((caught) => console.error('[Queue-Nect] Student queue realtime setup failed:', caught))

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', markActive)
    window.addEventListener('blur', onBlur)
    for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(event, markActive, { passive: true })
    }

    heartbeat = window.setInterval(heartbeatPresence, HEARTBEAT_MS)
    idleCheck = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity >= IDLE_AFTER_MS) {
        void updatePresence('IDLE')
      }
    }, 10_000)
    void updatePresence('ONLINE')

    return () => {
      disposed = true
      window.clearInterval(heartbeat)
      window.clearInterval(idleCheck)
      window.clearTimeout(blurTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', markActive)
      window.removeEventListener('blur', onBlur)
      for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
        window.removeEventListener(event, markActive)
      }
      window.clearTimeout(reconnectTimer)
      if (channel) void supabaseAnon.removeChannel(channel)
    }
  }, [enabled])
}
