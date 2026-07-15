/* عامل خدمة ريحانة — الشبكة أولاً للهيكل، مع نسخة احتياطية للعمل دون اتصال */
var CACHE = 'rayhana-shift-v2';
var SHELL = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // طلبات Supabase وغيرها من الأصول الخارجية: تمر مباشرة (يدير التطبيق طابور المزامنة بنفسه)
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // الشبكة أولاً حتى تصل التحديثات فوراً، والكاش عند انقطاع الاتصال
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
        return m || caches.match('index.html');
      });
    })
  );
});
