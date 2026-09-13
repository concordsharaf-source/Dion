/**
 * اختبار حارس الخروج:
 * الرجوع من الرئيسية = محاولة خروج، ولا يحدث إلا بعد تأكيد في نافذة داخل التطبيق.
 * والرجوع من أي شاشة أخرى يبقى تنقّلًا داخليًا بلا نافذة.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'

let closeSpy: ReturnType<typeof vi.fn>
let goSpy: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  localStorage.clear()
  window.location.hash = '#/'

  closeSpy = vi.fn()
  goSpy = vi.fn()
  Object.defineProperty(window, 'close', { configurable: true, writable: true, value: closeSpy })
  Object.defineProperty(window.history, 'go', { configurable: true, writable: true, value: goSpy })
})

afterEach(async () => {
  vi.restoreAllMocks()
  localStorage.clear()
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
})

type User = ReturnType<typeof userEvent.setup>

/** زر الرجوع (زر النظام أو زر المتصفح) */
function pressBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** ينشئ دفترًا محليًا ويصل إلى الرئيسية */
async function openBook(user: User) {
  await user.click(await screen.findByRole('button', { name: 'أنا عميل' }, { timeout: 8000 }))
  await user.type(await screen.findByLabelText(/^الاسم/), 'أحمد محمد')
  await user.type(screen.getByLabelText(/^رقم الهاتف/), '777123456')
  await user.type(screen.getByLabelText(/^كلمة المرور/), 'pass1234')
  await user.type(screen.getByLabelText(/^تأكيد كلمة المرور/), 'pass1234')
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))
  await screen.findByText('إجمالي المتبقي عليك', undefined, { timeout: 8000 })
}

describe('حارس الخروج', () => {
  it('الرجوع من الرئيسية يفتح نافذة تأكيد داخل التطبيق ولا يخرج مباشرة', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    expect(screen.queryByText('الخروج من التطبيق؟')).not.toBeInTheDocument()
    pressBack()

    expect(await screen.findByText('الخروج من التطبيق؟')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'خروج' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'البقاء في التطبيق' })).toBeInTheDocument()
    // لم يخرج شيء بعد
    expect(closeSpy).not.toHaveBeenCalled()
    expect(goSpy).not.toHaveBeenCalled()
    expect(screen.getByText('إجمالي المتبقي عليك')).toBeInTheDocument()
  })

  it('«البقاء في التطبيق» يُغلق النافذة ويُبقي المستخدم في الرئيسية', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    pressBack()
    await user.click(await screen.findByRole('button', { name: 'البقاء في التطبيق' }))

    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).not.toBeInTheDocument())
    expect(screen.getByText('إجمالي المتبقي عليك')).toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()

    // الحارس ما زال يعمل: رجوع آخر يفتح النافذة مرة أخرى
    pressBack()
    expect(await screen.findByText('الخروج من التطبيق؟')).toBeInTheDocument()
  })

  it('«خروج» يحاول إغلاق التطبيق أو الرجوع خارج سجله', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    pressBack()
    await user.click(await screen.findByRole('button', { name: 'خروج' }))

    await waitFor(() => expect(closeSpy).toHaveBeenCalled(), { timeout: 2000 })
    await waitFor(() => expect(goSpy).toHaveBeenCalled(), { timeout: 2000 })
    expect(goSpy.mock.calls[0]![0]).toBeLessThan(0)
  })

  it('الرجوع من شاشة أخرى لا يُعتبر خروجًا', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    await user.click(screen.getByRole('link', { name: 'العمليات' }))
    await screen.findByRole('heading', { name: /العمليات/ }, { timeout: 5000 })

    pressBack()
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.queryByText('الخروج من التطبيق؟')).not.toBeInTheDocument()
  })

  it('رجوع آخر أثناء فتح النافذة يُغلقها (سلوك أندرويد)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    pressBack()
    await screen.findByText('الخروج من التطبيق؟')
    pressBack()
    await waitFor(() => expect(screen.queryByText('الخروج من التطبيق؟')).not.toBeInTheDocument())
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('الرجوع والرئيسية ونافذة مفتوحة: تُغلق النافذة أولًا بلا نافذة خروج', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    await user.click(screen.getByRole('button', { name: 'تسجيل دين' }))
    expect(await screen.findByText(/لا يوجد .* بعد/, undefined, { timeout: 5000 })).toBeInTheDocument()

    pressBack()
    await waitFor(() => expect(screen.queryByText(/لا يوجد .* بعد/)).not.toBeInTheDocument())
    expect(screen.queryByText('الخروج من التطبيق؟')).not.toBeInTheDocument()

    // الحارس ما زال يعمل بعد إغلاق النافذة
    pressBack()
    expect(await screen.findByText('الخروج من التطبيق؟')).toBeInTheDocument()
  })

  it('إن تعذّر الإغلاق تظهر رسالة تدلّ المستخدم على الإغلاق', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openBook(user)

    pressBack()
    await user.click(await screen.findByRole('button', { name: 'خروج' }))

    expect(await screen.findByText(/أغلقه من زر الإغلاق في المتصفح/, undefined, { timeout: 3000 })).toBeInTheDocument()
  })
})
