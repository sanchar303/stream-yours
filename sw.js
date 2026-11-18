/* Stream Yours' — service worker
 *
 * Goals: faster repeat visits, installable PWA, and an offline-capable app shell.
 * Non-goals: it never touches Firebase, WebRTC, /api/*, or video data.
 *
 * BUILD_ID is stamped automatically by `npm run build` (scripts/build.mjs). If you deploy by hand,
 * change it to any new string so visitors pick up the new files.
 */
const BUILD_ID = 'dev';
const SHELL_CACHE = `sy-shell-${BUILD_ID}`;
const RUNTIME_CACHE = 'sy-runtime-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'favicon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/mp4box-0.5.2.all.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* cache:'reload' bypasses the HTTP cache so a new build never precaches stale files */
    await Promise.all(SHELL_FILES.map(async (file) => {
      try {
        const res = await fetch(new Request(file, { cache: 'reload' }));
        if (res.ok) await cache.put(file, res);
      } catch (e) { /* offline during install: skip, runtime caching will fill in */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => (k.startsWith('sy-shell-') && k !== SHELL_CACHE))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSameOrigin(url) { return url.origin === self.location.origin; }

/* Network first, fall back to cache: visitors always get the newest build when online. */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fresh = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    throw e;
  }
}

/* Cache first for files that never change under the same URL (versioned vendor files, icons, Firebase SDK). */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(request, fresh.clone()).catch(() => {});
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);

  /* Firebase SDK files are versioned in the URL and served with CORS, so they are safe to keep. */
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE).catch(() => fetch(request)));
    return;
  }

  if (!isSameOrigin(url)) return;                        /* realtime database, STUN/TURN, etc: never intercepted */
  if (url.pathname.startsWith('/api/')) return;           /* TURN credentials must always be fresh */
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE).catch(() => fetch(request)));
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE, 4000).catch(() => fetch(request)));
});
