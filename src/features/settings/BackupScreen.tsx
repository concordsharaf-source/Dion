import { useRef, useState } from 'react'
import {
  Clock,
  Database,
  Download,
  FolderOpen,
  HardDriveDownload,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import clsx from 'clsx'
import { Button, Card, ConfirmDialog, SectionTitle, useToast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import {
  useAutoBackup,
  useBackupMeta,
  useClearBackup,
  useCreateBackup,
  useDownloadBackup,
  useRestoreBackup,
  useRestoreStoredBackup,
  useToggleAutoBackup,
} from '@/app/hooks/useBackup'
import { useProfile } from '@/app/hooks/useAuth'
import { describeBackup } from '@/services/backupStore'
import { BACKUP_STORAGE_HINT, describeBackupSaveMethod, detectBackupSaveMethod } from '@/services/backup'
import { formatDateTimeAr, formatRelativeAr } from '@/core/datetime'
import { toUserMessage } from '@/core/errors'
import { backupDayKey, backupFileName } from '@/core/backup'

/**
 * النسخة الاحتياطية — نسخة واحدة دائمًا على الجهاز.
 * تُؤخذ تلقائيًا لكل حساب (تاجر أو عميل) بمجرد وجود طرف واحد في الدفتر،
 * وتستبدل نسخة اليوم السابق. ويمكن إنشاؤها وتنزيلها كملف في أي وقت.
 */
export function BackupScreen() {
  const toast = useToast()
  const profile = useProfile()
  const role = profile.data?.role ?? 'customer'

  const meta = useBackupMeta()
  const auto = useAutoBackup(role)
  const createBackup = useCreateBackup()
  const download = useDownloadBackup()
  const restore = useRestoreBackup()
  const clearBackup = useClearBackup()
  const toggleAuto = useToggleAutoBackup()

  const restoreStored = useRestoreStoredBackup()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  /** آخر نتيجة حفظ ملف: تخبر المستخدم أين وجد الملف فعلًا */
  const [savedHint, setSavedHint] = useState<string | null>(null)
  const saveMethod = detectBackupSaveMethod()

  const backup = meta.data ?? null
  const isToday = backup ? backup.dayKey === backupDayKey() : false
  const busy =
    createBackup.isPending || download.isPending || restore.isPending || clearBackup.isPending || restoreStored.isPending

  async function onCreate() {
    try {
      await createBackup.mutateAsync()
      toast.show('تم إنشاء نسخة جديدة واستبدال السابقة')
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  async function onSaveFile() {
    try {
      const { saved } = await download.mutateAsync()
      setSavedHint(saved.hint)
      toast.show(saved.cancelled ? 'أُلغيت العملية — لم يُحفظ ملف' : saved.hint, saved.cancelled ? 'info' : 'ok')
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  /** استعادة من النسخة المحفوظة داخل التطبيق — بلا ملف */
  async function onRestoreStored() {
    try {
      const { result, meta: restored } = await restoreStored.mutateAsync()
      setConfirmRestore(false)
      toast.show(
        `تمت الاستعادة من نسخة ${formatDateTimeAr(restored.createdAt)}: ${result.parties} طرف · ${result.entries} عملية` +
          (result.skipped > 0 ? ` (تخطّي ${result.skipped} موجودة سابقًا)` : ''),
      )
    } catch (e) {
      setConfirmRestore(false)
      toast.show(toUserMessage(e), 'error')
    }
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const result = await restore.mutateAsync(file)
      toast.show(
        `تمت الاستعادة: ${result.parties} طرف · ${result.entries} عملية${result.skipped > 0 ? ` (تخطّي ${result.skipped} موجودة سابقًا)` : ''}`,
      )
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="pb-8">
      <PageHeader title="النسخة الاحتياطية" />

      <div className="space-y-4 px-4 pt-4">
        {/* حالة النسخة */}
        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <span
              className={clsx(
                'grid h-11 w-11 shrink-0 place-items-center rounded-2xl',
                backup ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'bg-ink-200 text-ink-500 dark:bg-ink-800',
              )}
            >
              <Database size={20} />
            </span>
            <div className="flex-1">
              <p className="font-extrabold">{backup ? 'نسخة محفوظة على جهازك' : 'لا توجد نسخة بعد'}</p>
              <p className="mt-0.5 text-[0.75rem] leading-5 text-ink-500">
                {backup
                  ? `${formatDateTimeAr(backup.createdAt)} · ${formatRelativeAr(backup.createdAt)}`
                  : 'أنشئ نسخة الآن لتحتفظ بأرقامك حتى لو حُذفت بيانات المتصفح.'}
              </p>
              {backup ? (
                <p className="mt-1 text-[0.75rem] font-bold text-ink-600 dark:text-ink-300">{describeBackup(backup)}</p>
              ) : null}
            </div>
            {backup ? (
              <span
                className={clsx(
                  'chip shrink-0',
                  isToday ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200' : 'bg-ink-200 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
                )}
              >
                {isToday ? 'نسخة اليوم' : 'نسخة سابقة'}
              </span>
            ) : null}
          </div>

          <ul className="space-y-1.5 rounded-2xl bg-ink-100 p-3 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
            <li className="flex items-center gap-2">
              <ShieldCheck size={14} className="shrink-0" /> نسخة واحدة دائمًا — كل نسخة جديدة تستبدل القديمة تمامًا.
            </li>
            <li className="flex items-center gap-2">
              <Clock size={14} className="shrink-0" /> تُؤخذ تلقائيًا كل يوم (تاجر أو عميل) بعد أول عملية في الدفتر.
            </li>
            <li className="flex items-center gap-2">
              <HardDriveDownload size={14} className="shrink-0" /> تُحفظ على جهازك فقط ولا تُرسل لأي خادم.
            </li>
          </ul>
        </Card>

        {/* أين توجد النسخة؟ — الإجابة عن «عملت نسخة لكني لا أجدها» */}
        <section>
          <SectionTitle>أين توجد النسخة؟</SectionTitle>
          <Card className="space-y-2.5 text-[0.75rem] leading-5">
            <p className="flex items-center gap-2 font-bold text-ink-800 dark:text-ink-100">
              <FolderOpen size={16} /> مكانها على جهازك
            </p>
            <ul className="space-y-2 text-ink-600 dark:text-ink-300">
              <li className="flex items-start gap-2">
                <Database size={14} className="mt-0.5 shrink-0" />
                <span>
                  <b>نسخة التطبيق (المُبيّنة أعلاه):</b> محفوظة داخل قاعدة بيانات المتصفح على هذا الجهاز —{' '}
                  <span className="font-mono text-[0.6875rem]">{BACKUP_STORAGE_HINT}</span>. ليست ملفًا في مجلد
                  التنزيلات، لذلك لا تظهر في مدير الملفات.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Download size={14} className="mt-0.5 shrink-0" />
                <span>
                  <b>ملف يمكن نقله:</b> اضغط «حفظ ملف النسخة على الجهاز (.json)» في قسم «النسخ والاستعادة» بالأسفل،
                  وسيُحفظ باسم <span className="font-mono text-[0.6875rem]">{backupFileName()}</span> — ونخبرك بمكانه
                  بعد الحفظ.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <RotateCcw size={14} className="mt-0.5 shrink-0" />
                <span>
                  <b>للاستعادة منها:</b> اضغط «استعادة من النسخة المحفوظة على الجهاز» في قسم «النسخ والاستعادة» —
                  تُدمج مع دفترك الحالي: تُضاف السجلات الناقصة فقط ولا يُحذف شيء. تعمل حتى لو مسحت بياناتك
                  بالخطأ، لأن المسح لا يمسّ النسخة المحفوظة.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Upload size={14} className="mt-0.5 shrink-0" />
                <span>
                  <b>على جهاز جديد:</b> انقل ملف النسخة ثم «استعادة من ملف نسخة» — الاستعادة دمج آمن بلا تكرار.
                </span>
              </li>
            </ul>
          </Card>
        </section>

        {/* النسخة التلقائية */}
        <section>
          <SectionTitle>النسخة اليومية التلقائية</SectionTitle>
          <Card className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
              <Clock size={18} />
            </span>
            <div className="flex-1">
              <p className="font-bold">نسخة كل يوم — تلقائيًا</p>
              <p className="text-[0.6875rem] text-ink-500">
                {auto.data
                  ? 'مفعّلة — تُستبدل نسخة الأمس بنسخة اليوم تلقائيًا.'
                  : 'معطّلة — فعّلها لتأخذ نسخة تلقائية كل يوم.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(auto.data)}
              aria-label="نسخة يومية تلقائية"
              onClick={() =>
                void toggleAuto
                  .mutateAsync(!auto.data)
                  .then(() => toast.show(auto.data ? 'تم إيقاف النسخة اليومية' : 'تم تفعيل النسخة اليومية', 'info'))
                  .catch((e) => toast.show(toUserMessage(e), 'error'))
              }
              className={clsx(
                'relative h-7 w-12 shrink-0 rounded-full transition',
                auto.data ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all',
                  auto.data ? 'start-1' : 'start-6',
                )}
              />
            </button>
          </Card>
        </section>

        {/* الأدوات */}
        <section>
          <SectionTitle>النسخ والاستعادة</SectionTitle>
          <div className="space-y-2">
            <Button block size="lg" icon={<Database size={18} />} loading={createBackup.isPending} disabled={busy} onClick={() => void onCreate()}>
              إنشاء نسخة الآن (تستبدل السابقة)
            </Button>
            <Button
              block
              variant="soft"
              icon={<Download size={18} />}
              loading={download.isPending}
              disabled={busy}
              onClick={() => void onSaveFile()}
            >
              حفظ ملف النسخة على الجهاز (.json)
            </Button>
            <p className="px-1 text-[0.6875rem] leading-5 text-ink-500">
              الوسيلة على جهازك: {describeBackupSaveMethod(saveMethod)} — الملف باسم{' '}
              <b className="font-mono text-[0.625rem]">{backupFileName()}</b>
              {savedHint ? (
                <span className="mt-1 block font-bold text-brand-700 dark:text-brand-200" role="status">
                  {savedHint}
                </span>
              ) : null}
            </p>
            {backup ? (
              <Button
                block
                variant="soft"
                icon={<RotateCcw size={18} />}
                loading={restoreStored.isPending}
                disabled={busy}
                onClick={() => setConfirmRestore(true)}
              >
                استعادة من النسخة المحفوظة على الجهاز
              </Button>
            ) : null}
            <Button
              block
              variant="soft"
              icon={<Upload size={18} />}
              loading={restore.isPending}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              استعادة من ملف نسخة
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void onFile(e.target.files)}
            />

            {backup ? (
              <Button
                block
                variant="ghost"
                className="text-danger-600"
                icon={<Trash2 size={17} />}
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                حذف النسخة المحفوظة
              </Button>
            ) : null}
          </div>
        </section>

        <p className="px-1 text-[0.6875rem] leading-5 text-ink-500">
          الاستعادة <b>دمج آمن</b>: تُضاف فقط السجلات الناقصة، ولا يُحذف أو يُستبدل أي سجل موجود، ولا تتكرر العملية مرتين
          (كل عملية تحمل معرّفًا فريدًا). عمليات الدفتر الشخصي تُستعاد كما هي، والعمليات المشتركة مع طرف آخر تبقى بيد الطرفين.
        </p>

        <Button block variant="ghost" icon={<RotateCcw size={17} />} disabled={busy} onClick={() => void meta.refetch()}>
          تحديث الحالة
        </Button>
      </div>

      <ConfirmDialog
        open={confirmRestore}
        title="استعادة من النسخة المحفوظة"
        message={
          backup
            ? `سيُدمج محتوى نسخة ${formatDateTimeAr(backup.createdAt)} (${describeBackup(backup)}) مع دفترك الحالي: تُضاف السجلات الناقصة فقط، ولا يُحذف أو يُستبدل أي سجل موجود.`
            : ''
        }
        confirmLabel="استعادة"
        loading={restoreStored.isPending}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => void onRestoreStored()}
      />

      <ConfirmDialog
        open={confirmClear}
        title="حذف النسخة المحفوظة"
        message="سيُحذف ملف النسخة من هذا الجهاز. بياناتك الحالية في الدفتر لا تتأثر إطلاقًا."
        confirmLabel="حذف النسخة"
        tone="danger"
        loading={clearBackup.isPending}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() =>
          void clearBackup
            .mutateAsync()
            .then(() => {
              setConfirmClear(false)
              toast.show('تم حذف النسخة المحفوظة', 'info')
            })
            .catch((e) => toast.show(toUserMessage(e), 'error'))
        }
      />
    </div>
  )
}
