/**
 * اختبارات النسخة الاحتياطية الفعلية على الجهاز (لا المنطق النقي فقط).
 *
 * تحرس هذه الاختبارات ما لاحظه المستخدم: «النسخة لا تظهر».
 * القاعدة المطلوبة: نسخة اليوم تُؤخذ تلقائيًا لأي حساب (تاجر أو عميل) متى وُجد
 * في الدفتر طرف واحد على الأقل — فلا تبقى شاشة النسخة فارغة بلا سبب.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDataSource } from '@/data/local/adapter'
import { deleteDatabase } from '@/data/local/db'
import {
  BACKUP_DEBOUNCE_MS,
  clearRollingBackup,
  createRollingBackup,
  maybeRunDailyBackup,
  readAutoBackupEnabled,
  readBackupMeta,
  readRollingBackup,
  restoreFromStoredBackup,
  startDailyBackupRunner,
  writeAutoBackupEnabled,
} from './backup'
import { defaultAutoBackup, needsDailyBackup } from '@/core/backup'
import type { DataSource } from '@/data/port'

const SESSION_LS = 'dafatar.session'
const SESSION_TAB = 'dafatar.session.tab'

/** ينشئ حسابًا على الجهاز ويعيد المحرّك مع ملفه الشخصي */
async function openBook(input: {
  name: string
  phone: string
  role: 'merchant' | 'customer'
}): Promise<{ ds: DataSource; profile: Awaited<ReturnType<DataSource['auth']['getProfile']>> }> {
  const ds = new LocalDataSource()
  const session = await ds.auth.signUpDevice!({
    fullName: input.name,
    phone: input.phone,
    password: '1234',
    role: input.role,
  })
  sessionStorage.setItem(SESSION_TAB, session.userId)
  localStorage.setItem(SESSION_LS, session.userId)
  return { ds, profile: await ds.auth.getProfile() }
}

async function addPartnerAndDebt(ds: DataSource, name: string, kind: 'shop' | 'customer'): Promise<void> {
  const party = await ds.parties.create({ kind, name })
  await ds.entries.create({
    partyId: party.id,
    entryType: 'debt',
    amountMinor: 1_500_000,
    currency: 'YER',
    clientRef: `ref-${name}`,
  })
}

