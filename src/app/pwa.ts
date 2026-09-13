/**
 * تحديث التطبيق تلقائيًا — «أي تغيير يظهر من أول تحديث للصفحة».
 *
 * المشكلة التي يحلّها هذا الملف: تطبيقات PWA تُقدّم غالبًا نسخة قديمة من الـ HTML
 * من ذاكرة Service Worker، فيحتاج المستخدم تحديثًا ثانيًا أو مسحًا للكاش.
 *
 * الحل من ثلاث جهات:
 *   1) نسخة HTML لا تُخزَّن مسبقًا (precache) أبدًا ⇒ تُقرأ من الشبكة عند كل تحديث.
 *   2) فحص تحديث الـ Service Worker عند فتح التطبيق، وعند العودة للتبويب، وكل دقيقة.
 *   3) عند تولّي نسخة جديدة من الـ SW نُعيد التحميل مرة واحدة تلقائيًا (بحرسٍ ضد الحلقة).
 *   + في وضع التطوير: إزالة أي SW قديم وتفريغ الكاشات، فما تراه هو آخر كود دائمًا.
 */

/** مفتاح حرس يمنع تكرار إعادة التحميل في نفس الجلسة */
export const RELOAD_GUARD_KEY = 'dafatar.sw-reloaded'

const UPDATE_CHECK_INTERVAL_MS = 60_000

/** هل نعيد تحميل الصفحة عند تولّي SW جديد؟ */
export function shouldReloadOnControllerChange(input: { hadController: boolean; alreadyReloaded: boolean }): boolean {
  // أول تثبيت (لا متحكّم سابق) لا يحتاج إعادة تحميل — الصفحة تعمل بالنسخة الجديدة أصلًا.
  // التحديث يحتاج إعادة تحميل، ومرة واحدة فقط حتى لا تدور حلقة.
  return input.hadController && !input.alreadyReloaded
}

/** مسار ملف الـ Service Worker من جذر النشر */
export function swUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${base}sw.js`
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function hasReloaded(): boolean {
  try {
    return safeSession()?.getItem(RELOAD_GUARD_KEY) === '1'
  } catch {
    return false
  }
}

function markReloaded(): void {
  try {
    safeSession()?.setItem(RELOAD_GUARD_KEY, '1')
  } catch {
    /* جلسة غير متاحة — نتجاهل */
  }
}

/**
 * إزالة كل الـ Service Workers القديمة وتفريغ الكاشات.
 * يعيد `true` إن كانت الصفحة متحكَّمًا بها (أي أن نسخة قديمة قد تُقدَّم الآن).
 */
export async function purgeLegacyServiceWorkers(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  const hadController = Boolean(navigator.serviceWorker.controller)

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {
    /* بعض البيئات (إطار مقيّد) تمنع الوصول */
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch {
    /* لا كاشات أو لا صلاحية */
  }

  return hadController
}

/** فحص دوري للتحديثات: عند العودة للتبويب، عند الرجوع للشبكة، وكل دقيقة */
function watchForUpdates(registration: ServiceWorkerRegistration): void {
  const check = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    void registration.update().catch(() => undefined)
  }
  window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  document.addEventListener('visibilitychange', check)
  window.addEventListener('focus', check)
  window.addEventListener('online', check)
}

/** يُستدعى مرة واحدة عند إقلاع التطبيق */
export function registerAppServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  if (import.meta.env.DEV) {
    // في التطوير: لا نُسجّل SW ولا نسمح لنسخة قديمة أن تُخفي آخر تعديلاتك
    void purgeLegacyServiceWorkers().then((hadController) => {
      if (hadController && !hasReloaded()) {
        markReloaded()
        window.location.reload()
      }
    })
    return
  }

  const hadController = Boolean(navigator.serviceWorker.controller)

  // نسخة جديدة تولّت الخدمة ⇒ الصفحة تعمل بكود/أصول قديمة ⇒ إعادة تحميل واحدة تلقائيًا
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!shouldReloadOnControllerChange({ hadController, alreadyReloaded: hasReloaded() })) return
    markReloaded()
    window.location.reload()
  })

  navigator.serviceWorker
    .register(swUrl(import.meta.env.BASE_URL), { scope: import.meta.env.BASE_URL })
    .then((registration) => {
      watchForUpdates(registration)
      return registration.update()
    })
    .catch(() => {
      /* التطبيق يعمل بلا Service Worker — لا نُفشل الإقلاع */
    })
}
