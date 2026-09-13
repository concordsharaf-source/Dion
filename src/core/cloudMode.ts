/**
 * وضع الحساب السحابي — التطبيق محلي أولًا، والسحابي خيار يفعّله المستخدم.
 *
 * القاعدة: لا يُستخدم محرّك Supabase إلا إذا (1) كانت مفاتيح المشروع مضبوطة
 * في بيئة النشر، و(2) فعّل المستخدم الحساب السحابي (أو سبق أن سجّل دخولًا سحابيًا).
 * فمن لا يريد سحابةً يبقى دفتره على جهازه وحده.
 */

export const CLOUD_MODE_KEY = 'dafatar.cloud'
/** مفتاح تخزين جلسة Supabase (نفس storageKey في load.ts) */
export const CLOUD_SESSION_KEY = 'dafatar.auth'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** هل فعّل المستخدم الحساب السحابي؟ (أو سبق أن دخل بحساب سحابي) */
export function isCloudOptedIn(store: StorageLike | null = storage()): boolean {
  if (!store) return false
  try {
    if (store.getItem(CLOUD_MODE_KEY) === '1') return true
    // وجود جلسة سحابية سابقة يعني أنه اختار السحابة فعلًا
    return Boolean(store.getItem(CLOUD_SESSION_KEY))
  } catch {
    return false
  }
}

/** تفعيل الحساب السحابي (ثم يُعاد تحميل التطبيق ليعمل بالمحرّك السحابي) */
export function enableCloudMode(store: StorageLike | null = storage()): void {
  try {
    store?.setItem(CLOUD_MODE_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** فصل الحساب السحابي: يبقى الدفتر المحلي كما هو، وتُزال الجلسة السحابية */
export function disableCloudMode(store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(CLOUD_MODE_KEY)
    store?.removeItem(CLOUD_SESSION_KEY)
  } catch {
    /* ignore */
  }
}
