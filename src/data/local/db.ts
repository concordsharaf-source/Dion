/**
 * قاعدة البيانات المحلية (IndexedDB) — تخزين دائم على الجهاز
 *
 * تُستخدم في وضع الدفتر الشخصي (بلا حساب سحابي) وكطبقة قراءة فورية
 * وطابور عمليات عند انقطاع الإنترنت في وضع Supabase.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export const DB_NAME = 'dafatar-db'
export const DB_VERSION = 2

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

export interface BackupRow {
  id: string
  createdAt: string
  dayKey: string
  sizeBytes: number
  counts: { parties: number; entries: number }
  engine: string
  profileName: string | null
  payload: unknown
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
  backups: { key: string; value: BackupRow; indexes: { dayKey: string } }
  meta: { key: string; value: MetaRow }
  outbox: { key: string; value: OutboxRow; indexes: { status: string; clientRef: string } }
}

let dbPromise: Promise<IDBPDatabase<DafatarDB>> | null = null

export function getDB(): Promise<IDBPDatabase<DafatarDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DafatarDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('users')) {
          const s = db.createObjectStore('users', { keyPath: 'id' })
          s.createIndex('email', 'email', { unique: true })
        }
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' })

        if (!db.objectStoreNames.contains('parties')) {
          const s = db.createObjectStore('parties', { keyPath: 'id' })
          s.createIndex('ownerId', 'ownerId')
          s.createIndex('ownerId_kind', ['ownerId', 'kind'])
        }
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'id' })
          s.createIndex('ownerId', 'ownerId')
          s.createIndex('partyId', 'partyId')
          s.createIndex('merchantUserId', 'merchantUserId')
          s.createIndex('customerUserId', 'customerUserId')
          s.createIndex('relationshipId', 'relationshipId')
          s.createIndex('clientRef', 'clientRef', { unique: false })
          s.createIndex('occurredAt', 'occurredAt')
        }
        if (!db.objectStoreNames.contains('linkRequests')) {
          const s = db.createObjectStore('linkRequests', { keyPath: 'id' })
          s.createIndex('token', 'token')
          s.createIndex('merchantUserId', 'merchantUserId')
        }
        if (!db.objectStoreNames.contains('relationships')) {
          const s = db.createObjectStore('relationships', { keyPath: 'id' })
          s.createIndex('merchantUserId', 'merchantUserId')
          s.createIndex('customerUserId', 'customerUserId')
        }
        if (!db.objectStoreNames.contains('balanceProposals')) {
          const s = db.createObjectStore('balanceProposals', { keyPath: 'id' })
          s.createIndex('relationshipId', 'relationshipId')
        }
        if (!db.objectStoreNames.contains('notifications')) {
          const s = db.createObjectStore('notifications', { keyPath: 'id' })
          s.createIndex('userId', 'userId')
        }
        if (!db.objectStoreNames.contains('auditLogs')) {
          const s = db.createObjectStore('auditLogs', { keyPath: 'id' })
          s.createIndex('entryId', 'entryId')
        }
        if (!db.objectStoreNames.contains('backups')) {
          const s = db.createObjectStore('backups', { keyPath: 'id' })
          s.createIndex('dayKey', 'dayKey')
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('outbox')) {
          const s = db.createObjectStore('outbox', { keyPath: 'id' })
          s.createIndex('status', 'status')
          s.createIndex('clientRef', 'clientRef')
        }
      },
      blocked() {
        console.warn('[db] تحديث قاعدة البيانات محجوب بتبويب آخر')
      },
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
  const db = await getDB()
  db.close()
  dbPromise = null
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
