/**
 * اختبار مسار الحساب على هذا الجهاز:
 * إنشاء حساب (الاسم + رقم الهاتف فقط، بلا كلمة مرور) → خروج → فتح الحساب بالرقم نفسه
 * والوصول إلى البيانات كما تُركت، مع قبول الرقم بأي صيغة يكتبها المستخدم.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'

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

type User = ReturnType<typeof userEvent.setup>

/** يفتح نموذج إنشاء الحساب من شاشة البداية (النوع ثم متابعة) */
async function openAccountForm(user: User, role: 'عميل' | 'تاجر') {
  await user.click(await screen.findByRole('radio', { name: `أنا ${role}` }, { timeout: 8000 }))
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
  await screen.findByText('إنشاء حساب جديد')
}

async function fillAccount(user: User, name: string, phone: string) {
  await user.type(await screen.findByLabelText(/^الاسم/), name)
  await user.type(screen.getByLabelText(/^رقم الهاتف/), phone)
}

async function startBook(user: User, role: 'عميل' | 'تاجر', name: string, phone: string) {
  await openAccountForm(user, role)
  await fillAccount(user, name, phone)
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
  await waitFor(() => expect(screen.queryByText('إنشاء حساب جديد')).not.toBeInTheDocument(), { timeout: 5000 })
}

/** يخرج من الحساب من الإعدادات */
async function signOut(user: User) {
  await user.click(await screen.findByRole('link', { name: 'الإعدادات' }))
  await user.click(await screen.findByRole('button', { name: 'تسجيل الخروج من هذا الجهاز' }))
  await user.click(await screen.findByRole('button', { name: 'خروج' }))
  await screen.findByText('اختر نوع حسابك', undefined, { timeout: 5000 })
}

/** يدخل من صفحة تسجيل الدخول برقم الهاتف وحده */
async function signInWithPhone(user: User, phone: string) {
  await user.click(screen.getByRole('button', { name: 'لديّ حساب — تسجيل الدخول' }))
  await screen.findByText('تسجيل الدخول')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), phone)
  await user.click(screen.getByRole('button', { name: 'دخول' }))
}

describe('حساب المستخدم على هذا الجهاز', () => {
  it('يطلب الاسم ورقم الهاتف فقط، بلا أي خانة كلمة مرور', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')

    expect(screen.getByLabelText(/^الاسم/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^رقم الهاتف/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/كلمة المرور/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'هل نسيت كلمة المرور؟' })).toBeInTheDocument()
    // لا يُعاد اختيار النوع في الصفحة التالية (يُعرض كنص فقط)
    expect(screen.queryByRole('radio', { name: 'أنا عميل' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'أنا تاجر' })).not.toBeInTheDocument()
    expect(screen.getByText(/الحساب: عميل/)).toBeInTheDocument()
  })

  it('يرفض رقم هاتف غير صحيح', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')
    await fillAccount(user, 'أحمد', '123')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

    expect(await screen.findByText(/رقم الهاتف غير صحيح/)).toBeInTheDocument()
  })

  it('بعد الخروج: يفتح الحساب بالرقم وحده ويجد بياناته كما تركها', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'أحمد محمد', '777123456')

    // بيانات فعلية قبل الخروج
    await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 5000 }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'محل الاختبار')
    await user.click(screen.getByRole('button', { name: 'إضافة محل' }))
    await screen.findByRole('heading', { name: 'محل الاختبار' }, { timeout: 5000 })

    await signOut(user)
    await signInWithPhone(user, '777123456')

    await user.click(await screen.findByRole('link', { name: 'الديون' }, { timeout: 5000 }))
    expect(await screen.findByText('محل الاختبار', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('يقبل الرقم بمفتاح دولة أو بصفر البداية ويوحّده', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'سالم علي', '733444555')
    await signOut(user)

    // +967 أو 0733444555 كلاهما يوصل إلى الحساب نفسه
    await signInWithPhone(user, '+967 733 444 555')
    expect(await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('رقم غير مسجّل: رسالة واضحة ويبقى في شاشة الدخول', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'تاجر', 'متجر النور', '777111222')
    await signOut(user)

    await signInWithPhone(user, '700000000')

    expect(await screen.findByText(/لا يوجد حساب بهذا الرقم/)).toBeInTheDocument()
    expect(screen.getByText('تسجيل الدخول')).toBeInTheDocument()
  })

  it('«هل نسيت كلمة المرور» يفتح الحساب بالرقم (لا كلمة مرور على الجهاز)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'سالم علي', '733444555')
    await signOut(user)

    await user.click(screen.getByRole('button', { name: 'لديّ حساب — تسجيل الدخول' }))
    await user.click(await screen.findByRole('link', { name: 'هل نسيت كلمة المرور؟' }))
    await screen.findByText('هل نسيت كلمة المرور؟', { selector: 'h1' })

    expect(screen.queryByLabelText(/كلمة المرور/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/^رقم الهاتف/), '733444555')
    await user.click(screen.getByRole('button', { name: 'افتح دفتري' }))

    expect(await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('الحساب المحفوظ يظهر في قائمة الجهاز ويفتح بضغطة واحدة', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'تاجر', 'متجر النور', '777111222')
    await signOut(user)

    await user.click(screen.getByRole('button', { name: 'لديّ حساب — تسجيل الدخول' }))
    await screen.findByText('الحسابات على هذا الجهاز')
    await user.click(screen.getByRole('button', { name: /متجر النور/ }))

    expect(
      await screen.findByText('إجمالي المتبقي لدى العملاء', undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
  })
})
