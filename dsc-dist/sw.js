/*
 * DSC Commerce storefront service worker.
 *
 * Hand-rolled (no workbox) so it stays a plain same-origin script: the
 * site's CSP allows `script-src 'self'`, and a classic SW file needs
 * nothing more. Strategies:
 *
 *   - navigations: network-first, falling back to the cached app shell so
 *     the installed app opens even with no connection
 *   - /assets/*: cache-first — Vite emits content-hashed, immutable files
 *   - Google Fonts: stale-while-revalidate
 *   - everything else (API calls, PayPal, analytics): pass through —
 *     cart/auth/orders responses must never be served from a cache
 *
 * Bump CACHE_VERSION whenever the shell's offline contract changes; the
 * activate phase deletes superseded caches.
 */
const CACHE_VERSION = 'dsc-shell-v2';
const SHELL_URLS = ['/manifest.webmanifest', '/logo.png'];

/**
 * Precache a URL's response, discovering further static imports when it is
 * JavaScript. The built index.html only references the entry chunk — the
 * vendor bundles it statically imports are discovered from the chunk source
 * itself, so the offline copy can fully boot. Dynamic imports (`import("…")`,
 * route-level code splitting) deliberately do not match the pattern: those
 * chunks fill in through the runtime cache as users actually visit pages.
 */
async function precacheAssetGraph(cache, pendingUrls) {
  const seen = new Set();
  const pending = [...pendingUrls];
  while (pending.length > 0) {
    const url = pending.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) continue;
      await cache.put(new Request(url), response.clone());
      if (url.endsWith('.js')) {
        const source = await response.text();
        for (const match of source.matchAll(/import\s*"(\/assets\/[^"]+)"/g)) {
          pending.push(match[1]);
        }
      }
    } catch (error) {
      // A single miss cannot be allowed to wedge the install; the runtime
      // strategies still cover whatever ends up uncached.
      console.warn(`[sw] precache skipped: ${url}`, error);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      // Simple shell URLs, requested bypassing the HTTP cache so a fresh
      // install never stores a stale response. Each URL is requested
      // independently — addAll fails the whole install on one miss.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (error) {
            console.warn(`[sw] shell precache skipped: ${url}`, error);
          }
        })
      );

      // The app shell HTML (stored under both addressable forms) plus the
      // static asset graph it boots. A failed fetch here — e.g. the worker
      // installing while already offline — only costs the precache; the
      // navigations handler still caches on later online visits.
      try {
        const shell = await fetch(new Request('/index.html', { cache: 'reload' }));
        if (shell.ok) {
          await cache.put(new Request('/index.html'), shell.clone());
          await cache.put(new Request('/'), shell.clone());
          const entryAssets = new Set();
          for (const match of (await shell.text()).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
            entryAssets.add(match[1]);
          }
          await precacheAssetGraph(cache, entryAssets);
        }
      } catch (error) {
        console.warn('[sw] shell HTML precache skipped', error);
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigations: try the network, fall back to the cached shell so the
  // installed app still opens offline. The successful response is stored
  // under BOTH its own URL and '/index.html': matching the request first
  // means an offline reload replays exactly the HTML that was served while
  // online (same hashed assets, which are themselves cached), while the
  // '/index.html' copy only bootstraps sessions that never saw a navigation.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(request, response.clone());
          cache.put('/index.html', response.clone());
          return response;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match(request)) ||
            (await cache.match('/index.html')) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Content-hashed build output: immutable, so cache-first is safe.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })()
    );
    return;
  }

  // Google Fonts: serve from cache when present, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit);
        return hit || network;
      })()
    );
  }
});
