/**
 * اختبارات مقاومة مخزن البيانات.
 *
 * تحرس هذه الاختبارات العطل الذي أوقف التطبيق عند شاشة البداية:
 * عندما يُطلب مخطّط بإصدار غير متوافق مع القاعدة الموجودة، كان طلب الفتح
 * يبقى معلّقًا في المتصفح بلا نهاية ⇒ يتجمّد التطبيق على شاشة البداية.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@/core/errors'
import {
  DB_NAME,
  DB_VERSION,
  STORAGE_UNAVAILABLE_MESSAGE,
  deleteDatabase,
  getDB,
  isStorageUnavailable,
  isVersionError,
  openDatabase,
  openDatabaseResilient,
  readMeta,
  writeMeta,
} from './db'

/** ينشئ القاعدة كاملة بأي إصدار (كما لو أنشأها إصدار أحدث من التطبيق) */
async function createSchemaAt(version: number): Promise<void> {
  const db = await openDatabase({ version, timeoutMs: 2_000 })
  db.close()
}

beforeEach(async () => {
  await deleteDatabase()
})

afterEach(async () => {
  await deleteDatabase()
})

describe('فتح مخزن البيانات', () => {
  it('يفتح القاعدة ويكتب ويقرأ في مخزن meta', async () => {
    const db = await getDB()
    expect(db.name).toBe(DB_NAME)
    await writeMeta('probe', { ok: true })
    expect(await readMeta('probe', null)).toEqual({ ok: true })
  })

  it('يفتح بأي إصدار متاح حين تكون القاعدة أحدث — بلا تعطّل وبلا انتظار', async () => {
    await createSchemaAt(DB_VERSION + 1)

    const db = await openDatabaseResilient()
    expect(db.version).toBe(DB_VERSION + 1)
    await expect(db.get('meta', 'anything')).resolves.toBeUndefined()
    db.close()
  })

  it('طلب إصدار أقل من الموجود يرفض فورًا (لا يعلّق)', async () => {
    await createSchemaAt(DB_VERSION + 1)
    const started = Date.now()
    await expect(openDatabase({ version: DB_VERSION })).rejects.toSatisfy(
      (error: unknown) => isVersionError(error),
    )
    expect(Date.now() - started).toBeLessThan(1_500)
  })

  it('رسالة واضحة إن كان التخزين المحلي غير متاح أصلًا', async () => {
    const original = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })
    try {
      await expect(openDatabase()).rejects.toMatchObject({
        code: 'not_configured',
        userMessage: STORAGE_UNAVAILABLE_MESSAGE,
      })
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true })
    }
  })

  it('الفشل لا يُخزَّن: المحاولة التالية تنجح فعلًا', async () => {
    const original = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true })
    await expect(getDB()).rejects.toThrow(AppError)

    Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true })
    const db = await getDB()
    await expect(db.get('meta', 'still-alive')).resolves.toBeUndefined()
  })

  it('أدوات التشخيص تميّز أنواع الأخطاء', () => {
    expect(isVersionError(new DOMException('إصدار', 'VersionError'))).toBe(true)
    expect(isVersionError(new Error('شيء آخر'))).toBe(false)
    expect(isVersionError(null)).toBe(false)

    expect(isStorageUnavailable(new DOMException('ممنوع', 'SecurityError'))).toBe(true)
    expect(isStorageUnavailable(new DOMException('حالة غير صالحة', 'InvalidStateError'))).toBe(true)
    expect(isStorageUnavailable(new Error('عادي'))).toBe(false)
  })
})
