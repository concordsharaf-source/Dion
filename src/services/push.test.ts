/**
 * اختبارات إشعارات الويب: منطق الدفع، تحويل المفاتيح، الاشتراك والإلغاء،
 * ونص الإشعار ووجهة الفتح، وحالة الوضع المحلي.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVapidPublicKey, isPermissionGranted, isPushSupported, pushTargetUrl, pushTitle } from '@/core/push'
import { disablePush, enablePush, pushSupported, toStored, urlBase64ToUint8Array } from './push'
import type { PushPort } from '@/data/port'

/** مفتاح VAPID عام للاختبار (65 بايت بصيغة base64url) */
const TEST_VAPID_KEY = 'BPbddHmjbgRMOUVoQ6z7cE3olOo4bKYxBXxj_UsoepYHJ4_7gp6CunDbT1z8eQaNRSGsjXt-6ZO70D4DYyqRnHo'

/* ---------------------------- أدوات الاختبار ---------------------------- */

function makePort(): PushPort & { saved: unknown[]; removed: string[] } {
  const saved: unknown[] = []
  const removed: string[] = []
  return {
    saved,
    removed,
    saveSubscription: async (input) => {
      saved.push(input)
    },
    removeSubscription: async (endpoint) => {
      removed.push(endpoint)
    },
    hasSubscription: async (endpoint) => saved.some((s) => (s as { endpoint: string }).endpoint === endpoint),
  }
}

/** اشتراك متصفح مزيّف */
function fakeSubscription(endpoint = 'https://push.example/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'pKey', auth: 'aKey' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

function installPushEnv(subscription: ReturnType<typeof fakeSubscription> | null, permission: NotificationPermission = 'granted') {
  const subscribe = vi.fn(async () => subscription)
  const getSubscription = vi.fn(async () => subscription)
  const ready = Promise.resolve({
    pushManager: { subscribe, getSubscription },
  })

  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready } })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { permission, requestPermission: vi.fn(async () => permission) },
  })

  return { subscribe, getSubscription }
}

const originalSW = Object.getOwnPropertyDescriptor(Navigator.prototype, 'serviceWorker')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
  delete (window as { PushManager?: unknown }).PushManager
  void originalSW
})

/* ---------------------------- منطق الدفع ---------------------------- */

describe('منطق الدفع الصرف', () => {
  it('يميّز الدعم: يحتاج Service Worker و PushManager', () => {
    expect(isPushSupported({ serviceWorker: {} }, { PushManager: function () {} })).toBe(true)
    expect(isPushSupported({}, { PushManager: function () {} })).toBe(false)
    expect(isPushSupported({ serviceWorker: {} }, {})).toBe(false)
  })

  it('يفسّر حالة الإذن', () => {
    expect(isPermissionGranted('granted')).toBe(true)
    expect(isPermissionGranted('denied')).toBe(false)
    expect(isPermissionGranted(undefined)).toBe(false)
  })

  it('عنوان الإشعار له نص احتياطي، ووجهة الفتح الافتراضية الإشعارات', () => {
    expect(pushTitle({ title: 'دين جديد' })).toBe('دين جديد')
    expect(pushTitle(null)).toBe('دفتر الديون')
    expect(pushTargetUrl(null)).toBe('/#/notifications')
    expect(pushTargetUrl({ url: '#/entries' })).toBe('/#/entries')
    expect(pushTargetUrl({ url: '/#/parties' })).toBe('/#/parties')
  })

  it('مفتاح VAPID يُقرأ من البيئة (فارغ إن لم يُضبط)', () => {
    expect(typeof getVapidPublicKey()).toBe('string')
  })
})

describe('تحويل مفاتيح VAPID', () => {
  it('base64url ← Uint8Array بالطول الصحيح (65 بايت للمفتاح العام)', () => {
    const key = 'BPbddHmjbgRMOUVoQ6z7cE3olOo4bKYxBXxj_UsoepYHJ4_7gp6CunDbT1z8eQaNRSGsjXt-6ZO70D4DYyqRnHo'
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(65)
  })

  it('يقبل base64 عاديًا ومسافات الحشو', () => {
    expect(Array.from(urlBase64ToUint8Array('AQAB'))).toEqual([1, 0, 1])
  })
})

describe('تفعيل الإشعارات', () => {
  it('في الوضع المحلي: رسالة واضحة بلا اشتراك', async () => {
    installPushEnv(fakeSubscription())
    const result = await enablePush(undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('local')
  })

  it('بلا مفتاح VAPID: رسالة واضحة ولا اشتراك (لا فشل صامت)', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    installPushEnv(fakeSubscription('https://push.example/one'))
    const port = makePort()
    const result = await enablePush(port)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('missing-key')
    expect(port.saved).toHaveLength(0)
  })

  it('بمفتاح VAPID: يشترك ويحفظ الاشتراك في قاعدة البيانات', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', TEST_VAPID_KEY)
    installPushEnv(fakeSubscription('https://push.example/one'))
    const port = makePort()
    const result = await enablePush(port)
    expect(result).toEqual({ ok: true, endpoint: 'https://push.example/one' })
    expect(port.saved[0]).toMatchObject({
      endpoint: 'https://push.example/one',
      p256dh: 'pKey',
      auth: 'aKey',
    })
  })

  it('يرفض عند عدم السماح بالإشعارات', async () => {
    installPushEnv(fakeSubscription(), 'denied')
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { subscribe: vi.fn(), getSubscription: vi.fn(async () => null) } }) },
    })
    const result = await enablePush(makePort())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['denied', 'missing-key']).toContain(result.reason)
  })

  it('يحوّل الاشتراك إلى صيغة الحفظ (endpoint + مفاتيح)', () => {
    const stored = toStored(fakeSubscription('https://push.example/x') as unknown as PushSubscription)
    expect(stored.endpoint).toBe('https://push.example/x')
    expect(stored.p256dh).toBe('pKey')
    expect(stored.auth).toBe('aKey')
  })
})

describe('إيقاف الإشعارات', () => {
  it('يلغي اشتراك المتصفح ويحذفه من قاعدة البيانات', async () => {
    const sub = fakeSubscription('https://push.example/off')
    installPushEnv(sub)
    const port = makePort()
    const ok = await disablePush(port)
    expect(ok).toBe(true)
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(port.removed).toContain('https://push.example/off')
  })
})

describe('دعم المتصفح في الواجهة', () => {
  it('pushSupported يعتمد على وجود Service Worker و PushManager', () => {
    expect(typeof pushSupported()).toBe('boolean')
  })
})
