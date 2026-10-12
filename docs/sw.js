// Fénycsík service worker: offline működés + Android "Megosztás" fogadása
const VERSION = 'fenycsik-v1.0.0';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest', 'flash.html',
  'fonts/archivo-var.woff',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/file-256.png',
  'js/app.js', 'js/ui.js', 'js/ble.js', 'js/protocol.js', 'js/virtual.js', 'js/store.js', 'js/engine.js',
  'js/modes.js', 'js/strip.js', 'js/picker.js', 'js/color.js', 'js/importer.js', 'js/editor.js',
  'modes/index.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    try {
      const list = await (await fetch('modes/index.json')).json();
      await cache.addAll(list.map((m) => 'modes/' + m.file));
    } catch { /* a példák nélkül is működik */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION && key !== 'fenycsik-inbox') await caches.delete(key);
    await self.clients.claim();
  })());
});

async function handleShare(request) {
  const form = await request.formData();
  const inbox = await caches.open('fenycsik-inbox');
  let i = 0;
  for (const f of form.getAll('file')) {
    if (typeof f === 'string') continue;
    const text = await f.text();
    await inbox.put(new Request(`./__inbox?i=${Date.now()}-${i++}&name=${encodeURIComponent(f.name || 'megosztott')}`), new Response(text));
  }
  const text = form.get('text');
  if (typeof text === 'string' && /^\s*[[{]/.test(text)) {
    await inbox.put(new Request(`./__inbox?i=${Date.now()}-${i++}&name=szoveg`), new Response(text));
  }
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/firmware/')) return;  // a firmware fájlokat nem tároljuk
  // "stale-while-revalidate": azonnal a tárolt változat, közben frissítünk
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') });
    const network = fetch(e.request).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
