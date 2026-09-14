/**
 * اختبار مسار الحساب على هذا الجهاز:
 * إنشاء حساب (اسم + هاتف + كلمة مرور وتأكيدها) → خروج → دخول بالرقم وكلمة المرور
 * → استعادة الكلمة عند النسيان. والتحقق من أن البيانات تبقى موجودة بعد الدخول.
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

/** يملأ نموذج إنشاء الحساب ويبدأ الدفتر */
async function openAccountForm(user: User, role: 'عميل' | 'تاجر') {
  await user.click(await screen.findByRole('radio', { name: `أنا ${role}` }, { timeout: 8000 }))
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
  await screen.findByText('إنشاء حساب جديد')
}

async function fillAccount(user: User, name: string, phone: string, password: string, confirm = password) {
  await user.type(await screen.findByLabelText(/^الاسم/), name)
  await user.type(screen.getByLabelText(/^رقم الهاتف/), phone)
  await user.type(screen.getByLabelText(/^كلمة المرور/), password)
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), confirm)
}

async function startBook(user: User, role: 'عميل' | 'تاجر', name: string, phone: string) {
  await openAccountForm(user, role)
  await fillAccount(user, name, phone, 'pass1234')
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

/** يدخل من صفحة تسجيل الدخول برقم الهاتف وكلمة المرور */
async function signInWithPassword(user: User, phone: string, password: string) {
  await user.click(screen.getByRole('button', { name: 'لديّ حساب — تسجيل الدخول' }))
  await screen.findByText('تسجيل الدخول')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), phone)
  await user.type(screen.getByLabelText(/^كلمة المرور/), password)
  await user.click(screen.getByRole('button', { name: 'دخول' }))
}

describe('حساب المستخدم على هذا الجهاز', () => {
  it('يطلب الاسم والهاتف وكلمة المرور وتأكيدها، مع «هل نسيت كلمة المرور»', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')

    expect(screen.getByLabelText(/^الاسم/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^رقم الهاتف/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^كلمة المرور/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^تأكيد كلمة المرور/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'هل نسيت كلمة المرور؟' })).toBeInTheDocument()
    // لا يُعاد اختيار النوع في الصفحة التالية (يُعرض كنص فقط)
    expect(screen.queryByRole('radio', { name: 'أنا عميل' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'أنا تاجر' })).not.toBeInTheDocument()
    expect(screen.getByText(/الحساب: عميل/)).toBeInTheDocument()
  })

  it('يرفض تأكيد كلمة المرور غير المطابق', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'تاجر')
    await fillAccount(user, 'متجر النور', '777123456', 'pass1234', 'pass9999')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

    expect(await screen.findByText('كلمتا المرور غير متطابقتين')).toBeInTheDocument()
    expect(screen.getByText('إنشاء حساب جديد')).toBeInTheDocument()
  })

  it('يرفض رقم هاتف غير صحيح', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')
    await fillAccount(user, 'أحمد', '123', 'pass1234')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

    expect(await screen.findByText(/رقم الهاتف غير صحيح/)).toBeInTheDocument()
  })

  it('بعد الخروج: يدخل بالرقم وكلمة المرور ويجد بياناته كما تركها', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'أحمد محمد', '777123456')

    // بيانات فعلية قبل الخروج
    await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 5000 }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'محل الاختبار')
    await user.click(screen.getByRole('button', { name: 'إضافة محل' }))
    await screen.findByRole('heading', { name: 'محل الاختبار' }, { timeout: 5000 })

    await signOut(user)
    await signInWithPassword(user, '777123456', 'pass1234')

    await user.click(await screen.findByRole('link', { name: 'الديون' }, { timeout: 5000 }))
    expect(await screen.findByText('محل الاختبار', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('يرفض كلمة مرور خاطئة ويبقى في شاشة الدخول', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'تاجر', 'متجر النور', '777111222')
    await signOut(user)

    await signInWithPassword(user, '777111222', 'wrong9999')

    expect(await screen.findByText(/كلمة المرور غير صحيحة/)).toBeInTheDocument()
    expect(screen.getByText('تسجيل الدخول')).toBeInTheDocument()
  })

  it('يفتح الحساب بالرقم نفسه مكتوبًا بمفتاح دولة أو بصفر البداية', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'سالم علي', '733444555')
    await signOut(user)

    await signInWithPassword(user, '+967 733 444 555', 'pass1234')
    expect(await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('يقبل كلمة مرور من 4 أرقام وحدها (بلا حروف أو رموز)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')
    await fillAccount(user, 'علي صالح', '777999888', '1234')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
    await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })

    await signOut(user)
    await signInWithPassword(user, '777999888', '1234')
    expect(await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })).toBeInTheDocument()
  })

  it('يرفض كلمة مرور أقل من 4 خانات', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openAccountForm(user, 'عميل')
    await fillAccount(user, 'علي صالح', '777999888', '123')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

    expect(await screen.findByText('كلمة المرور 4 خانات على الأقل')).toBeInTheDocument()
    expect(screen.getByText('إنشاء حساب جديد')).toBeInTheDocument()
  })

  it('«هل نسيت كلمة المرور» يعيّن كلمة جديدة ويمكن الدخول بها', async () => {
    const user = userEvent.setup()
    render(<App />)
    await startBook(user, 'عميل', 'سالم علي', '733444555')
    await signOut(user)

    await user.click(screen.getByRole('button', { name: 'لديّ حساب — تسجيل الدخول' }))
    await user.click(await screen.findByRole('link', { name: 'هل نسيت كلمة المرور؟' }))
    await screen.findByText('هل نسيت كلمة المرور؟', { selector: 'h1' })

    await user.type(screen.getByLabelText(/^رقم الهاتف/), '733444555')
    await user.type(screen.getByLabelText(/^كلمة المرور الجديدة/), 'newpass123')
    await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'تعيين كلمة المرور' }))

    await screen.findByText('تسجيل الدخول', undefined, { timeout: 5000 })
    await user.type(screen.getByLabelText(/^رقم الهاتف/), '733444555')
    await user.type(screen.getByLabelText(/^كلمة المرور/), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'دخول' }))

    expect(await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 5000 })).toBeInTheDocument()
  })
})
