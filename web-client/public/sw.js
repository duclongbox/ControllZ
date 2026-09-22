/* The service worker exists for two reasons, and does as little as possible for
 * both.
 *
 *  1. Installability. Chrome will not fire `beforeinstallprompt` — the event
 *     the app's "Add to home screen" sheet waits on — unless a service worker
 *     with a fetch handler is registered.
 *  2. A page that opens at all when the phone is offline, so the app can say
 *     so itself instead of showing the browser's dinosaur.
 *
 * It is network-FIRST for everything, with the cache only as a fallback. A
 * remote-control client that silently ran a stale build against a newer
 * desktop host would be a far worse bug than a slightly slower load.
 */

const CACHE = 'remotehost-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/icon-192.png', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only plain GETs over http(s) are cacheable, and signalling is a WebSocket
  // upgrade that must never be intercepted.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/ws')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        // A deep link opened offline still has to render the app, which then
        // shows its own "no connection" cover.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/')
          if (shell) return shell
        }
        return Response.error()
      }),
  )
})
