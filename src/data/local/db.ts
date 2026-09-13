/**
 * قاعدة البيانات المحلية (IndexedDB) — تخزين دائم على الجهاز
 *
 * تُستخدم في وضع الدفتر الشخصي (بلا حساب سحابي) وكطبقة قراءة فورية
 * وطابور عمليات عند انقطاع الإنترنت في وضع Supabase.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { AppError } from '@/core/errors'

export const DB_NAME = 'dafatar-db'
/**
 * إصدار المخطّط. لا نرفعه إلا عند إضافة مخزن جديد فعلًا:
 * رفع الإصدار مع وجود تبويب قديم مفتوح يجعل فتح القاعدة ينتظر للأبد،
 * وهو سبب توقّف التطبيق عند شاشة البداية سابقًا.
 * النسخة الاحتياطية تُخزَّن في مخزن `meta` (بلا حاجة لترقية).
 */
export const DB_VERSION = 1

/** المهلة القصوى لفتح القاعدة قبل الانتقال إلى الفتح بأي إصدار متاح */
export const DB_OPEN_TIMEOUT_MS = 2_500

export interface UserRow {
  id: string
  email: string
  passwordHash: string
  salt: string
  createdAt: string
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface OutboxRow {
  id: string
  /** نوع العملية: create_entry · confirm_entry · reject_entry · create_party ... */
  op: string
  payload: unknown
  userId: string
  clientRef: string
  createdAt: string
  attempts: number
  lastError: string | null
  status: 'queued' | 'sending' | 'failed'
}

interface DafatarDB extends DBSchema {
  users: { key: string; value: UserRow; indexes: { email: string } }
  profiles: { key: string; value: Record<string, unknown> }
  parties: { key: string; value: Record<string, unknown>; indexes: { ownerId: string; 'ownerId_kind': string } }
  entries: {
    key: string
    value: Record<string, unknown>
    indexes: {
      ownerId: string
      partyId: string
      merchantUserId: string
      customerUserId: string
      relationshipId: string
      clientRef: string
      occurredAt: string
    }
  }
  linkRequests: { key: string; value: Record<string, unknown>; indexes: { token: string; merchantUserId: string } }
  relationships: { key: string; value: Record<string, unknown>; indexes: { merchantUserId: string; customerUserId: string } }
  balanceProposals: { key: string; value: Record<string, unknown>; indexes: { relationshipId: string } }
  notifications: { key: string; value: Record<string, unknown>; indexes: { userId: string } }
  auditLogs: { key: string; value: Record<string, unknown>; indexes: { entryId: string } }
  meta: { key: string; value: MetaRow }
  outbox: { key: string; value: OutboxRow; indexes: { status: string; clientRef: string } }
}

interface StoreSpec {
  name: string
  keyPath: string
  indexes: { name: string; keyPath: string | string[]; options?: IDBIndexParameters }[]
}

/** مواصفات مخازن القاعدة — مصدر واحد للحقيقة */
const STORE_SPECS: StoreSpec[] = [
  { name: 'users', keyPath: 'id', indexes: [{ name: 'email', keyPath: 'email', options: { unique: true } }] },
  { name: 'profiles', keyPath: 'id', indexes: [] },
  {
    name: 'parties',
    keyPath: 'id',
    indexes: [
      { name: 'ownerId', keyPath: 'ownerId' },
      { name: 'ownerId_kind', keyPath: ['ownerId', 'kind'] },
    ],
  },
  {
    name: 'entries',
    keyPath: 'id',
    indexes: [
      { name: 'ownerId', keyPath: 'ownerId' },
      { name: 'partyId', keyPath: 'partyId' },
      { name: 'merchantUserId', keyPath: 'merchantUserId' },
      { name: 'customerUserId', keyPath: 'customerUserId' },
      { name: 'relationshipId', keyPath: 'relationshipId' },
      { name: 'clientRef', keyPath: 'clientRef' },
      { name: 'occurredAt', keyPath: 'occurredAt' },
    ],
  },
  {
    name: 'linkRequests',
    keyPath: 'id',
    indexes: [
      { name: 'token', keyPath: 'token' },
      { name: 'merchantUserId', keyPath: 'merchantUserId' },
    ],
  },
  {
    name: 'relationships',
    keyPath: 'id',
    indexes: [
      { name: 'merchantUserId', keyPath: 'merchantUserId' },
      { name: 'customerUserId', keyPath: 'customerUserId' },
    ],
  },
  { name: 'balanceProposals', keyPath: 'id', indexes: [{ name: 'relationshipId', keyPath: 'relationshipId' }] },
  { name: 'notifications', keyPath: 'id', indexes: [{ name: 'userId', keyPath: 'userId' }] },
  { name: 'auditLogs', keyPath: 'id', indexes: [{ name: 'entryId', keyPath: 'entryId' }] },
  { name: 'meta', keyPath: 'key', indexes: [] },
  {
    name: 'outbox',
    keyPath: 'id',
    indexes: [
      { name: 'status', keyPath: 'status' },
      { name: 'clientRef', keyPath: 'clientRef' },
    ],
  },
]

let dbPromise: Promise<IDBPDatabase<DafatarDB>> | null = null

/* ------------------------------------------------------------------
   أدوات تشخيصية (دوال نقية — قابلة للاختبار)
   ------------------------------------------------------------------ */

/** خطأ إصدار: قاعدة البيانات مفتوحة بإصدار أحدث من الإصدار المطلوب */
export function isVersionError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'VersionError'
}

