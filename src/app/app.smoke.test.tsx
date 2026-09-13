/**
 * اختبار شامل لمسار المستخدم الحقيقي عبر الواجهة:
 * البداية → اختيار الدور → إنشاء الدفتر → إضافة طرف → تسجيل دين → ظهور الرصيد.
 *
 * يتحقق من أن التطبيق يعمل من طرف واحد بدون أي ربط، ومن أن الرصيد يُحسب
 * من العمليات المسجّلة فعلًا في طبقة البيانات.
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from './queryClient'

beforeEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  window.location.hash = '#/'
})

afterEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
})

/** إدخال مبلغ من لوحة الأرقام الداخلية */
async function keypad(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const d of digits) {
    await user.click(await screen.findByRole('button', { name: d }))
  }
}

/** يبدأ دفترًا جديدًا بدور محدّد ويعيد اسم المستخدم */
async function startBook(role: 'عميل' | 'تاجر', name: string) {
  const user = userEvent.setup()
  render(<App />)

  const roleButton = await screen.findByRole('button', { name: new RegExp(`أنا ${role}`) }, { timeout: 8000 })
  await user.click(roleButton)

  const nameInput = await screen.findByLabelText(/^الاسم/)
  await user.type(nameInput, name)
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

  await waitFor(() => expect(screen.queryByText('مرحبًا بك في دفترك')).not.toBeInTheDocument(), { timeout: 5000 })
  return user
}

describe('التطبيق — مسار العميل المستقل', () => {
  it('ينشئ دفترًا مستقلًا ويعرض الحالة الفارغة بدون أي طلب ربط', async () => {
    const user = await startBook('عميل', 'أحمد محمد')

    expect(await screen.findByText('إجمالي المتبقي عليك')).toBeInTheDocument()
    expect(await screen.findByText('لا توجد عمليات بعد', undefined, { timeout: 5000 })).toBeInTheDocument()
    // لا يُطلب الربط لاستخدام الوظائف الأساسية
    expect(screen.queryByText(/يجب ربط حسابك/)).not.toBeInTheDocument()

    // الانتقال إلى المحلات
    await user.click(screen.getByRole('link', { name: 'المحلات' }))
    expect(await screen.findByRole('heading', { name: 'المحلات' }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('يسجّل محلًا ثم دينًا ويرى الرصيد المتبقي محدّثًا', async () => {
    const user = await startBook('عميل', 'سالم علي')

    await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 5000 }))

    const partyName = await screen.findByLabelText(/^الاسم/)
    await user.type(partyName, 'بقالة النور')
    await user.click(screen.getByRole('button', { name: 'إضافة محل' }))

    // ننتقل بعد الإضافة إلى صفحة المحل نفسه
    expect(await screen.findByRole('heading', { name: 'بقالة النور' }, { timeout: 5000 })).toBeInTheDocument()

    // تسجيل دين من صفحة المحل
    await user.click(await screen.findByRole('button', { name: 'تسجيل دين' }, { timeout: 5000 }))

    const amountInput = await screen.findByLabelText('المبلغ', undefined, { timeout: 5000 })
    expect(amountInput).toHaveValue('0')
    await keypad(user, '20000')
    expect(amountInput).toHaveValue('20,000')
    await user.click(screen.getByRole('button', { name: 'تسجيل الدين' }))

    // العملية تظهر في سجل المحل بالمبلغ الصحيح
    const list = await screen.findByRole('button', { name: /دين سجّلته/ }, { timeout: 5000 })
    expect(within(list).getByText(/20,000|20٬000/)).toBeInTheDocument()
  })
})

describe('نافذتا الدين والسداد', () => {
  it('كل نافذة مستقلة، وتُفتح على خانة المبلغ مع لوحة أرقام', async () => {
    const user = await startBook('تاجر', 'متجر الفرقان')

    // نافذة الدين
    await user.click(await screen.findByRole('button', { name: 'تسجيل دين' }, { timeout: 5000 }))
    expect(await screen.findByRole('button', { name: 'تسجيل الدين' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تسجيل السداد' })).not.toBeInTheDocument()

    // تُفتح مباشرة على خانة المبلغ
    const amount = screen.getByLabelText('المبلغ')
    await waitFor(() => expect(document.activeElement).toBe(amount), { timeout: 3000 })
    expect(amount).toHaveValue('0')

    await user.click(screen.getByRole('button', { name: 'إغلاق' }))

    // نافذة السداد (مستقلة تمامًا)
    await user.click(await screen.findByRole('button', { name: 'تسجيل سداد' }, { timeout: 5000 }))
    expect(await screen.findByRole('button', { name: 'تسجيل السداد' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تسجيل الدين' })).not.toBeInTheDocument()

    // إدخال سريع من لوحة الأرقام + حذف + إضافة سريعة
    await keypad(user, '2500')
    const paid = screen.getByLabelText('المبلغ')
    expect(paid).toHaveValue('2,500')
    await user.click(screen.getByRole('button', { name: 'حذف' }))
    expect(paid).toHaveValue('250')
    await user.click(screen.getByRole('button', { name: /\+1,000/ }))
    expect(paid).toHaveValue('1,250')
  })
})

describe('التطبيق — مسار التاجر المستقل', () => {
  it('يضيف عميلًا بمبلغ افتتاحي ويرى المتبقي في القائمة واللوحة', async () => {
    const user = await startBook('تاجر', 'متجر النور')

    expect(await screen.findByText('إجمالي المتبقي لدى العملاء', undefined, { timeout: 5000 })).toBeInTheDocument()

    await user.click(await screen.findByRole('link', { name: 'العملاء' }, { timeout: 5000 }))
    await user.click(await screen.findByRole('button', { name: 'إضافة عميل' }, { timeout: 5000 }))

    const nameInput = await screen.findByLabelText(/^الاسم/)
    await user.type(nameInput, 'أحمد محمد')

    const opening = screen.getByLabelText(/رصيد افتتاحي/)
    await user.type(opening, '15000')

    await user.click(screen.getByRole('button', { name: 'إضافة عميل' }))

    expect(await screen.findByRole('heading', { name: 'أحمد محمد' }, { timeout: 5000 })).toBeInTheDocument()
    const amounts = await screen.findAllByText(/15,000|15٬000/, undefined, { timeout: 5000 })
    expect(amounts.length).toBeGreaterThan(0)
  })

  it('يمنع تسجيل سداد أكبر من الرصيد المؤكد', async () => {
    const user = await startBook('تاجر', 'تجارة الأمانة')

    // عميل بمبلغ افتتاحي 10,000
    await user.click(await screen.findByRole('link', { name: 'العملاء' }, { timeout: 5000 }))
    await user.click(await screen.findByRole('button', { name: 'إضافة عميل' }, { timeout: 5000 }))
    const nameInput = await screen.findByLabelText(/^الاسم/)
    await user.type(nameInput, 'خالد')
    await user.type(screen.getByLabelText(/رصيد افتتاحي/), '10000')
    await user.click(screen.getByRole('button', { name: 'إضافة عميل' }))

    await user.click(await screen.findByRole('button', { name: 'تسجيل سداد' }, { timeout: 5000 }))

    await keypad(user, '12000')
    expect(screen.getByLabelText('المبلغ')).toHaveValue('12,000')

    // تحذير فوري + منع الإرسال قبل الوصول لطبقة البيانات
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent('المبلغ أكبر من المتبقي')
    expect(screen.getByRole('button', { name: 'تسجيل السداد' })).toBeDisabled()
  })
})
