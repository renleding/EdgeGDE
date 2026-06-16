const CACHE_NAME = 'edgegde-pwa-canvas-v0.3.2'
const APP_SHELL = [
  '/pwa-canvas/index.html',
  '/pwa-canvas/pwa.css',
  '/pwa-canvas/pwa.js',
  '/pwa-canvas/manifest.webmanifest',
  '/pwa-canvas/icons/favicon.svg'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET') return
  if (!url.pathname.startsWith('/pwa-canvas/')) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        event.waitUntil(fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
        }).catch(() => {}))
        return cached
      }
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    })
  )
})
