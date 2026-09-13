/**
 * اختبارات شاشة القفل:
 *   · مطالبة تلقائية بالبصمة فور ظهور الشاشة (بلا ضغط أي زر)
 *   · التراجع التلقائي إلى الباترن عند تعذّر البصمة لأي سبب
 *   · فتح بالباترن الصحيح، ورفض الخاطئ
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockScreen } from './LockScreen'
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

describe('القفل بالبصمة', () => {
  it('يطلب البصمة تلقائيًا عند ظهور الشاشة بلا أي ضغط', async () => {
    writeCredentialId('cred-1', 'بصمة هذا الجهاز')
    writeLockMode('biometric')
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

  it('يظهر الباترن فورًا إذا تعذّرت البصمة لأي سبب', async () => {
    writeCredentialId('cred-1', 'بصمة هذا الجهاز')
    writeLockMode('biometric')
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValue(Object.assign(new Error('fail'), { name: 'NotAllowedError' }))

    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    expect(await screen.findByText('تعذّرت البصمة — استخدم الباترن أدناه')).toBeInTheDocument()
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('يعرض علامة المطالبة بالبصمة والاستعداد لها', () => {
    writeCredentialId('cred-1', 'بصمة هذا الجهاز')
    writeLockMode('biometric')
    getMock.mockImplementation(() => new Promise(() => {}))

    render(<LockScreen onUnlocked={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'فتح بالبصمة' })).toBeInTheDocument()
    expect(screen.getByText(/ضع إصبعك على مستشعر البصمة/)).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'فتح بالبصمة' })).not.toBeInTheDocument()
  })
})
