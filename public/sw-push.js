/* Service Worker Push & Notification Click Handler for Yemen Task */

self.addEventListener('push', function (event) {
  if (!event.data) return;

  var payload = {};
  try {
    payload = event.data.json();
  } catch (e) {
    payload = {
      title: 'Yemen Task - كسب اليمن',
      body: event.data.text ? event.data.text() : 'لديك إشعار جديد في منصة Yemen Task',
    };
  }

  var title = payload.title || 'Yemen Task - كسب اليمن';
  var options = {
    body: payload.body || 'تم تحديث حالة أحد نشاطاتك في المنصة.',
    icon: payload.icon || '/pwa-192x192.png?v=3',
    badge: payload.badge || '/pwa-192x192.png?v=3',
    dir: 'rtl',
    lang: 'ar',
    tag: payload.tag || 'yemen-task-notification',
    renotify: true,
    vibrate: [120, 60, 120],
    data: {
      url: payload.url || '/dashboard',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && targetUrl) {
            client.navigate(targetUrl).catch(function () {});
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
