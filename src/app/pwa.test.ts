import { describe, expect, it } from 'vitest'
import { RELOAD_GUARD_KEY, shouldReloadOnControllerChange, swUrl } from './pwa'

describe('تحديث التطبيق تلقائيًا (Service Worker)', () => {
  it('لا يعيد تحميل الصفحة عند أول تثبيت', () => {
    // لا متحكّم سابق ⇒ لا شيء قديم معروض أصلًا
    expect(shouldReloadOnControllerChange({ hadController: false, alreadyReloaded: false })).toBe(false)
  })

  it('يعيد التحميل مرة واحدة عند تولّي نسخة جديدة', () => {
    expect(shouldReloadOnControllerChange({ hadController: true, alreadyReloaded: false })).toBe(true)
  })

  it('لا يدور في حلقة إعادة تحميل', () => {
    expect(shouldReloadOnControllerChange({ hadController: true, alreadyReloaded: true })).toBe(false)
  })

  it('يبني مسار الـ SW من جذر النشر في كل الحالات', () => {
    expect(swUrl('/')).toBe('/sw.js')
    expect(swUrl('')).toBe('/sw.js')
    expect(swUrl('/sub')).toBe('/sub/sw.js')
    expect(swUrl('/sub/')).toBe('/sub/sw.js')
  })

  it('يملك مفتاح حرس ثابتًا لتفادي إعادة التحميل المتكررة', () => {
    expect(RELOAD_GUARD_KEY).toBe('dafatar.sw-reloaded')
  })
})
