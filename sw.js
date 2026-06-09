const CACHE = 'zyntra-fc-v12';
// index.html FORA do cache â€” sempre baixa o mais recente da internet
const ASSETS = [
  '/zyntra-fc/mobile.css',
  '/zyntra-fc/manifest.json',
  '/zyntra-fc/icon-192.png',
  '/zyntra-fc/icon-512.png',
  '/zyntra-fc/_files/css2',
  '/zyntra-fc/_files/zyntra-logo.png',
  '/zyntra-fc/_files/zyntra-logo.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // index.html: SEMPRE da rede â€” nunca do cache
  if (url.endsWith('/zyntra-fc/') || url.includes('/zyntra-fc/index.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('/zyntra-fc/index.html'))
    );
    return;
  }

  // data.json: rede primeiro, fallback cache
  if (url.includes('data.json')) {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Fontes: cache permanente
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // Todo o resto: cache primeiro
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res && res.status === 200) {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    }))
  );
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'Zyntra FC', body: 'Nova notificaÃ§Ã£o' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'Zyntra FC', {
      body: data.body || '',
      icon: '/zyntra-fc/icon-192.png',
      badge: '/zyntra-fc/icon-192.png',
      tag: data.tag || 'zyntra-fc',
      data: data
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      for (const c of cls) {
        if (c.url.includes('/zyntra-fc/') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/zyntra-fc/');
    })
  );
});

