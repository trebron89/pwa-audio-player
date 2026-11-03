// Service worker: zapisuje pliki aplikacji, żeby działała offline.
// Strategia: pliki aplikacji najpierw z sieci (aktualizacja od razu),
// bez sieci z pamięci; ikony najpierw z pamięci.
const CACHE = 'nplayer-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './tags.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' – zawsze świeże pliki z sieci, z pominięciem cache HTTP
  // (GitHub Pages wysyła max-age=600, przez co nowa wersja mogła dostać stary app.js).
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pliki aplikacji: najpierw sieć (nowa wersja od razu), bez sieci – kopia z pamięci.
// Pozostałe (ikony): najpierw pamięć.
const APP_FILE = /\.(html|js|css|webmanifest)$/;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isApp = req.mode === 'navigate' || url.pathname.endsWith('/') || APP_FILE.test(url.pathname);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromCache = async () => (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    const fromNetwork = () => fetch(req, isApp ? { cache: 'no-cache' } : undefined)
      .then(res => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      });
    const offline = () => new Response('Brak połączenia', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    if (isApp) {
      try {
        return await fromNetwork();
      } catch {
        return (await fromCache()) || offline();
      }
    }
    const cached = await fromCache();
    if (cached) {
      event.waitUntil(fromNetwork().catch(() => null));
      return cached;
    }
    return fromNetwork().catch(offline);
  })());
});
