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

/* ============================ إخراج ملف النسخة إلى الجهاز ============================ */

/**
 * طريقة حفظ الملف تختلف بين المنصات، وهذه هي المشكلة التي تُقرأ عادةً كـ«لا أجدها»:
 *   · desktop (كروم/إيدج): File System Access API ⇒ المستخدم يختار المجلد بنفسه.
 *   · iOS (سفاري/PWA مثبّت): لا تنزيل فعلي ⇒ قائمة المشاركة ← «حفظ في الملفات».
 *   · الباقي: تنزيل كلاسيكي إلى مجلد التنزيلات.
 */
export type BackupSaveMethod = 'file-picker' | 'share' | 'download'

export interface BackupSaveResult {
  method: BackupSaveMethod
  fileName: string
  /** جملة قصيرة تخبر المستخدم أين ذهب الملف بالضبط */
  hint: string
  /** أُلغيت النافذة (picker/مشاركة) ⇒ لم يُحفظ شيء ولا نُعاود التنزيل */
  cancelled: boolean
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}

interface FileSystemWritableLike {
  write(data: Blob | string): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableLike>
}

type WindowWithPicker = Window & { showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike> }
type NavigatorWithShare = Navigator & {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
}

interface BackupSaveEnv {
  hasFileSystemAccess: boolean
  canShareFiles: boolean
}

/** أفضل طريقة متاحة (نقية بلا DOM — لسهولة الاختبار) */
export function chooseBackupSaveMethod(env: BackupSaveEnv): BackupSaveMethod {
  if (env.hasFileSystemAccess) return 'file-picker'
  if (env.canShareFiles) return 'share'
  return 'download'
}

/** كيف نسمّي الطريقة للمستخدم؟ */
export function describeBackupSaveMethod(method: BackupSaveMethod): string {
  if (method === 'file-picker') return 'نافذة حفظ تختار فيها المجلد'
  if (method === 'share') return 'المشاركة ← «حفظ في الملفات» (iOS)'
  return 'تنزيل إلى مجلد التنزيلات'
}

/** أين يجد الملف بعد الحفظ بهذه الطريقة؟ */
export function describeBackupSaveLocation(method: BackupSaveMethod, fileName: string): string {
  if (method === 'file-picker') return `حُفظ الملف في المجلد الذي اخترته باسم ${fileName}`
  if (method === 'share') return `من قائمة المشاركة اختر «حفظ في الملفات» — الملف باسم ${fileName}`
  return `ستجده في مجلد التنزيلات (Downloads) باسم ${fileName}`
}

/** الطريقة التي سيُستخدم عليها هذا الجهاز/المتصفح الآن (للعرض قبل الضغط) */
export function detectBackupSaveMethod(): BackupSaveMethod {
  if (typeof window === 'undefined') return 'download'
  const picker = typeof (window as WindowWithPicker).showSaveFilePicker === 'function'
  return chooseBackupSaveMethod({ hasFileSystemAccess: picker, canShareFiles: canShareBackupFile() })
}

function canShareBackupFile(file?: File): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as NavigatorWithShare
  if (typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare(file ? { files: [file] } : { files: [new File(['{}'], 'x.json', { type: 'application/json' })] })
  } catch {
    return false
  }
}

function isUserCancellation(error: unknown): boolean {
  return error instanceof DOMException ? error.name === 'AbortError' : false
}

/**
 * يُخرج نسخة جاهزة إلى جهازك بأفضل طريقة يسمح بها المتصفح، ويعيد وصفًا لمكان الملف.
 * لا يرمي استثناءً: أي فشل غير متوقع يسقط إلى التنزيل الكلاسيكي.
 */
