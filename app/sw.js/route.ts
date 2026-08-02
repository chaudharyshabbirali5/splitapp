/**
 * The service worker is served from a route handler, not as a static file in
 * public/, for one reason: a static sw.js has identical bytes on every deploy, so
 * the browser sees no change and never activates a new one. Injecting the deploy's
 * commit SHA makes the script genuinely differ each release, which is what triggers
 * the update. Paired with Cache-Control: no-cache, the browser always revalidates
 * the script itself.
 *
 * Scope is '/' because the script is served from the origin root.
 */

export const dynamic = 'force-dynamic';

/** Stable within a running server; on Vercel the SHA below takes over. */
const LOCAL_FALLBACK = String(Date.now());

function swSource(version: string): string {
  return `// SplitApp service worker — build ${version}
const VERSION = ${JSON.stringify(version)};
const STATIC_CACHE = 'splitapp-static-' + VERSION;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      // Take over immediately rather than waiting for every tab to close.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache from a previous build. This is what stops an old
      // deploy's assets lingering after an update.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('splitapp-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * Only content-addressed, non-sensitive assets are cacheable. Next fingerprints
 * everything under /_next/static/, so a cached entry can never be stale — a new
 * build produces new URLs.
 */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname === '/manifest.webmanifest') return true;
  if (url.pathname === OFFLINE_URL) return true;
  return /^\\/(icon-|apple-touch-icon|favicon)/.test(url.pathname)
      || /\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff2?)$/.test(url.pathname);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkOnlyWithOfflinePage(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    // Never a cached page — only this static, data-free fallback.
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Writes are never intercepted.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin, which includes every Supabase REST/Auth/Realtime call, goes
  // straight to the network and is never stored.
  if (url.origin !== self.location.origin) return;

  // Same-origin routes that carry session state or user data: always network.
  if (url.pathname.startsWith('/auth/')) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/sw.js') return;

  // Anything explicitly authenticated bypasses the worker entirely.
  if (request.headers.has('authorization')) return;

  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // App pages are network-only. They render per-user balances and expenses, so a
  // cached copy would be both stale and a leak between accounts on a shared
  // device. Offline gets the static fallback page instead of a cached screen.
  if (request.mode === 'navigate') {
    event.respondWith(networkOnlyWithOfflinePage(event));
    return;
  }

  // Everything else (RSC payloads, route data) falls through to the network
  // untouched — no respondWith means the browser handles it normally.
});
`;
}

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID ??
    LOCAL_FALLBACK;

  return new Response(swSource(version), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      // The script itself must never be served from cache, or a deploy cannot
      // roll out until the browser's 24-hour check expires.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