beforeEach(async () => {
  await deleteDatabase()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(async () => {
  await deleteDatabase()
  localStorage.clear()
  sessionStorage.clear()
})

describe('النسخة التلقائية على الجهاز', () => {
  it('مفعّلة افتراضيًا لكل الحسابات — لا فرق بين تاجر وعميل', () => {
    expect(defaultAutoBackup('merchant')).toBe(true)
    expect(defaultAutoBackup('customer')).toBe(true)
    expect(needsDailyBackup({ role: 'customer', autoEnabled: true, lastDayKey: null })).toBe(true)
  })

  it('تاجر: تُؤخذ نسخة اليوم تلقائيًا بمجرد وجود طرف واحد', async () => {
    const { ds, profile } = await openBook({ name: 'متجر النور', phone: '777000101', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')

    const meta = await maybeRunDailyBackup(ds, profile)
    expect(meta).not.toBeNull()
    expect(meta?.counts).toEqual({ parties: 1, entries: 1 })

    const stored = await readRollingBackup()
    expect(stored?.payload.parties).toHaveLength(1)
    expect(stored?.payload.entries).toHaveLength(1)
  })

  it('عميل: النسخة تُؤخذ تلقائيًا أيضًا (سبب عدم ظهور النسخة سابقًا)', async () => {
    const { ds, profile } = await openBook({ name: 'أحمد محمد', phone: '777000102', role: 'customer' })
    await addPartnerAndDebt(ds, 'بقالة الحي', 'shop')

    expect(await readAutoBackupEnabled('customer')).toBe(true)
    const meta = await maybeRunDailyBackup(ds, profile)
    expect(meta).not.toBeNull()
    expect(meta?.counts.parties).toBe(1)
    expect(await readBackupMeta()).not.toBeNull()
  })

  it('لا تُؤخذ نسخة لدفتر فارغ — الشاشة تشرح الحالة بدل نسخة بلا معنى', async () => {
    const { ds, profile } = await openBook({ name: 'سالم', phone: '777000103', role: 'customer' })
    expect(await maybeRunDailyBackup(ds, profile)).toBeNull()
    expect(await readBackupMeta()).toBeNull()
  })

  it('نسخة واحدة لليوم: لا تُكرَّر عند إعادة التشغيل', async () => {
    const { ds, profile } = await openBook({ name: 'متجر الفتح', phone: '777000104', role: 'merchant' })
    await addPartnerAndDebt(ds, 'علي', 'customer')

    const first = await maybeRunDailyBackup(ds, profile)
    expect(first).not.toBeNull()
    expect(await maybeRunDailyBackup(ds, profile)).toBeNull()
    expect((await readBackupMeta())?.createdAt).toBe(first?.createdAt)
  })

  it('كل نسخة جديدة تستبدل السابقة تمامًا (ولا تتراكم)', async () => {
    const { ds, profile } = await openBook({ name: 'متجر اليمن', phone: '777000105', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')
    await createRollingBackup(ds, profile)

    await addPartnerAndDebt(ds, 'سالم', 'customer')
    const second = await createRollingBackup(ds, profile)

    expect(second.meta.counts).toEqual({ parties: 2, entries: 2 })
    const stored = await readRollingBackup()
    expect(stored?.payload.parties).toHaveLength(2)
    expect(stored?.payload.entries).toHaveLength(2)
    expect(stored?.meta.id).toBe('latest')
  })

  it('إيقاف الخيار يمنع النسخة التلقائية، والتفعيل يعيدها', async () => {
    const { ds, profile } = await openBook({ name: 'متجر الأمانة', phone: '777000106', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')

    await writeAutoBackupEnabled(false)
    expect(await readAutoBackupEnabled('merchant')).toBe(false)
    expect(await maybeRunDailyBackup(ds, profile)).toBeNull()
    expect(await readBackupMeta()).toBeNull()

    await writeAutoBackupEnabled(true)
    expect(await maybeRunDailyBackup(ds, profile)).not.toBeNull()
  })

  it('المشغّل يأخذ نسخة تلقائيًا بعد أول طرف يُسجّل — بلا انتظار نهاية اليوم', async () => {
    const { ds, profile } = await openBook({ name: 'متجر الرسالة', phone: '777000108', role: 'customer' })

    // المشغّل يشتغل والتطبيق مفتوح (كما في BackupWatcher داخل التطبيق)
    const stop = startDailyBackupRunner({ ds, profile })
    try {
      // دفتر فارغ: لا نسخة (ولا رسالة)
      await new Promise((resolve) => setTimeout(resolve, BACKUP_DEBOUNCE_MS + 200))
      expect(await readBackupMeta()).toBeNull()

      // أول عملية في الدفتر ⇒ نسخة تلقائية بعد مهلة قصيرة
      await addPartnerAndDebt(ds, 'محل الحي', 'shop')
      await new Promise((resolve) => setTimeout(resolve, BACKUP_DEBOUNCE_MS + 400))
      const meta = await readBackupMeta()
      expect(meta).not.toBeNull()
      expect(meta?.counts).toEqual({ parties: 1, entries: 1 })
    } finally {
      stop()
    }
  })

  it('حذف النسخة المحفوظة يُفرغ الحالة ويسمح بأخذ نسخة جديدة', async () => {
    const { ds, profile } = await openBook({ name: 'متجر الصفا', phone: '777000107', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')
    await createRollingBackup(ds, profile)
    expect(await readBackupMeta()).not.toBeNull()

    await clearRollingBackup()
    expect(await readBackupMeta()).toBeNull()
    expect(await readRollingBackup()).toBeNull()

    await writeAutoBackupEnabled(true)
    expect(await maybeRunDailyBackup(ds, profile)).not.toBeNull()
  })
})

/* ============================ الاستعادة من النسخة المحفوظة ============================ */

describe('الاستعادة من النسخة المحفوظة داخل التطبيق', () => {
  it('تعيد الأطراف والعمليات بعد «مسح بياناتي من هذا الجهاز» — النسخة لا يمسّها المسح', async () => {
    const { ds, profile } = await openBook({ name: 'أحمد محمد', phone: '777000201', role: 'customer' })
    await addPartnerAndDebt(ds, 'بقالة الحي', 'shop')

    // نسخة محفوظة
    await createRollingBackup(ds, profile)
    // ثم مسح بيانات المستخدم من الجهاز (كما يفعل زر «مسح بياناتي»)
    await ds.resetUserData!()
    expect((await ds.parties.list()).items).toHaveLength(0)
    expect((await ds.entries.list({ status: 'all' })).items).toHaveLength(0)

    // الاستعادة من النسخة المحفوظة
    const { result, meta } = await restoreFromStoredBackup(ds)
    expect(result.parties).toBe(1)
    expect(result.entries).toBe(1)
    expect(meta.counts).toEqual({ parties: 1, entries: 1 })

    const parties = (await ds.parties.list()).items
    expect(parties).toHaveLength(1)
    expect(parties[0]!.name).toBe('بقالة الحي')
    expect((await ds.entries.list({ status: 'all' })).items).toHaveLength(1)
  })

  it('دمج آمن قابل للتكرار: الاستعادة الثانية تتخطّى كل شيء بلا تكرار', async () => {
    const { ds, profile } = await openBook({ name: 'متجر النور', phone: '777000202', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')
    await createRollingBackup(ds, profile)

    // الدفتر سليم أصلًا: لا يُضاف شيء (كل السجلات موجودة) ولا يُحذف شيء
    const first = await restoreFromStoredBackup(ds)
    expect(first.result.parties).toBe(0)
    expect(first.result.entries).toBe(0)
    expect(first.result.skipped).toBeGreaterThan(0)
    expect((await ds.parties.list()).items).toHaveLength(1)

    const second = await restoreFromStoredBackup(ds)
    expect(second.result.parties).toBe(0)
    expect(second.result.entries).toBe(0)
    expect(second.result.skipped).toBeGreaterThan(0)
    expect((await ds.parties.list()).items).toHaveLength(1)
    expect((await ds.entries.list({ status: 'all' })).items).toHaveLength(1)
  })

  it('رسالة عربية واضحة إن لم توجد نسخة محفوظة بعد', async () => {
    const { ds } = await openBook({ name: 'سالم', phone: '777000203', role: 'customer' })
    await expect(restoreFromStoredBackup(ds)).rejects.toThrow(/لا توجد نسخة محفوظة/)
  })

  it('لا تُنشئ أطرافًا مكرّرة إن كان الطرف موجودًا بالاسم نفسه', async () => {
    const { ds, profile } = await openBook({ name: 'متجر الفتح', phone: '777000204', role: 'merchant' })
    await addPartnerAndDebt(ds, 'أحمد', 'customer')
    await createRollingBackup(ds, profile)

    // مسح ثم إعادة إنشاء طرف بالاسم نفسه (معرّف جديد)
    await ds.resetUserData!()
    await ds.parties.create({ kind: 'customer', name: 'أحمد' })

    const { result } = await restoreFromStoredBackup(ds)
    expect(result.parties).toBe(0)
    expect(result.skipped).toBeGreaterThan(0)
    expect((await ds.parties.list()).items).toHaveLength(1)
  })
})
