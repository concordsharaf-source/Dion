/**
 * وضع الحساب السحابي: محلي أولًا، والسحابي خيار صريح من المستخدم.
 */

import { describe, expect, it } from 'vitest'
import {
  CLOUD_MODE_KEY,
  CLOUD_SESSION_KEY,
  disableCloudMode,
  enableCloudMode,
  isCloudOptedIn,
} from './cloudMode'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

describe('وضع الحساب السحابي', () => {
  it('غير مفعّل افتراضيًا (التطبيق محلي أولًا)', () => {
    expect(isCloudOptedIn(fakeStorage())).toBe(false)
  })

  it('يُفعّل بطلب المستخدم', () => {
    const store = fakeStorage()
    enableCloudMode(store)
    expect(store.dump()[CLOUD_MODE_KEY]).toBe('1')
    expect(isCloudOptedIn(store)).toBe(true)
  })

  it('جلسة سحابية سابقة تعني أنه اختار السحابة', () => {
    const store = fakeStorage({ [CLOUD_SESSION_KEY]: '{"access_token":"x"}' })
    expect(isCloudOptedIn(store)).toBe(true)
  })

  it('الفصل يُزيل العلامة والجلسة معًا', () => {
    const store = fakeStorage({ [CLOUD_MODE_KEY]: '1', [CLOUD_SESSION_KEY]: 'x' })
    disableCloudMode(store)
    expect(isCloudOptedIn(store)).toBe(false)
    expect(store.dump()[CLOUD_SESSION_KEY]).toBeUndefined()
  })

  it('يتحمّل غياب المخزن بلا انهيار', () => {
    expect(isCloudOptedIn(null)).toBe(false)
    expect(() => enableCloudMode(null)).not.toThrow()
    expect(() => disableCloudMode(null)).not.toThrow()
  })
})
