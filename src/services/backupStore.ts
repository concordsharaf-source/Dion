/**
 * تخزين النسخة الاحتياطية على الجهاز — **نسخة واحدة دائمًا**.
 * كل نسخة جديدة تحذف السابقة، فلا تتراكم ملفات ولا تمتلئ مساحة التخزين.
 */

import { getDB, readMeta, writeMeta, type BackupRow } from '@/data/local/db'
import { backupDayKey, formatBytes, type BackupMeta, type BackupPayload } from '@/core/backup'
import type { Role } from '@/core/domain'
import { defaultAutoBackup } from '@/core/backup'

export const ROLLING_BACKUP_ID = 'latest'
const AUTO_KEY = 'dafatar.backup-auto'

/* ============================ النسخة نفسها ============================ */

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
  const db = await getDB()
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

  const tx = db.transaction('backups', 'readwrite')
  const existing = await tx.store.getAllKeys()
  await Promise.all(existing.map((key) => tx.store.delete(key)))
  await tx.store.put(row)
  await tx.done

  return toMeta(row)
}

export async function readBackupMeta(): Promise<BackupMeta | null> {
  const db = await getDB()
  const row = (await db.get('backups', ROLLING_BACKUP_ID)) as BackupRow | undefined
  return row ? toMeta(row) : null
}

export async function readRollingBackup(): Promise<{ meta: BackupMeta; payload: BackupPayload } | null> {
  const db = await getDB()
  const row = (await db.get('backups', ROLLING_BACKUP_ID)) as BackupRow | undefined
  if (!row) return null
  return { meta: toMeta(row), payload: row.payload as BackupPayload }
}

export async function clearRollingBackup(): Promise<void> {
  const db = await getDB()
  await db.delete('backups', ROLLING_BACKUP_ID)
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
