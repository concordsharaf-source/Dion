/**
 * مسار النسخة الاحتياطية من واجهة المستخدم — للعميل (كما يشتكي المستخدم: «لا تظهر»).
 *
 * المطلوب إثباته:
 *   1) حساب عميل جديد: النسخة اليومية التلقائية مفعّلة افتراضيًا.
 *   2) بعد أول طرف في الدفتر: تُؤخذ نسخة تلقائيًا وتظهر في صف الإعدادات وفي الشاشة.
 *   3) الشاشة تشرح صراحة أين تُوجد النسخة (وليس في تطبيق الملفات) واسم ملف التنزيل.
 */

import { render, screen } from '@testing-library/react'
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

/** ينشئ حساب عميل ويسجّل محلًا واحدًا (أول عملية في الدفتر) */
async function customerWithFirstShop(user: User) {
  render(<App />)
  await user.click(await screen.findByRole('radio', { name: 'أنا عميل' }, { timeout: 8000 }))
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
  await screen.findByText('إنشاء حساب جديد')

  await user.type(await screen.findByLabelText(/^الاسم/), 'أحمد محمد')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), '778000111')
  await user.type(screen.getByLabelText(/^كلمة المرور/), '1234')
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), '1234')
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
  await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 8000 })

  await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 8000 }))
  await user.type(await screen.findByLabelText(/^الاسم/), 'بقالة الحي')
  await user.click(screen.getByRole('button', { name: 'إضافة محل' }))
  await screen.findByRole('heading', { name: 'بقالة الحي' }, { timeout: 8000 })
}

describe('النسخة الاحتياطية للمستخدم', () => {
  it('عميل: تظهر النسخة التلقائية في الإعدادات بعد أول عملية، وفي الشاشة مع شرح «أين أجد النسخة»', async () => {
    const user = userEvent.setup()
    await customerWithFirstShop(user)

    await user.click(await screen.findByRole('link', { name: 'الإعدادات' }))
    // النسخة تُؤخذ تلقائيًا بعد مهلة قصيرة من آخر تغيير في البيانات
    expect(await screen.findByText(/آخر نسخة/, undefined, { timeout: 12_000 })).toBeInTheDocument()
    expect(screen.getByText('نسخة اليوم')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'النسخة الاحتياطية' }))
    expect(await screen.findByText('نسخة محفوظة على جهازك')).toBeInTheDocument()
    expect(screen.getByText(/1 طرف · 0 عملية/)).toBeInTheDocument()

    // الشرح الذي يجيب عن سؤال «لماذا لا أجدها؟»
    expect(screen.getByText(/محفوظة داخل قاعدة بيانات المتصفح/)).toBeInTheDocument()
    expect(screen.getByText(/لا تظهر في مدير الملفات/)).toBeInTheDocument()
    expect(screen.getAllByText(/daftar-backup-\d{4}-\d{2}-\d{2}\.json/).length).toBeGreaterThan(0)

    // النسخة اليومية التلقائية مفعّلة افتراضيًا للعميل أيضًا
    expect(screen.getByRole('switch', { name: 'نسخة يومية تلقائية' })).toHaveAttribute('aria-checked', 'true')
  })
})
