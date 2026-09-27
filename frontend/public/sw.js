self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data?.text() ?? '' }
  }

  const queueNumber = payload.queue_number ?? 'your queue number'
  const options = {
    body: payload.body ?? `Queue ${queueNumber} is now being called. Please proceed to the service area.`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `queue-call-${payload.queue_entry_id ?? queueNumber}`,
    renotify: false,
    data: { url: '/queue/status' },
  }

  event.waitUntil(self.registration.showNotification(payload.title ?? "Queue-Nect — You're being called", options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/queue/status', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(url)
        return client.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
