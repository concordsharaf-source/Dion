/**
 * تذكّر الوجهة التي طلبها المستخدم قبل تسجيل الدخول (مثل رابط ربط بحساب تاجر)
 * حتى لا يفقدها بعد إتمام الإعداد أو الدخول.
 */
const KEY = 'dafatar.pending-route'

export function rememberPendingRoute(route: string): void {
  try {
    if (route && route !== '/' && route.startsWith('/')) sessionStorage.setItem(KEY, route)
  } catch {
    /* ignore */
  }
}

export function consumePendingRoute(): string {
  try {
    const value = sessionStorage.getItem(KEY)
    if (value && value.startsWith('/')) {
      sessionStorage.removeItem(KEY)
      return value
    }
  } catch {
    /* ignore */
  }
  return '/'
}

export function clearPendingRoute(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
