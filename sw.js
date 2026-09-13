// CryptoTA service worker — Web Push notifications for price alerts.
// Scope: whole origin. Kept minimal and dependency-free.
const CACHE = 'cryptota-v1';
const PRECACHE = [
    '/',
    '/manifest.json',
    '/apple-touch-icon.png',
    '/favicon.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Push: server sends JSON {title, body, icon, tag, url}
self.addEventListener('push', (e) => {
    let data = {};
    try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'CryptoTA', body: e.data && e.data.text() }; }
    const title = data.title || 'CryptoTA';
    const options = {
        body: data.body || '',
        icon: data.icon || '/apple-touch-icon.png',
        badge: '/favicon.png',
        tag: data.tag || 'cryptota',
        data: { url: data.url || '/' },
    };
    e.waitUntil(self.registration.showNotification(title, options));
});

// Click: focus/open the site, ideally on the alert's pair.
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = (e.notification.data && e.notification.data.url) || '/';
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) {
                if ('focus' in c) { c.focus(); return; }
            }
            return self.clients.openWindow(url);
        })
    );
});
