/* عامل خدمة ريحانة — الشبكة أولاً للهيكل، مع نسخة احتياطية للعمل دون اتصال */
var CACHE = 'rayhana-shift-v121';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'config.js', 'recipes.js',
             'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];

/* التثبيت: كان cache.addAll(SHELL) — وهي عملية ذرّية ترفض كلّها إن فشل
   عنوان واحد. أي تعثّر لحظيّ في ملف واحد أثناء النشر كان يُسقط تثبيت
   العامل بالكامل: لا عامل ⇒ لا شرط تثبيت للتطبيق ⇒ لا إشعارات، بصمت.
   الآن: الهيكل الأدنى (الصفحة ومنطقها) شرطٌ للنجاح، وما عداه يُحاوَل
   ولا يُسقط التثبيت إن غاب. */
var CORE = ['./', 'index.html', 'app.css', 'app.js', 'config.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(CORE).then(function () {
        return Promise.all(SHELL.filter(function (u) { return CORE.indexOf(u) < 0; })
          .map(function (u) { return c.add(u).catch(function () { }); }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* استقبال إشعارات الدفع وعرضها */
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'ريحانة', body: e.data ? e.data.text() : '' }; }
  var title = data.title || 'ريحانة';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    tag: data.tag || undefined,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // طلبات Supabase وغيرها من الأصول الخارجية: تمر مباشرة (يدير التطبيق طابور المزامنة بنفسه)
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // الشبكة أولاً حتى تصل التحديثات فوراً، والكاش عند انقطاع الاتصال
  e.respondWith(
    fetch(e.request).then(function (res) {
      /* كان يخزّن أي ردّ — بما فيه 404 و500. فلو تعثّر النشر لحظة واحدة
         خُزّن الخطأ في الكاش وبقي يُقدَّم دون اتصال إلى الأبد. الآن لا
         يُخزَّن إلا ردّ سليم من أصلنا. */
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (m) {
        return m || caches.match('index.html');
      });
    })
  );
});
