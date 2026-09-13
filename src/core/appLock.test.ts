/** اختبارات منطق قفل التطبيق: الباترن، الوضع، التراجع التلقائي، إعادة القفل */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPattern,
  disableLock,
  effectiveLockMode,
  hasPattern,
  isLockEnabled,
  isValidPattern,
  markHidden,
  patternToKey,
  readCredentialId,
  readLockConfig,
  readLockMode,
  setPattern,
  shouldRelock,
  verifyPattern,
  writeCredentialId,
  writeLockMode,
} from './appLock'

beforeEach(() => {
  disableLock()
  clearPattern()
})

describe('باترن الفتح', () => {
  it('يرفض الباترن الأقصر من 4 نقاط أو المكرّر', () => {
    expect(isValidPattern([0, 1, 2])).toBe(false)
    expect(isValidPattern([0, 1, 1, 2])).toBe(false)
    expect(isValidPattern([0, 1, 2, 5])).toBe(true)
    expect(isValidPattern([0, 1, 2, 5, 8, 7, 6, 3, 4])).toBe(true)
  })

  it('يخزّن الباترن مُشتقًّا ولا يخزّنه كنص صريح', async () => {
    await setPattern([0, 1, 2, 5])
    const stored = window.localStorage.getItem('dafatar.lock.pattern') ?? ''
    expect(stored.startsWith('pbkdf2$')).toBe(true)
    expect(stored).not.toContain('0-1-2-5')
    expect(hasPattern()).toBe(true)
  })

  it('يتحقق من الباترن الصحيح ويرفض الخاطئ', async () => {
    await setPattern([3, 4, 5, 8])
    await expect(verifyPattern([3, 4, 5, 8])).resolves.toBe(true)
    await expect(verifyPattern([3, 4, 5, 7])).resolves.toBe(false)
    await expect(verifyPattern([3, 4])).resolves.toBe(false)
  })

  it('يرفض تعيين باترن غير صالح', async () => {
    await expect(setPattern([1, 1])).rejects.toThrow()
  })

  it('يولّد ملحًا مختلفًا لنفس الباترن (لا تكرار في الناتج)', async () => {
    await setPattern([0, 1, 2, 5])
    const first = window.localStorage.getItem('dafatar.lock.pattern')
    await setPattern([0, 1, 2, 5])
    expect(window.localStorage.getItem('dafatar.lock.pattern')).not.toBe(first)
  })
})

describe('وضع القفل والتراجع الآمن', () => {
  it('بلا تفعيل: القفل غير مفعّل', () => {
    expect(readLockMode()).toBe('off')
    expect(isLockEnabled()).toBe(false)
    expect(effectiveLockMode()).toBe('off')
  })

  it('وضع البصمة بلا اعتماد مخزَّن يتراجع تلقائيًا إلى الباترن', async () => {
    await setPattern([0, 1, 2, 5])
    writeLockMode('biometric')
    writeCredentialId(null)
    expect(readLockConfig().mode).toBe('biometric')
    expect(effectiveLockMode()).toBe('pattern')
    expect(isLockEnabled()).toBe(true)
  })

  it('وضع البصمة مع اعتماد مخزَّن يعمل بالبصمة', () => {
    writeCredentialId('cred-123', 'بصمة هذا الجهاز')
    writeLockMode('biometric')
    expect(readCredentialId()).toBe('cred-123')
    expect(effectiveLockMode()).toBe('biometric')
  })

  it('وضع الباترن بلا باترن مخزَّن ⇒ لا قفل (لا يُحبس المستخدم خارج التطبيق)', () => {
    writeLockMode('pattern')
    clearPattern()
    expect(isLockEnabled()).toBe(false)
    expect(effectiveLockMode()).toBe('off')
  })

  it('إلغاء القفل يمسح كل شيء', async () => {
    await setPattern([0, 1, 2, 5])
    writeCredentialId('cred-1', 'بصمة')
    writeLockMode('biometric')
    disableLock()
    const config = readLockConfig()
    expect(config.mode).toBe('off')
    expect(config.hasPattern).toBe(false)
    expect(config.hasBiometric).toBe(false)
  })
})

describe('إعادة القفل بعد الغياب', () => {
  it('لا يعيد القفل قبل انقضاء مدة السماح', () => {
    const now = Date.now()
    markHidden(now)
    expect(shouldRelock(now + 5_000)).toBe(false)
  })

  it('يعيد القفل بعد انقضاء مدة السماح', () => {
    const now = Date.now()
    markHidden(now)
    expect(shouldRelock(now + 60_000)).toBe(true)
  })

  it('بلا تسجيل غياب لا إعادة قفل', () => {
    expect(shouldRelock(Date.now())).toBe(false)
  })
})

describe('مفتاح الباترن', () => {
  it('يُبنى بترتيب النقاط', () => {
    expect(patternToKey([0, 1, 2, 5])).toBe('0-1-2-5')
  })
})
