/**
 * «عملت نسخة احتياطية لكني لا أجدها» — يغطّي السببين معًا:
 *   · المسار: الإعدادات ← النسخة الاحتياطية (رابط ظاهر، لا شاشة مخفية)
 *   · الوضوح: الشاشة تقول أين تعيش النسخة (قاعدة بيانات المتصفح) وكيف تخرج ملفًا
 *   · الأثر: بعد «إنشاء نسخة الآن» تظهر الحالة، وتُقرأ النسخة فعلًا من التخزين
 *   · الحفظ: زر الملف يعيد وصف مكان الملف على هذا الجهاز
 *   · الاستعادة: استعادة فعلية من النسخة المحفوظة بعد «مسح بياناتي من هذا الجهاز»
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'
import { BACKUP_STORAGE_HINT } from '@/services/backup'
import { readBackupMeta } from '@/services/backupStore'
import { backupDayKey } from '@/core/backup'

async function startCustomerBook() {
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('radio', { name: /أنا عميل/ }, { timeout: 8000 }))
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
  await user.type(await screen.findByLabelText(/^الاسم/), 'أحمد محمد')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), '777123456')
  await user.type(screen.getByLabelText(/^كلمة المرور/), 'pass1234')
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), 'pass1234')
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

  await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 8000 })
  return user
}

/** من الرئيسية ← الإعدادات ← النسخة الاحتياطية */
async function openBackupScreen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('link', { name: 'الإعدادات' }))
  await screen.findByRole('heading', { name: 'الإعدادات' }, { timeout: 5000 })
  await user.click(await screen.findByRole('link', { name: 'النسخة الاحتياطية' }))
  await screen.findByRole('heading', { name: 'النسخة الاحتياطية' }, { timeout: 5000 })
}

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  window.location.hash = '#/'
  localStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})

afterEach(async () => {
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  localStorage.clear()
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('شاشة النسخة الاحتياطية', () => {
  it('تُفتح من الإعدادات وتشرح أين توجد النسخة', async () => {
    const user = await startCustomerBook()
    await openBackupScreen(user)

    expect(screen.getByText('أين توجد النسخة؟')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(BACKUP_STORAGE_HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /حفظ ملف النسخة على الجهاز/ })).toBeInTheDocument()
    expect(screen.getByText(/ليست ملفًا في مجلد/)).toBeInTheDocument()
  })

  it('بعد «إنشاء نسخة الآن» تتحدّث الحالة وتُقرأ النسخة من التخزين فعلًا', async () => {
    const user = await startCustomerBook()
    await openBackupScreen(user)

    expect(await screen.findByText('لا توجد نسخة بعد')).toBeInTheDocument()
    expect(await readBackupMeta()).toBeNull()

    await user.click(screen.getByRole('button', { name: /إنشاء نسخة الآن/ }))

    expect(await screen.findByText('نسخة محفوظة على جهازك', {}, { timeout: 8000 })).toBeInTheDocument()
    const meta = await readBackupMeta()
    expect(meta).not.toBeNull()
    expect(meta?.dayKey).toBe(backupDayKey())
  })

  it('زر الملف يخبر بمكان الحفظ على هذا الجهاز', async () => {
    const user = await startCustomerBook()
    await openBackupScreen(user)

    await user.click(screen.getByRole('button', { name: /حفظ ملف النسخة على الجهاز/ }))

    await waitFor(
      async () => {
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
      },
      { timeout: 8000 },
    )
    expect(await screen.findByText(/ستجده في مجلد التنزيلات/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await readBackupMeta()).not.toBeNull()
  })
  it('يستعيد دفتره من النسخة المحفوظة بعد «مسح بياناتي من هذا الجهاز»', async () => {
    const user = await startCustomerBook()

    // طرف واحد في الدفتر (يظهر لاحقًا في شاشة الديون)
    await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 8000 }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'بقالة الحي')
    await user.click(screen.getByRole('button', { name: 'إضافة محل' }))
    await screen.findByRole('heading', { name: 'بقالة الحي' }, { timeout: 8000 })

    // نسخة محفوظة يدويًا (إضافةً إلى التلقائية)
    await openBackupScreen(user)
    await user.click(screen.getByRole('button', { name: /إنشاء نسخة الآن/ }))
    await screen.findByText('نسخة محفوظة على جهازك', {}, { timeout: 8000 })

    // «مسح بياناتي من هذا الجهاز» من الإعدادات
    await user.click(screen.getByRole('button', { name: 'رجوع' }))
    await screen.findByRole('heading', { name: 'الإعدادات' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /مسح بياناتي من هذا الجهاز/ }))
    await user.click(await screen.findByRole('button', { name: 'مسح نهائي' }))

    // الدفتر صار فارغًا فعلًا… والنسخة المحفوظة باقية
    expect(await readBackupMeta()).not.toBeNull()

    // … ثم الاستعادة من النسخة المحفوظة (بلا أي ملف)
    await user.click(await screen.findByRole('link', { name: 'النسخة الاحتياطية' }))
    await screen.findByRole('heading', { name: 'النسخة الاحتياطية' }, { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /استعادة من النسخة المحفوظة على الجهاز/ }))
    await user.click(await screen.findByRole('button', { name: 'استعادة' }))

    // رسالة الاستعادة تذكر ما عاد
    expect(await screen.findByText(/تمت الاستعادة من نسخة/, {}, { timeout: 8000 })).toBeInTheDocument()
    // الرسالة وبطاقة الحالة كلتاهما تعرضان ما عاد من النسخة
    expect(screen.getAllByText(/1 طرف · 0 عملية/).length).toBeGreaterThanOrEqual(2)

    // والطرف عاد إلى الدفتر فعلًا
    await user.click(screen.getByRole('button', { name: 'رجوع' }))
    await user.click(await screen.findByRole('link', { name: 'الديون' }, { timeout: 5000 }))
    expect(await screen.findByText('بقالة الحي', undefined, { timeout: 8000 })).toBeInTheDocument()
  })
})
