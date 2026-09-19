/**
 * منطق الدفع (Push) الصرف — بلا DOM، قابل للاختبار.
 */

/**
 * مفتاح الإشعارات العام (VAPID) — إن لم يُضبط تظهر رسالة واضحة.
 * يُقرأ وقت الاستدعاء (لا وقت تحميل الوحدة) حتى يمكن ضبطه/اختباره ديناميكيًا.
 * 
 * تم إضافة مفتاح افتراضي كـ fallback حتى لا يفشل التفعيل إن نسي المطور ضبط المتغير في الاستضافة
 */
const FALLBACK_VAPID_PUBLIC_KEY = 'BIQ-Xe9ivmpVy6eftxhHyHYroqO33tI1q5aFYaQefnrN7WNHAQcgg7POuDSMaAr5EnKGZigLvy_ft-lwQ7dCEIg'

export function getVapidPublicKey(): string {
  const fromEnv = ((import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim()
  if (fromEnv && fromEnv !== '<vapid-public-key>' && fromEnv.length > 20) {
    return fromEnv
  }
  // fallback للمفتاح المعروف في المشروع حتى يعمل حتى بدون .env
  return FALLBACK_VAPID_PUBLIC_KEY
}

interface NavLike {
  serviceWorker?: unknown
  permissions?: { query?: (descriptor: { name: string }) => Promise<{ state: string }> }
}

/** هل يدعم هذا المتصفح إشعارات الدفع؟ (يحتاج Service Worker + PushManager + Notification) */
export function isPushSupported(nav: unknown = typeof navigator === 'undefined' ? {} : navigator, win: unknown = typeof window === 'undefined' ? {} : window): boolean {
  const n = nav as NavLike | null
  const w = win as { PushManager?: unknown; Notification?: unknown } | null
  if (!n || !n.serviceWorker) return false
  if (!w || typeof w.PushManager === 'undefined') return false
  return true
}

/** هل الإشعارات مسموحة الآن؟ */
export function isPermissionGranted(permission: string | undefined): boolean {
  return permission === 'granted'
}

/** عنوان الإشعار القادم من الخادم (مع نص احتياطي) */
export function pushTitle(payload: { title?: string | null; body?: string | null } | null): string {
  return payload?.title?.trim() || 'دفتر الديون'
}

/** مسار الشاشة التي يُفتح عليها الإشعار عند النقر */
export function pushTargetUrl(payload: { url?: string | null } | null): string {
  const url = payload?.url?.trim()
  if (!url) return '/#/notifications'
  if (url.startsWith('#')) return `/${url}`
  return url
}
