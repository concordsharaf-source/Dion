/**
 * النسخة الاحتياطية — المنطق النقي (بلا تخزين وبلا واجهة).
 *
 * سياسة النسخ: **نسخة واحدة دائمًا** — كل نسخة جديدة تستبدل السابقة،
 * وتُؤخذ تلقائيًا لكل حساب (تاجر أو عميل) في نهاية كل يوم وبعد كل تغيير
 * في البيانات (وتُستبدل نسخة اليوم السابق).
 */

import { appError } from '@/core/errors'
import type { FinancialEntry, Party, Role } from '@/core/domain'

export const BACKUP_APP_ID = 'dafatar-adyoon'
export const BACKUP_VERSION = 1

/** معرّفات قديمة مقبولة عند القراءة (نسخ صدّرها إصدار سابق) */
const LEGACY_APP_IDS = ['دفتر الديون', 'dafatar', 'daftar-adyoon']

export interface BackupPayload {
  app: string
  version: number
  createdAt: string
  deviceRef: string | null
  engine: string
  profile: { id: string; fullName: string; role: Role; currency: string } | null
  parties: Party[]
  entries: FinancialEntry[]
  counts: { parties: number; entries: number }
}

export interface BackupMeta {
  id: string
  createdAt: string
  /** يوم النسخة بالتوقيت المحلي (YYYY-MM-DD) */
  dayKey: string
  sizeBytes: number
  counts: { parties: number; entries: number }
  engine: string
  profileName: string | null
}

/* ============================ البناء والقراءة ============================ */

export function buildBackupPayload(input: {
  profile: { id: string; fullName: string; role: Role; currency: string } | null
  parties: Party[]
  entries: FinancialEntry[]
  engine: string
  deviceRef?: string | null
  now?: Date
}): BackupPayload {
  const createdAt = (input.now ?? new Date()).toISOString()
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    createdAt,
    deviceRef: input.deviceRef ?? null,
    engine: input.engine,
    profile: input.profile,
    parties: input.parties,
    entries: input.entries,
    counts: { parties: input.parties.length, entries: input.entries.length },
  }
}

export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2)
}

function isValidParty(value: unknown): value is Party {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Party>
  return typeof p.id === 'string' && typeof p.name === 'string' && (p.kind === 'shop' || p.kind === 'customer')
}

function isValidEntry(value: unknown): value is FinancialEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Partial<FinancialEntry>
  return (
    typeof e.id === 'string' &&
    typeof e.partyId === 'string' &&
    (e.entryType === 'debt' || e.entryType === 'payment') &&
    typeof e.amountMinor === 'number' &&
    Number.isFinite(e.amountMinor)
  )
}

/** يقرأ ملف نسخة احتياطية ويتحقق من صلاحيته */
export function parseBackup(text: string): BackupPayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw appError('validation', undefined, 'الملف ليس ملف نسخة احتياطية صالحًا.')
  }

  if (typeof raw !== 'object' || raw === null) throw appError('validation', undefined, 'الملف غير صالح.')
  const data = raw as Record<string, unknown>
  const appId = typeof data.app === 'string' ? data.app : ''
  if (appId !== BACKUP_APP_ID && !LEGACY_APP_IDS.includes(appId)) {
    throw appError('validation', undefined, 'هذا الملف ليس نسخة احتياطية من دفتر الديون.')
  }

  const version = typeof data.version === 'number' ? data.version : 0
  if (version > BACKUP_VERSION) {
    throw appError('validation', undefined, 'النسخة أُنشئت بإصدار أحدث من التطبيق — حدّث التطبيق ثم أعد المحاولة.')
  }

  const parties = Array.isArray(data.parties) ? data.parties.filter(isValidParty) : []
  const entries = Array.isArray(data.entries) ? data.entries.filter(isValidEntry) : []
  const createdAt =
    (typeof data.createdAt === 'string' && data.createdAt) ||
    (typeof data.exportedAt === 'string' && data.exportedAt) ||
    new Date().toISOString()

  const rawProfile = data.profile as Record<string, unknown> | null | undefined
  const profile =
    rawProfile && typeof rawProfile.id === 'string'
      ? {
          id: rawProfile.id,
          fullName: typeof rawProfile.fullName === 'string' ? rawProfile.fullName : '',
          role: (rawProfile.role === 'merchant' ? 'merchant' : 'customer') as Role,
          currency: typeof rawProfile.currency === 'string' ? rawProfile.currency : 'YER',
        }
      : null

  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    createdAt,
    deviceRef: typeof data.deviceRef === 'string' ? data.deviceRef : null,
    engine: typeof data.engine === 'string' ? data.engine : 'unknown',
    profile,
    parties,
    entries,
    counts: { parties: parties.length, entries: entries.length },
  }
}

/* ============================ أدوات العرض والجدولة ============================ */

/** مفتاح اليوم بالتوقيت المحلي (لا UTC) — YYYY-MM-DD */
export function backupDayKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function backupFileName(date: Date = new Date()): string {
  return `daftar-backup-${backupDayKey(date)}.json`
}

export function summarizeBackup(payload: { counts: { parties: number; entries: number } }): string {
  return `${payload.counts.parties} طرف · ${payload.counts.entries} عملية`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`
  return `${(bytes / (1024 * 1024)).toFixed(2)} ميجابايت`
}

/**
 * هل يحتاج دفتر هذا المستخدم نسخة اليوم؟
 * · النسخة اليومية التلقائية لكل الحسابات (وقابلة للإيقاف من الإعدادات)
 * · نسخة واحدة لليوم فقط — لا تكرار
 */
export function needsDailyBackup(input: {
  role: Role
  autoEnabled: boolean
  lastDayKey: string | null
  now?: Date
}): boolean {
  if (!input.autoEnabled) return false
  const today = backupDayKey(input.now ?? new Date())
  return input.lastDayKey !== today
}

/**
 * النسخة التلقائية **مفعّلة افتراضيًا لكل الحسابات** (تاجر وعميل) — ويمكن
 * إيقافها من: الإعدادات ← البيانات ← النسخة الاحتياطية.
 * (كانت للتاجر وحده، فلم تظهر أي نسخة لمن سجّل كعميل.)
 */
export function defaultAutoBackup(_role: Role): boolean {
  return true
}
