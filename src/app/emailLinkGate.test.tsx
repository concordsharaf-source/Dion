/**
 * بوابة روابط البريد: التحقق من الرمز قبل تشغيل التطبيق، وتنظيف العنوان،
 * ورسائل الفشل وإعادة الإرسال.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DataSource } from '@/data/port'
import { DataSourceProvider } from './DataSourceProvider'
import { EmailLinkGate } from './EmailLinkGate'
import { ToastProvider } from '@/components/ui'

const verifyEmailLink = vi.fn(async () => ({ userId: 'u1', email: 'a@b.c', createdAt: '2026-01-01T00:00:00Z' }))
const resendConfirmation = vi.fn(async () => undefined)

vi.mock('@/data/load', () => ({
  dataSourceKind: () => 'supabase' as const,
  loadDataSource: async () =>
    ({
      kind: 'supabase',
      auth: { verifyEmailLink, resendConfirmation },
      subscribe: () => () => {},
    }) as unknown as DataSource,
}))

function renderGate() {
  return render(
    <DataSourceProvider>
      <ToastProvider>
        <EmailLinkGate>
          <p>التطبيق يعمل</p>
        </EmailLinkGate>
      </ToastProvider>
    </DataSourceProvider>,
  )
}

afterEach(() => {
  verifyEmailLink.mockClear()
  resendConfirmation.mockClear()
  verifyEmailLink.mockImplementation(async () => ({ userId: 'u1', email: 'a@b.c', createdAt: '2026-01-01T00:00:00Z' }))
  window.history.replaceState(null, '', '/')
})

describe('بوابة رابط البريد', () => {
  it('بلا رابط: يفتح التطبيق فورًا ولا يتحقق من أي رمز', async () => {
    renderGate()
    expect(await screen.findByText('التطبيق يعمل')).toBeInTheDocument()
    expect(verifyEmailLink).not.toHaveBeenCalled()
  })

  it('رابط تأكيد صحيح: يتحقق، ينظّف العنوان، ويفتح التطبيق', async () => {
    window.history.replaceState(null, '', '/?token_hash=abc123&type=email')
    renderGate()
    expect(await screen.findByText('جارٍ تأكيد بريدك…')).toBeInTheDocument()
    expect(await screen.findByText('التطبيق يعمل')).toBeInTheDocument()
    expect(verifyEmailLink).toHaveBeenCalledWith({ tokenHash: 'abc123', type: 'email' })
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('رابط استعادة: يوجّه إلى شاشة الأمان بعد النجاح', async () => {
    window.history.replaceState(null, '', '/?token_hash=rec1&type=recovery')
    renderGate()
    await screen.findByText('التطبيق يعمل')
    expect(verifyEmailLink).toHaveBeenCalledWith({ tokenHash: 'rec1', type: 'recovery' })
    await waitFor(() => expect(window.location.hash).toBe('#/settings/security'))
  })

  it('رابط منتهي أو مستخدم: رسالة واضحة مع إمكانية إعادة الإرسال', async () => {
    verifyEmailLink.mockRejectedValueOnce(new Error('انتهت صلاحية الرابط'))
    window.history.replaceState(null, '', '/?token_hash=old&type=email')
    const user = userEvent.setup()
    renderGate()

    expect(await screen.findByText('تعذّر تأكيد الرابط')).toBeInTheDocument()
    const email = screen.getByLabelText('بريدك الإلكتروني')
    await user.type(email, 'me@example.com')
    await user.click(screen.getByRole('button', { name: 'أرسل رابط تأكيد جديد' }))
    await waitFor(() => expect(resendConfirmation).toHaveBeenCalledWith('me@example.com'))
  })

  it('في الوضع المحلي (بلا حساب سحابي): يشرح كيف يُفتح الرابط', async () => {
    vi.resetModules()
    vi.doMock('@/data/load', () => ({
      dataSourceKind: () => 'local' as const,
      loadDataSource: async () =>
        ({ kind: 'local', auth: {}, subscribe: () => () => {} }) as unknown as DataSource,
    }))
    const [{ EmailLinkGate: Gate }, { DataSourceProvider: Provider }, { ToastProvider: TP }, { render: renderLocal }] =
      await Promise.all([import('./EmailLinkGate'), import('./DataSourceProvider'), import('@/components/ui'), import('@testing-library/react')])
    window.history.replaceState(null, '', '/?token_hash=abc&type=email')
    renderLocal(
      <Provider>
        <TP>
          <Gate>
            <p>التطبيق يعمل</p>
          </Gate>
        </TP>
      </Provider>,
    )
    expect(await screen.findByText('افتح الرابط من نفس جهازك')).toBeInTheDocument()
    vi.doUnmock('@/data/load')
    vi.resetModules()
  })
})
