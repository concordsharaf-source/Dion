/**
 * إشعارات الويب (Web Push) — تصل والتطبيق مغلق تمامًا.
 *
 * الفكرة: المتصفح يحتفظ بقناة دفع مع خدمة الإشعارات، فنُسجّل الاشتراك في قاعدة البيانات،
 * وترسله Edge Function عند كل إشعار جديد (دين/سداد/طلب ربط/تأكيد/رفض).
 *
 * في الوضع المحلي (بلا حساب سحابي) لا يوجد خادم يُرسل، فالزر يظهر مع تنبيه واضح.
 */

import { getVapidPublicKey, isPushSupported } from '@/core/push'

import type { PushPort, StoredPushSubscription } from '@/data/port'

export type { PushPort, StoredPushSubscription }

export type PushEnableResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'local' | 'missing-key' | 'failed'; message: string }

/** هل يمكن لهذا الجهاز/المتصفح استقبال إشعارات الدفع؟ */
export function pushSupported(nav: unknown = navigator, win: unknown = window): boolean {
  return isPushSupported(nav, win)
}

/** طلب إذن الإشعارات من المستخدم */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.requestPermission()
}

/** تحويل اشتراك المتصفح إلى صيغة الحفظ */
export function toStored(sub: PushSubscription): StoredPushSubscription {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    userAgent: typeof navigator !== 'undefined' ? (navigator.userAgent ?? null) : null,
  }
}

/** مفتاح VAPID العام يُحوَّل من base64url إلى Uint8Array كما يتطلب المتصفح */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/**
 * تفعيل الإشعارات: إذن ⇒ اشتراك في المتصفح ⇒ حفظ في قاعدة البيانات.
 */
export async function enablePush(push: PushPort | undefined): Promise<PushEnableResult> {
  if (!push) {
    return {
      ok: false,
      reason: 'local',
      message: 'الإشعارات الفورية تحتاج حسابًا سحابيًا مربوطًا (تُرسل من الخادم).',
    }
  }
  if (!pushSupported()) {
    return { ok: false, reason: 'unsupported', message: 'هذا المتصفح لا يدعم الإشعارات الفورية.' }
  }
  const vapid = getVapidPublicKey()
  if (!vapid) {
    return { ok: false, reason: 'missing-key', message: 'لم يُضبط مفتاح الإشعارات (VAPID) في إعدادات التطبيق.' }
  }

  const permission = await requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied', message: 'لم يُسمح بالإشعارات — فعّلها من إعدادات المتصفح ثم أعد المحاولة.' }
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as unknown as BufferSource,
      }))
    const stored = toStored(subscription)
    await push.saveSubscription(stored)
    return { ok: true, endpoint: stored.endpoint }
  } catch {
    return { ok: false, reason: 'failed', message: 'تعذّر تفعيل الإشعارات على هذا الجهاز.' }
  }
}

/** إيقاف الإشعارات: إلغاء اشتراك المتصفح وحذفه من قاعدة البيانات */
export async function disablePush(push: PushPort | undefined): Promise<boolean> {
  if (!pushSupportAvailable()) return true
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return true
    const endpoint = subscription.endpoint
    await subscription.unsubscribe()
    await push?.removeSubscription(endpoint)
    return true
  } catch {
    return false
  }
}

/** هل المتصفح يدعم اشتراكات الدفع أصلًا؟ */
function pushSupportAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}
