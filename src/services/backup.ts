/**
 * النسخ الاحتياطي — التنسيق بين طبقة البيانات والتخزين المحلي.
 *
 * القاعدة: **نسخة واحدة دائمًا**. كل نسخة جديدة تستبدل القديمة،
 * والتاجر تُؤخذ له نسخة تلقائيًا في نهاية كل يوم (ويمكن تفعيلها لأي دور).
 */

import { appError } from '@/core/errors'
import {
  backupDayKey,
  backupFileName,
  buildBackupPayload,
  needsDailyBackup,
  parseBackup,
  serializeBackup,
  type BackupMeta,
  type BackupPayload,
} from '@/core/backup'
import type { Profile } from '@/core/domain'
import type { DataSource, RestoreResult } from '@/data/port'
import {
  readAutoBackupEnabled,
  readBackupMeta,
  readRollingBackup,
  saveRollingBackup,
  clearRollingBackup,
  writeAutoBackupEnabled,
} from './backupStore'

const DEVICE_KEY = 'dafatar.device'

export function currentDeviceRef(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_KEY)
  } catch {
    return null
  }
}

/** يجمع كل بيانات الدفتر الحالية في نسخة واحدة (بلا أي اتصال بشبكة) */
export async function collectBackup(ds: DataSource, profile: Profile | null): Promise<BackupPayload> {
  const [parties, entries] = await Promise.all([
    ds.parties.list({ includeArchived: true, limit: 5000 }),
    ds.entries.list({ status: 'all', limit: 20000 }),
  ])

  return buildBackupPayload({
    profile: profile
      ? { id: profile.id, fullName: profile.fullName, role: profile.role, currency: profile.currency }
      : null,
    parties: parties.items,
    entries: entries.items,
    engine: ds.kind,
    deviceRef: currentDeviceRef(),
  })
}

/** ينشئ نسخة جديدة **ويستبدل** السابقة */
export async function createRollingBackup(
  ds: DataSource,
  profile: Profile | null,
): Promise<{ meta: BackupMeta; payload: BackupPayload }> {
  const payload = await collectBackup(ds, profile)
  const meta = await saveRollingBackup(payload, profile?.fullName ?? null)
  return { meta, payload }
}

/** يُنزّل النسخة كملف على الجهاز */
export function downloadBackupFile(payload: BackupPayload): void {
  const blob = new Blob([serializeBackup(payload)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(new Date(payload.createdAt))
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** يستعيد من ملف نسخة احتياطية (دمج بلا حذف وبلا تكرار) */
export async function restoreFromFile(ds: DataSource, file: File): Promise<RestoreResult> {
  if (!ds.restore) {
    throw appError('validation', undefined, 'الاستعادة الكاملة متاحة في وضع الدفتر على الجهاز (بلا حساب سحابي).')
  }
  const payload = parseBackup(await file.text())
  if (payload.parties.length === 0 && payload.entries.length === 0) {
    throw appError('validation', undefined, 'النسخة لا تحتوي على أي طرف أو عملية.')
  }
  return ds.restore(payload)
}

/* ============================ النسخة اليومية ============================ */

let running = false

/**
 * نسخة اليوم إن لم تكن موجودة: تُنادى عند فتح التطبيق وعند إخفائه وعند حلول منتصف الليل.
 * تعيد النسخة المنشأة أو `null` إن لم تكن هناك حاجة.
 */
export async function maybeRunDailyBackup(ds: DataSource, profile: Profile | null): Promise<BackupMeta | null> {
  if (!profile || running) return null
  running = true
  try {
    const auto = await readAutoBackupEnabled(profile.role)
    const meta = await readBackupMeta()
    if (!needsDailyBackup({ role: profile.role, autoEnabled: auto, lastDayKey: meta?.dayKey ?? null })) return null
    const created = await createRollingBackup(ds, profile)
    return created.meta
  } catch {
    // النسخة الاحتياطية لا يجوز أن تُفشل استخدام التطبيق
    return null
  } finally {
    running = false
  }
}

/**
 * مشغّل النسخة اليومية: يتحقق كل دقيقة، وعند إخفاء التطبيق، وعند حلول منتصف الليل المحلي.
 * يعيد دالة إيقاف.
 */
export function startDailyBackupRunner(options: {
  ds: DataSource
  profile: Profile | null
  onBackup?: (meta: BackupMeta) => void
}): () => void {
  const { ds, profile, onBackup } = options
  if (!profile) return () => undefined

  let stopped = false
  let lastDay = backupDayKey()

  const run = () => {
    if (stopped) return
    void maybeRunDailyBackup(ds, profile).then((meta) => {
      if (meta && !stopped) onBackup?.(meta)
    })
  }

  // عند الفتح: يكفي أن تكون نسخة اليوم غير موجودة
  run()

  const interval = window.setInterval(() => {
    const today = backupDayKey()
    const crossedMidnight = today !== lastDay
    lastDay = today
    if (crossedMidnight) run()
  }, 60_000)

  // عند إخفاء التطبيق (الخروج من الشاشة) — يلتقط حركة آخر اليوم
  const onHidden = () => {
    if (document.visibilityState === 'hidden') run()
  }
  document.addEventListener('visibilitychange', onHidden)

  return () => {
    stopped = true
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onHidden)
  }
}

export { readRollingBackup, readBackupMeta, clearRollingBackup, readAutoBackupEnabled, writeAutoBackupEnabled }
