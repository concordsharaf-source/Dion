/**
 * اختبار مسار إنشاء الباترن من الإعدادات (خطوتان: إنشاء ثم تأكيد).
 * يمنع تكرار الخلل المُبلَّغ عنه: كان الباترن يُدخَل مرة واحدة ثم تعلق اللوحة
 * فلا يمكن إدخال باترن التأكيد.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'
import { readLockConfig } from '@/core/appLock'

beforeEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  localStorage.clear()
  window.location.hash = '#/'
})

afterEach(async () => {
  localStorage.clear()
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
})

type User = ReturnType<typeof userEvent.setup>

/** يرسم باترنًا على اللوحة ثم يؤكّده */
async function draw(user: User, dots: string[]) {
  for (const dot of dots) await user.click(screen.getByRole('button', { name: dot }))
  await user.click(screen.getByRole('button', { name: 'تأكيد الباترن' }))
}

async function openPatternSetup(user: User) {
  await user.click(await screen.findByRole('radio', { name: 'أنا عميل' }, { timeout: 8000 }))
  await user.click(screen.getByRole('button', { name: 'متابعة' }))
  await user.type(await screen.findByLabelText(/^الاسم/), 'أحمد محمد')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), '777123456')
  await user.type(screen.getByLabelText(/^كلمة المرور/), 'pass1234')
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), 'pass1234')
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
  await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 8000 })

  await user.click(await screen.findByRole('link', { name: 'الإعدادات' }))
  await user.click(await screen.findByRole('link', { name: /الأمان/ }))
  await user.click(await screen.findByRole('button', { name: 'قفل بالباترن (بلا بصمة)' }))
  await screen.findByText('ارسم باترن الفتح')
}

describe('إنشاء الباترن (خطوتان)', () => {
  it('يُدخل الباترن الأول ثم باترن التأكيد ويحفظه', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openPatternSetup(user)

    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])
    // الخطوة الثانية: العنوان يتغيّر ويجب أن تُقبل النقاط من جديد
    expect(await screen.findByText('أعد رسم الباترن للتأكيد')).toBeInTheDocument()
    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])

    await waitFor(() => expect(readLockConfig().mode).toBe('pattern'), { timeout: 5000 })
  })

  it('باترن تأكيد مختلف يُظهر رسالة ويعيد الخطوة الأولى', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openPatternSetup(user)

    await draw(user, ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6'])
    await screen.findByText('أعد رسم الباترن للتأكيد')
    await draw(user, ['نقطة 7', 'نقطة 8', 'نقطة 9', 'نقطة 5'])

    expect(await screen.findByText(/الباترنان غير متطابقين/)).toBeInTheDocument()
    expect(await screen.findByText('ارسم باترن الفتح')).toBeInTheDocument()
    expect(readLockConfig().mode).toBe('off')
  })
})
