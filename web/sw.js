// Service Worker: offline cache + update channel for App Manager.
// Bump SW_VERSION whenever the shell changes; the browser then installs the new worker,
// App Manager shows "Cập nhật lõi", and SKIP_WAITING switches over.
const SW_VERSION = '0.9.11.0';
const SHELL_CACHE = 'hub-shell-' + SW_VERSION;
const RUNTIME_CACHE = 'hub-runtime';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('version.json', { cache: 'no-store' });
    const v = await res.json();
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(v.shell.files);
    // Pre-cache every shipped module at its current version.
    for (const [id, m] of Object.entries(v.modules)) {
      if (!m.files?.length) continue;
      const c = await caches.open(`hub-mod-${id}-${m.version}`);
      await c.addAll(m.files);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('hub-shell-') && key !== SHELL_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { event.waitUntil(onMessage(event)); });   // keeps the worker alive during long downloads

async function onMessage(event) {
  const { type } = event.data || {};
  const reply = (data) => event.ports[0]?.postMessage(data);
  if (type === 'SKIP_WAITING') return self.skipWaiting();
  if (type === 'CACHE_MODULE') {
    const { id, version, keep, files } = event.data;
    try {
      const c = await caches.open(`hub-mod-${id}-${version}`);
      await c.addAll(files.map(f => new Request(f, { cache: 'reload' })));
      // Keep the version being replaced too, so App Manager can roll back to it.
      const wanted = [`hub-mod-${id}-${version}`, `hub-mod-${id}-${keep}`];
      for (const key of await caches.keys()) {
        if (key.startsWith(`hub-mod-${id}-`) && !wanted.includes(key)) await caches.delete(key);
      }
      reply({ ok: true });
    } catch (e) { reply({ ok: false, error: e.message }); }
  }
  if (type === 'GET_VERSION') reply({ ok: true, version: SW_VERSION });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache GitHub API calls or version checks.
  if (url.host === 'api.github.com' || url.pathname.endsWith('version.json')) return;

  // Page navigations: network first so new deploys show up, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('index.html', { ignoreSearch: true })));
    return;
  }

  // Google Fonts: stale-while-revalidate.
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // App files: cache first. Module files are requested with ?v=<version>; the cache for
  // that version answers. ignoreSearch lets one cached copy serve any query string.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const v = url.searchParams.get('v');
      const modMatch = url.pathname.match(/\/js\/modules\/([^/]+)\//);
      if (v && modMatch) {
        const c = await caches.open(`hub-mod-${modMatch[1]}-${v}`);
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
      }
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(RUNTIME_CACHE)).put(req, res.clone());
      return res;
    })());
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
