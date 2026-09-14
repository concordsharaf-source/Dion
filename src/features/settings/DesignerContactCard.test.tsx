/**
 * بطاقة «تواصل مع المصمم» أسفل الإعدادات:
 * النصوص كما هي، وروابط واتساب والبريد تعمل فعلًا.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { DesignerContactCard, DESIGNER_EMAIL, DESIGNER_WHATSAPP_DISPLAY } from './DesignerContactCard'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'

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

describe('بطاقة تواصل مع المصمم', () => {
  it('تعرض النصوص المطلوبة كما هي', () => {
    render(<DesignerContactCard />)

    expect(screen.getByText('تواصل مع المصمم')).toBeInTheDocument()
    expect(screen.getByText('نسعد باستقبال ملاحظاتكم واقتراحاتكم')).toBeInTheDocument()
    expect(screen.getByText('لتحسين تجربة استخدام حسابي وتطويرها باستمرار.')).toBeInTheDocument()
    expect(screen.getByText('واتساب')).toBeInTheDocument()
    expect(screen.getByText(DESIGNER_WHATSAPP_DISPLAY)).toBeInTheDocument()
    expect(screen.getByText('البريد الإلكتروني')).toBeInTheDocument()
    expect(screen.getByText(DESIGNER_EMAIL)).toBeInTheDocument()
    expect(screen.getByText('تصميم شرف غالب قحطان · الجمهورية اليمنية')).toBeInTheDocument()
  })

  it('روابط التواصل صحيحة (واتساب والبريد)', () => {
    render(<DesignerContactCard />)

    const whatsapp = screen.getByRole('link', { name: `واتساب ${DESIGNER_WHATSAPP_DISPLAY}` })
    expect(whatsapp).toHaveAttribute('href', 'https://wa.me/967770388100')
    expect(whatsapp).toHaveAttribute('target', '_blank')

    const email = screen.getByRole('link', { name: `البريد الإلكتروني ${DESIGNER_EMAIL}` })
    expect(email).toHaveAttribute('href', 'mailto:concordsharaf@gmail.com')
  })

  it('تظهر أسفل شاشة الإعدادات', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('radio', { name: 'أنا عميل' }, { timeout: 8000 }))
    await user.click(screen.getByRole('button', { name: 'متابعة' }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'أحمد محمد')
    await user.type(screen.getByLabelText(/^رقم الهاتف/), '777123456')
  await user.type(screen.getByLabelText(/^كلمة المرور/), '1234')
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), '1234')
    await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
    await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 8000 })

    await user.click(await screen.findByRole('link', { name: 'الإعدادات' }))
    await screen.findByRole('heading', { name: 'الإعدادات' }, { timeout: 5000 })

    // البطاقة قبل زر تسجيل الخروج (أسفل الإعدادات)
    const cardTitle = await screen.findByText('تواصل مع المصمم')
    const signOut = screen.getByRole('button', { name: 'تسجيل الخروج من هذا الجهاز' })
    expect(cardTitle.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(screen.getByRole('link', { name: `واتساب ${DESIGNER_WHATSAPP_DISPLAY}` })).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('تصميم شرف غالب قحطان · الجمهورية اليمنية')).toBeVisible())
  })
})
