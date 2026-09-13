/**
 * تخزين النسخة الاحتياطية على الجهاز — **نسخة واحدة دائمًا**.
 *
 * تُحفظ في مخزن `meta` (سجل واحد بمفتاح ثابت): كل نسخة جديدة تستبدل السابقة،
 * ولا نحتاج أي ترقية لمخطّط قاعدة البيانات — وهذا يمنع أي تعطّل لتطبيق مفتوح
 * في تبويب آخر عند النشر.
 */

import { getDB, readMeta, writeMeta } from '@/data/local/db'
import { backupDayKey, formatBytes, defaultAutoBackup, type BackupMeta, type BackupPayload } from '@/core/backup'
import type { Role } from '@/core/domain'

export const ROLLING_BACKUP_ID = 'latest'
const BACKUP_KEY = 'dafatar.backup'
const AUTO_KEY = 'dafatar.backup-auto'

/** سجل النسخة الواحدة المحفوظة */
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

function toMeta(row: BackupRow): BackupMeta {
  return {
    id: row.id,
    createdAt: row.createdAt,
    dayKey: row.dayKey,
    sizeBytes: row.sizeBytes,
    counts: row.counts,
    engine: row.engine,
    profileName: row.profileName,
  }
}

export function payloadSize(payload: BackupPayload): number {
  try {
    return new Blob([JSON.stringify(payload)]).size
  } catch {
    return JSON.stringify(payload).length
  }
}

/** يحفظ نسخة جديدة بدل القديمة تمامًا */
export async function saveRollingBackup(payload: BackupPayload, profileName: string | null = null): Promise<BackupMeta> {
  const row: BackupRow = {
    id: ROLLING_BACKUP_ID,
    createdAt: payload.createdAt,
    dayKey: backupDayKey(new Date(payload.createdAt)),
    sizeBytes: payloadSize(payload),
    counts: payload.counts,
    engine: payload.engine,
    profileName: payload.profile?.fullName ?? profileName,
    payload,
  }
  await writeMeta(BACKUP_KEY, row)
  return toMeta(row)
}

export async function readBackupMeta(): Promise<BackupMeta | null> {
  const row = await readMeta<BackupRow | null>(BACKUP_KEY, null)
  return row ? toMeta(row) : null
}

export async function readRollingBackup(): Promise<{ meta: BackupMeta; payload: BackupPayload } | null> {
  const row = await readMeta<BackupRow | null>(BACKUP_KEY, null)
  if (!row) return null
  return { meta: toMeta(row), payload: row.payload as BackupPayload }
}

export async function clearRollingBackup(): Promise<void> {
  const db = await getDB()
  await db.delete('meta', BACKUP_KEY)
}

/* ============================ تفضيل النسخ التلقائي ============================ */

interface AutoPref {
  enabled: boolean | null
}

export async function readAutoBackupEnabled(role: Role): Promise<boolean> {
  const stored = await readMeta<AutoPref | null>(AUTO_KEY, null)
  if (!stored || stored.enabled === null || stored.enabled === undefined) return defaultAutoBackup(role)
  return stored.enabled
}

export async function writeAutoBackupEnabled(enabled: boolean): Promise<void> {
  await writeMeta(AUTO_KEY, { enabled })
}

/** وصف مختصر لحجم النسخة المحفوظة */
export function describeBackup(meta: BackupMeta): string {
  return `${meta.counts.parties} طرف · ${meta.counts.entries} عملية · ${formatBytes(meta.sizeBytes)}`
}
