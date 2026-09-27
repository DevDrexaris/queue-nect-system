import { useEffect, useRef } from 'react'
import { supabaseAnon } from '../lib/supabase'
import { readStoredTicket } from '../lib/ticket'

type Presence = 'ONLINE' | 'IDLE' | 'BACKGROUND' | 'OFFLINE'
const IDLE_AFTER_MS = 2 * 60 * 1000
const HEARTBEAT_MS = 45 * 1000

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token)
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function useStudentQueueRealtime(onChange: () => void, enabled = true) {
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
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void updatePresence('BACKGROUND')
      else markActive()
    }
    const onPageHide = () => {
      if (document.visibilityState === 'visible') void updatePresence('OFFLINE')
    }
    const onPageShow = () => markActive()
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

    void hashToken(ticket.statusToken).then((tokenHash) => {
      if (disposed) return
      channel = supabaseAnon
        .channel(`student-queue:${tokenHash}`, { config: { private: true } })
        .on('broadcast', { event: 'queue_status_changed' }, () => callback.current())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') callback.current()
        })
    }).catch(() => undefined)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
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
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', markActive)
      window.removeEventListener('blur', onBlur)
      for (const event of ['pointerdown', 'keydown', 'touchstart'] as const) {
        window.removeEventListener(event, markActive)
      }
      if (channel) void supabaseAnon.removeChannel(channel)
      if (document.visibilityState === 'visible') void updatePresence('OFFLINE')
    }
  }, [enabled])
}
