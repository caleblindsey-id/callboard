// CallBoard service worker — Web Push only (no offline caching). Shows the
// notification pushed by the server and, on click, focuses an existing CallBoard
// tab or opens the deep link. Kept deliberately minimal: this app is online-only,
// so the SW exists solely to receive push events.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'CallBoard', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'CallBoard'
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,        // collapse duplicates (e.g. re-assign same ticket)
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing CallBoard tab and navigate it to the target.
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client && target) {
            try { client.navigate(target) } catch { /* cross-origin guard */ }
          }
          return
        }
      }
      // No open tab — open a new one.
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
