/**
 * اختبارات شاشة القفل:
 *   · القفل بالبصمة ⇐ شاشة فارغة تمامًا + مطالبة واحدة عند الدخول (بلا ضغط أي زر)
 *   · لا تذكير ولا إعادة طلب تلقائية أثناء الاستخدام (ولو تغيّرت رؤية الصفحة)
 *   · إلغاء/فشل البصمة ⇐ الباترن + زر إعادة المحاولة (طلب صريح من المستخدم)
 *   · البصمة غير متاحة على الجهاز ⇐ الباترن مباشرة
 *   · فتح بالباترن الصحيح، ورفض الخاطئ
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockScreen } from './LockScreen'
import { clearPattern, disableLock, setPattern, writeCredentialId, writeLockMode } from '@/core/appLock'

const getMock = vi.fn()
const createMock = vi.fn()
let visibility: 'visible' | 'hidden' = 'visible'

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

function setVisibility(next: 'visible' | 'hidden') {
  visibility = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

const cancelled = () => Object.assign(new Error('fail'), { name: 'NotAllowedError' })

beforeEach(() => {
  disableLock()
  clearPattern()
  getMock.mockReset()
  createMock.mockReset()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  fakeCredentials()
})

afterEach(() => {
  disableLock()
  clearPattern()
  delete (document as { visibilityState?: unknown }).visibilityState
})

describe('القفل بالبصمة — شاشة فارغة ومطالبة واحدة عند الدخول', () => {
  it('يطلب البصمة مرة واحدة تلقائيًا عند ظهور الشاشة ويفتح', async () => {
    armBiometric()
    getMock.mockResolvedValue({ id: 'cred-1', type: 'public-key' })

    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1))
    // مطالبة واحدة فقط، بلا أي تفاعل من المستخدم
    expect(getMock).toHaveBeenCalledTimes(1)
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

  it('لا يُعيد الطلب أثناء الاستخدام: لا تذكير عند تبدّل رؤية الصفحة', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockImplementation(() => new Promise(() => {})) // معلّقة: المستخدم ما زال داخل المطالبة

    render(<LockScreen onUnlocked={vi.fn()} />)

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
    setVisibility('hidden') // ظلّلة/مكالمة/نافذة النظام
    setVisibility('visible')
    await new Promise((r) => window.setTimeout(r, 50))

    expect(getMock).toHaveBeenCalledTimes(1) // لا مطالبة ثانية تلقائية
  })

  it('لا يطالب والتطبيق في الخلفية، ويطالب مرة واحدة عند الدخول', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockImplementation(() => new Promise(() => {}))
    visibility = 'hidden'

    render(<LockScreen onUnlocked={vi.fn()} />)
    await new Promise((r) => window.setTimeout(r, 30))
    expect(getMock).not.toHaveBeenCalled() // ما نفتح نافذة النظام والتطبيق مخفي

    setVisibility('visible') // ← لحظة الدخول إلى التطبيق
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1))
    setVisibility('hidden')
    setVisibility('visible')
    await new Promise((r) => window.setTimeout(r, 50))
    expect(getMock).toHaveBeenCalledTimes(1) // مطالبة واحدة لكل حلقة قفل
  })

  it('إلغاء المطالبة يُظهر الباترن بلا إعادة طلب تلقائية', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValue(cancelled())

    const onUnlocked = vi.fn()
    render(<LockScreen onUnlocked={onUnlocked} />)

    expect(await screen.findByText('تعذّرت البصمة — استخدم الباترن')).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    await new Promise((r) => window.setTimeout(r, 60))
    expect(getMock).toHaveBeenCalledTimes(1) // لا حلقة إعادة طلب
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('البصمة غير متاحة على الجهاز ⇐ الباترن مباشرة وبلا أي طلب', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    noPlatformAuthenticator()

    render(<LockScreen onUnlocked={vi.fn()} />)

    expect(await screen.findByRole('group', { name: 'لوحة الباترن' })).toBeInTheDocument()
    await waitFor(() => expect(getMock).not.toHaveBeenCalled())
  })

  it('زر «إعادة المحاولة بالبصمة» يفرّغ الشاشة ويطلب البصمة (طلب صريح)', async () => {
    armBiometric()
    await setPattern([0, 1, 2, 5])
    getMock.mockRejectedValueOnce(cancelled())
    getMock.mockImplementation(() => new Promise(() => {}))
    const user = userEvent.setup()

    render(<LockScreen onUnlocked={vi.fn()} />)

    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة بالبصمة' })
    await user.click(retry)

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('group', { name: 'لوحة الباترن' })).toBeNull()
    expect(screen.getByText('جارٍ التحقق من البصمة…')).toBeInTheDocument()
  })

  it('يُبلّغ الحارس بفتح نافذة البصمة وإغلاقها (حتى لا يُعاد القفل)', async () => {
    armBiometric()
    getMock.mockResolvedValue({ id: 'cred-1', type: 'public-key' })
    const onPromptActiveChange = vi.fn()

    render(<LockScreen onUnlocked={vi.fn()} onPromptActiveChange={onPromptActiveChange} />)

    await waitFor(() => expect(onPromptActiveChange).toHaveBeenNthCalledWith(1, true))
    await waitFor(() => expect(onPromptActiveChange).toHaveBeenNthCalledWith(2, false))
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