export async function saveBackupFile(payload: BackupPayload): Promise<BackupSaveResult> {
  const fileName = backupFileName(new Date(payload.createdAt))
  const text = serializeBackup(payload)
  const file = new File([text], fileName, { type: 'application/json' })
  const nav = typeof navigator === 'undefined' ? (undefined as unknown as NavigatorWithShare) : (navigator as NavigatorWithShare)
  const picker = typeof window === 'undefined' ? undefined : (window as WindowWithPicker).showSaveFilePicker
  const method = chooseBackupSaveMethod({ hasFileSystemAccess: typeof picker === 'function', canShareFiles: canShareBackupFile(file) })

  try {
    if (method === 'file-picker' && picker) {
      const handle = await picker.call(window as WindowWithPicker, {
        suggestedName: fileName,
        types: [{ description: 'نسخة دفتر الديون', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(new Blob([text], { type: 'application/json' }))
      await writable.close()
      return { method, fileName, hint: describeBackupSaveLocation(method, fileName), cancelled: false }
    }
    if (method === 'share' && nav?.share) {
      await nav.share({ files: [file], title: fileName })
      return { method, fileName, hint: describeBackupSaveLocation(method, fileName), cancelled: false }
    }
  } catch (error) {
    if (isUserCancellation(error)) {
      return { method, fileName, hint: 'أُلغيت العملية — لم يُحفظ أي ملف.', cancelled: true }
    }
    // مثال الفشل المتوقع: المتصفح يطلب إيماءة مستخدم ⇒ نرجع للتنزيل العادي
  }

  downloadBackupFile(payload)
  return { method: 'download', fileName, hint: describeBackupSaveLocation('download', fileName), cancelled: false }
}

/** المكان الداخلي للنسخة داخل التطبيق (يُعرض للمستخدم حتى لا يبحث عن ملف غير موجود) */
export const BACKUP_STORAGE_HINT = 'dafatar-db ← مخزن meta ← المفتاح dafatar.backup'

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

/* ============================ الاستعادة من النسخة المحفوظة على الجهاز ============================ */

export interface StoredRestoreOutcome {
  /** نتيجة الدمج */
  result: RestoreResult
  /** وصف النسخة التي استُعيدت (تاريخها ومحتواها) */
  meta: BackupMeta
}

/**
 * يستعيد **من النسخة المحفوظة داخل التطبيق** (قاعدة بيانات المتصفح) — بلا حاجة
 * إلى ملف. هذا هو المسار المفيد لمن مسح بياناته بالخطأ أو خسر جزءًا منها:
 * النسخة تبقى محفوظة في مخزن `meta` ولا يمسّها «مسح بياناتي من هذا الجهاز».
 *
 * الاستعادة **دمج آمن**: تُضاف السجلات الناقصة فقط، ولا يُحذف ولا يُستبدل شيء،
 * ولا تتكرر العملية (معرّف فريد لكل عملية) — فيمكن تكرارها بلا ضرر.
 */
export async function restoreFromStoredBackup(ds: DataSource): Promise<StoredRestoreOutcome> {
  if (!ds.restore) {
    throw appError('validation', undefined, 'الاستعادة الكاملة متاحة في وضع الدفتر على الجهاز (بلا حساب سحابي).')
  }
  const stored = await readRollingBackup()
  if (!stored) {
    throw appError(
      'not_found',
      undefined,
      'لا توجد نسخة محفوظة على هذا الجهاز بعد. تُؤخذ النسخة تلقائيًا بعد أول عملية في دفترك، أو أنشئها زر «إنشاء نسخة الآن».',
    )
  }
  if (stored.payload.parties.length === 0 && stored.payload.entries.length === 0) {
    throw appError('validation', undefined, 'النسخة المحفوظة لا تحتوي على أي طرف أو عملية.')
  }
  const result = await ds.restore(stored.payload)
  return { result, meta: stored.meta }
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
    // لا نسخة لدفتر فارغ: تكون نسخة بلا أطراف ولا عمليات بلا أي قيمة.
    // وأول طرف أو عملية تُسجَّل ⇒ تُؤخذ نسخة فورًا (انظر المهلة أدناه).
    const [parties, entries] = await Promise.all([
      ds.parties.list({ includeArchived: true, limit: 1 }),
      ds.entries.list({ status: 'all', limit: 1 }),
    ])
    if (parties.items.length === 0 && entries.items.length === 0) return null
    const created = await createRollingBackup(ds, profile)
    return created.meta
  } catch {
    // النسخة الاحتياطية لا يجوز أن تُفشل استخدام التطبيق
    return null
  } finally {
    running = false
  }
}

/** مهلة قصيرة بعد آخر تغيير في البيانات قبل أخذ النسخة */
export const BACKUP_DEBOUNCE_MS = 4_000

/**
 * مشغّل النسخة اليومية: يتحقق عند الفتح، وبعد كل تغيير في البيانات (بمهلة قصيرة
 * فلا تنتظر نهاية اليوم)، وعند إخفاء التطبيق، وعند حلول منتصف الليل المحلي.
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
  let debounce: number | null = null

  const run = () => {
    if (stopped) return
    void maybeRunDailyBackup(ds, profile).then((meta) => {
      if (meta && !stopped) onBackup?.(meta)
    })
  }

  // عند الفتح: يكفي أن تكون نسخة اليوم غير موجودة
  run()

  // بعد أي تغيير في البيانات: محاولة مؤجّلة قليلًا (تنجح مرة واحدة في اليوم)
  const schedule = () => {
    if (stopped) return
    if (debounce !== null) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => {
      debounce = null
      run()
    }, BACKUP_DEBOUNCE_MS)
  }
  const unsubscribe = ds.subscribe(schedule)

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
    if (debounce !== null) window.clearTimeout(debounce)
    unsubscribe()
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onHidden)
  }
}

export { readRollingBackup, readBackupMeta, clearRollingBackup, readAutoBackupEnabled, writeAutoBackupEnabled }