/** المتصفح لا يوفّر تخزينًا محليًا (وضع تصفّح خاص أو إطار مقيّد) */
export function isStorageUnavailable(error: unknown): boolean {
  if (typeof indexedDB === 'undefined') return true
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : ''
  return name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotSupportedError'
}

export const STORAGE_BLOCKED_MESSAGE =
  'تعذّر فتح مخزن البيانات على هذا الجهاز. أغلق التطبيق في التبويبات الأخرى (أو أعد تحميلها) ثم اضغط «إعادة المحاولة».'

export const STORAGE_UNAVAILABLE_MESSAGE =
  'هذا المتصفح لا يوفّر تخزينًا محليًا (IndexedDB). جرّب متصفحًا آخر أو افتح التطبيق في نافذة مستقلة.'

/* ------------------------------------------------------------------
   الفتح
   ------------------------------------------------------------------ */

/**
 * يفتح القاعدة بإصدار محدّد، مع مهلة زمنية.
 * إذا حاولنا ترقية الإصدار وهناك تبويب قديم يمسك القاعدة، يبقى الطلب معلّقًا
 * بلا نهاية في المتصفح — لذلك نفرض مهلة ثم نكمل بفتح القاعدة بأي إصدار متاح.
 */
export function openDatabase(options: { version?: number; timeoutMs?: number; anyVersion?: boolean } = {}): Promise<IDBPDatabase<DafatarDB>> {
  const { version = DB_VERSION, timeoutMs = DB_OPEN_TIMEOUT_MS, anyVersion = false } = options
  // `undefined` في idb تعني: افتح بالإصدار الحالي بلا ترقية
  const requestedVersion = anyVersion ? undefined : version

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new AppError('not_configured', STORAGE_UNAVAILABLE_MESSAGE))
      return
    }

    let settled = false
    let request: ReturnType<typeof openDB<DafatarDB>> | null = null
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new AppError('conflict', STORAGE_BLOCKED_MESSAGE, { reason: 'blocked', version: requestedVersion }))
    }, timeoutMs)

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    try {
      request = openDB<DafatarDB>(DB_NAME, requestedVersion, {
        upgrade(db) {
          // أسماء المخازن تأتي من مواصفاتنا الثابتة (مصدر واحد للحقيقة)
          const schema = db as unknown as {
            objectStoreNames: { contains(name: string): boolean }
            createObjectStore(
              name: string,
              options: { keyPath: string },
            ): { createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): unknown }
          }
          for (const spec of STORE_SPECS) {
            if (schema.objectStoreNames.contains(spec.name)) continue
            const store = schema.createObjectStore(spec.name, { keyPath: spec.keyPath })
            for (const index of spec.indexes) {
              store.createIndex(index.name, index.keyPath, index.options)
            }
          }
        },
        blocking() {
          // تبويب أحدث يريد ترقية المخطّط: نُغلق اتصالنا فورًا حتى لا نُعطّله
          void request?.then((db) => db.close()).catch(() => undefined)
          dbPromise = null
        },
        terminated() {
          dbPromise = null
        },
      })

      request.then(
        (db) => {
          if (settled) {
            // انتهت المهلة قبلًا: لا نُبقي اتصالًا مفتوحًا بلا استخدام
            db.close()
            return
          }
          finish(() => resolve(db))
        },
        (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (isStorageUnavailable(error)) {
            reject(new AppError('not_configured', STORAGE_UNAVAILABLE_MESSAGE, { reason: 'unavailable' }))
            return
          }
          reject(error)
        },
      )
    } catch (error) {
      clearTimeout(timer)
      settled = true
      if (isStorageUnavailable(error)) {
        reject(new AppError('not_configured', STORAGE_UNAVAILABLE_MESSAGE, { reason: 'unavailable' }))
        return
      }
      reject(error)
    }
  })
}

/**
 * الفتح المرن: يجرّب الإصدار المطلوب، وإن كانت القاعدة محدّثة بإصدار أحدث أو
 * كان هناك تبويب قديم يمنع الترقية، نفتح القاعدة بأي إصدار متاح ونكمل العمل
 * بدل أن يتوقّف التطبيق.
 */
export async function openDatabaseResilient(): Promise<IDBPDatabase<DafatarDB>> {
  try {
    return await openDatabase({ version: DB_VERSION })
  } catch (error) {
    if (isStorageUnavailable(error)) throw error
    const reason = (error as { details?: { reason?: string } })?.details?.reason
    if (reason === 'blocked' || isVersionError(error)) {
      // نفتح القاعدة بأي إصدار متاح (بلا ترقية) فنكمل العمل بلا تعطّل
      return openDatabase({ anyVersion: true })
    }
    throw error
  }
}

export function getDB(): Promise<IDBPDatabase<DafatarDB>> {
  if (!dbPromise) {
    // فشل الفتح لا يُخزَّن: كل محاولة جديدة تعيد الفتح فعلًا
    dbPromise = openDatabaseResilient().catch((error: unknown) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export async function readMeta<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB()
  const row = await db.get('meta', key)
  return row ? (row.value as T) : fallback
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('meta', { key, value })
}

export async function deleteDatabase(): Promise<void> {
  // حذف القاعدة يجب أن ينجح دائمًا — ولو تعذّر فتحها
  try {
    const db = await getDB()
    db.close()
  } catch {
    /* نتجاهل: سنحذفها على أي حال */
  }
  dbPromise = null
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
