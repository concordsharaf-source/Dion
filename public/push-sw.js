/* eslint-disable no-undef */
/**
 * مستقبِل إشعارات الدفع داخل Service Worker.
 * يُحمَّل من الـ SW المُولَّد (workbox importScripts) فيعمل حتى والتطبيق مغلق تمامًا.
 *
 * لا يُخزَّن أي شيء حسّاس هنا: النص القادم من الخادم يُعرض فقط، والنقر يفتح شاشة التطبيق.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = (payload.title || 'دفتر الديون').toString()
  const body = (payload.body || 'لديك تحديث في دفترك').toString()
  const target = (payload.url || '/#/notifications').toString()

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      dir: 'rtl',
      lang: 'ar',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: (payload.tag || 'daftar').toString(),
      renotify: true,
      requireInteraction: false,
      data: { url: target },
      vibrate: [90, 60, 90],
    }),
  )
})

// عند النقر: افتح التطبيق على الشاشة المطلوبة (أو ركّز نافذة مفتوحة)
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/#/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

// إغلاق الإشعار من المستخدم: لا شيء يُسجَّل
self.addEventListener('notificationclose', () => {})
