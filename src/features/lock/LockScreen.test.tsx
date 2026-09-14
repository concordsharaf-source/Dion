/**
 * اختبارات شاشة القفل:
 *   · القفل بالبصمة ⇐ شاشة فارغة تمامًا + مطالبة تلقائية فورية (بلا ضغط أي زر)
 *   · الإلغاء/الفشل ⇐ إعادة الطلب تلقائيًا، والباترن يظهر بعد ٣ محاولات فقط
 *   · البصمة غير متاحة على الجهاز ⇐ الباترن مباشرة (بلا حلقة إعادة طلب)
 *   · فتح بالباترن الصحيح، ورفض الخاطئ
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockScreen, MAX_BIOMETRIC_ATTEMPTS } from './LockScreen'
import { clearPattern, disableLock, setPattern, writeCredentialId, writeLockMode } from '@/core/appLock'

const getMock = vi.fn()
const createMock = vi.fn()

function fakeCredentials() {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    writable: true,
    value: { get: getMock, create: createMock },
  })
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    writable: true,
    value: function PublicKeyCredential() {} as unknown as typeof window.PublicKeyCredential,
  })
  Object.defineProperty(window.PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', {
    configurable: true,
    writable: true,
    value: async () => true,
  })
}

function noPlatformAuthenticator() {
  Object.defineProperty(window.PublicKeyCredential, 'isUserVerifyingPlatformAuthenticatorAvailable', {
    configurable: true,
    writable: true,
    value: async () => false,
  })
}

function armBiometric() {
  writeCredentialId('cred-1', 'بصمة هذا الجهاز')
  writeLockMode('biometric')
}

beforeEach(() => {
  disableLock()
  clearPattern()
  getMock.mockReset()
  createMock.mockReset()
  fakeCredentials()
})

afterEach(() => {
  disableLock()
  clearPattern()
})

describe('القفل بالبصمة — شاشة فارغة ونكتفي بنافذة الجهاز', () => {
  it('يطلب البصمة تلقائيًا عند ظهور الشاشة بلا أي ضغط', async () => {
    armBiometric()
    getMock.mockResolvedValue({ id: 'cred-1', type: 'public-key' })

    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    // الطلب تم بلا تفاعل من المستخدم + مطلوب التحقق بحضور المستخدم
    const options = (getMock.mock.calls[0]![0] as { publicKey: PublicKeyCredentialRequestOptions }).publicKey
    expect(options.userVerification).toBe('required')
    expect(options.allowCredentials?.[0]?.type).toBe('public-key')
  })

  it('لا يرسم أي واجهة انتظار: لا عنوان ولا أزرار ولا نص المطالبة', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockImplementation(() => new Promise(() => {})) // الجهاز لم يرد بعد

    const { container } = render(<LockScreen onUnlocked={vi.fn()} userName="شرف الدين" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('دفتر الديون مقفل')).toBeNull()
    expect(screen.queryByText(/ضع إصبعك/)).toBeNull()
    expect(screen.queryByRole('group', { name: 'لوحة الباترن' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    // لا شيء ظاهر على الشاشة (بقي نص للقارئ الشاشة فقط)
    expect(container.textContent).toBe('جارٍ التحقق من البصمة…')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('يعيد الطلب تلقائيًا عند الإلغاء، ويكتفي بالباترن بعد ٣ محاولات فاشلة', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValue(Object.assign(new Error('fail'), { name: 'NotAllowedError' }))

    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    // المحاولات الثلاث تتم تلقائيًا (بلا ضغط) والشاشة تبقى فارغة خلالها
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(MAX_BIOMETRIC_ATTEMPTS), { timeout: 8000 })
    expect(await screen.findByText('تعذّرت البصمة — استخدم الباترن', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('لا يُظهر الباترن قبل استنفاد المحاولات', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValueOnce(Object.assign(new Error('fail'), { name: 'NotAllowedError' }))
    getMock.mockImplementation(() => new Promise(() => {})) // المحاولة الثانية معلّقة

    render(<LockScreen onUnlocked={vi.fn()} />)

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2), { timeout: 4000 })
    expect(screen.queryByRole('group', { name: 'لوحة الباترن' })).toBeNull()
    expect(screen.queryByText('دفتر الديون مقفل')).toBeNull()
  })

  it('يعرض الباترن مباشرة إذا لم تكن البصمة متاحة على الجهاز (بلا حلقة طلب)', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    noPlatformAuthenticator()

    render(<LockScreen onUnlocked={vi.fn()} />)

    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    await waitFor(() => expect(getMock).not.toHaveBeenCalled())
  })

  it('زر إعادة المحاولة بالبصمة يُفرّغ الشاشة ويعيد الطلب', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValue(Object.assign(new Error('fail'), { name: 'NotAllowedError' }))
    const user = userEvent.setup()

    render(<LockScreen onUnlocked={vi.fn()} />)

    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة بالبصمة' }, { timeout: 8000 })
    const before = getMock.mock.calls.length
    getMock.mockImplementation(() => new Promise(() => {}))
    await user.click(retry)

    await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(before))
    expect(screen.queryByRole('group', { name: 'لوحة الباترن' })).toBeNull()
  })
})

describe('القفل بالباترن', () => {
  it('يفتح بالباترن الصحيح', async () => {
    await setPattern([0, 1, 2, 5])
    writeLockMode('pattern')
    const user = userEvent.setup()
    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    for (const dot of ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 6']) {
      await user.click(await screen.findByRole('button', { name: dot }))
    }
    await user.click(screen.getByRole('button', { name: 'تأكيد الباترن' }))

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
  })

  it('يرفض الباترن الخاطئ ويعرض تنبيهًا', async () => {
    await setPattern([0, 1, 2, 5])
    writeLockMode('pattern')
    const user = userEvent.setup()
    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    for (const dot of ['نقطة 1', 'نقطة 2', 'نقطة 3', 'نقطة 4']) {
      await user.click(await screen.findByRole('button', { name: dot }))
    }
    await user.click(screen.getByRole('button', { name: 'تأكيد الباترن' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('الباترن غير صحيح')
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('لا يطلب البصمة إن كان القفل بالباترن فقط', async () => {
    await setPattern([0, 1, 2, 5])
    writeLockMode('pattern')
    render(<LockScreen onUnlocked={vi.fn()} />)

    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    expect(getMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'إعادة المحاولة بالبصمة' })).not.toBeInTheDocument()
  })
})
