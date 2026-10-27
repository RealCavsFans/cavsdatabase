/* cavs_db service worker: offline mode.
   - Season archive files (live-archive/<season>/season*.json and p/<id>.json): saved copy first, refreshed in the background.
   - Pages and data (html, json): network first, so they're always fresh; the last saved copy is used when offline or very slow.
   - Built files (/a/ app js/css, fonts, icons, headshots, logos): cache first; their names change whenever their contents do.
   - On install it saves the home page and the files it needs, so the site opens offline after one visit.
   - Pages fall back to any saved page shell (the app draws every route from one page), then to a small offline note.
   OneSignal web push (alerts) runs inside this same worker. */
/* in a try, so a blocked or unreachable OneSignal (ad blockers, no network) never stops offline mode from installing */
try { importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); } catch (_) {}
const PAGES = 'cdb-pages-v2', STATIC = 'cdb-static-v2', ARCH = 'cdb-arch-v1', KEEP = [PAGES, STATIC, ARCH];
const CORE = ['/', '/schedule', '/roster', '/cap', '/videos.json', '/box.json', '/news.json', '/icon-192.png', '/site.webmanifest', '/favicon.svg'];
const MAX_PAGES = 120, MAX_STATIC = 400, SLOW = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const pc = await caches.open(PAGES), sc = await caches.open(STATIC);
    await Promise.all(CORE.map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok && pc.put(u, r.clone()).then(() => r)).catch(() => null)));
    /* the home page names the current app files; save them too */
    try {
      const html = await (await pc.match('/'))?.text() || '';
      const assets = [...new Set([...html.matchAll(/(?:href|src)="(\/(?:a|fonts)\/[^"]+)"/g)].map(m => m[1]))];
      await Promise.all(assets.map(u => sc.add(u).catch(() => null)));
    } catch (_) {}
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !KEEP.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const trim = async (name, max) => { const c = await caches.open(name); const k = await c.keys(); if (k.length > max) await Promise.all(k.slice(0, k.length - max).map(x => c.delete(x))); };
const isStatic = p => /^\/(a|fonts|img|logos)\//.test(p) || /\.(woff2|svg|ico|webp|jpg|png)$/.test(p) && !/^\/og\//.test(p);
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · cavs_db</title><body style="font:16px system-ui;padding:40px 20px;text-align:center;color:#101419;background:#f7f5f2"><h1 style="color:#860038">You’re offline</h1><p>This page hasn’t been saved on this device yet. Pages you’ve opened before work offline.</p><p><a href="/" style="color:#860038">Go to the home page</a></p>';

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (u.pathname === '/sw.js') return;
  /* season archive files (season.json, the period files, per-player files): show the saved copy at once and refresh it in the background */
  if (/^\/live-archive\/[^/]+\/(season(-p-[a-z0-9]+)?\.json|p\/[^/]+\.json)$/.test(u.pathname)) {
    const key = new Request(u.origin + u.pathname);
    e.respondWith(caches.open(ARCH).then(c => c.match(key).then(m => {
      const net = fetch(r).then(res => { if (res.ok) { c.put(key, res.clone()); trim(ARCH, 60); } return res; });
      if (m) { e.waitUntil(net.catch(() => null)); return m; }
      return net;
    })));
    return;
  }
  if (isStatic(u.pathname)) {
    /* app files and fonts never change under the same name: cache first. Other images: show the saved copy, refresh it in the background. */
    const fixed = /^\/(a|fonts)\//.test(u.pathname);
    e.respondWith(caches.open(STATIC).then(c => c.match(r).then(m => {
      const net = fetch(r).then(res => { if (res.ok) { c.put(r, res.clone()); trim(STATIC, MAX_STATIC); } return res; });
      if (m) { if (!fixed) e.waitUntil(net.catch(() => null)); return m; }
      return net;
    })));
    return;
  }
  const isPage = r.mode === 'navigate' || /\.(html|json)$/.test(u.pathname);
  if (!isPage) return;
  e.respondWith((async () => {
    const c = await caches.open(PAGES);
    const net = fetch(r).then(res => { if (res.ok) { c.put(r, res.clone()); trim(PAGES, MAX_PAGES); } return res; });
    /* if the network is very slow and we have a saved copy, show that instead of waiting */
    const saved = c.match(r, { ignoreSearch: r.mode === 'navigate' });
    const slow = new Promise(res => setTimeout(async () => res(await saved), SLOW));
    try {
      const res = await Promise.race([net, slow.then(m => m || net)]);
      if (res) return res;
    } catch (_) {}
    const m = await saved; if (m) return m;
    if (r.mode === 'navigate') { const shell = await c.match('/') || await c.match('/schedule') || await c.match('/roster'); if (shell) return shell; return new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
    return Response.error();
  })());
});
