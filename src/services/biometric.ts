/**
 * خدمة البصمة (WebAuthn — منصة الجهاز فقط):
 *   · تفعيل: navigator.credentials.create(...) بمصدّق داخلي + userVerification مطلوب
 *   · فتح:   navigator.credentials.get(...) بنفس المعرّف
 *
 * لا يوجد أي خادم: نتحقق من حضور المستخدم فقط (بصمة/وجه/رمز الجهاز).
 * كل الأخطاء تُعاد كنتيجة مكتوبة، ويقرّر المستدعي: بقاء القفل أو التراجع للباترن.
 */

export type BiometricFailure =
  | 'unsupported'
  | 'insecure-context'
  | 'cancelled'
  | 'failed'
  | 'unavailable'

export type BiometricResult<T> = { ok: true; value: T } | { ok: false; reason: BiometricFailure; message: string }

const RP_NAME = 'دفتر الديون'

function base64UrlEncode(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): BufferSource {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes as unknown as BufferSource
}

function challenge(): BufferSource {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytes as unknown as BufferSource
}

function describe(error: unknown): { reason: BiometricFailure; message: string } {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError') {
    return { reason: 'cancelled', message: 'لم تُقرأ البصمة أو أُلغي الطلب' }
  }
  if (name === 'NotSupportedError' || name === 'InvalidStateError') {
    return { reason: 'unavailable', message: 'البصمة غير متاحة على هذا الجهاز الآن' }
  }
  if (name === 'SecurityError') {
    return { reason: 'insecure-context', message: 'البصمة تحتاج اتصالًا آمنًا (https) أو جهازًا موثوقًا' }
  }
  return { reason: 'failed', message: 'تعذّر التحقق بالبصمة' }
}

/** هل يدعم هذا الجهاز/المتصفح بصمة المنصة؟ */
export async function biometricSupport(): Promise<{ supported: boolean; reason?: BiometricFailure }> {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' }
  if (!window.isSecureContext && window.location?.hostname !== 'localhost') {
    return { supported: false, reason: 'insecure-context' }
  }
  const credentials = typeof navigator === 'undefined' ? undefined : navigator.credentials
  if (!credentials?.create || typeof window.PublicKeyCredential === 'undefined') {
    return { supported: false, reason: 'unsupported' }
  }
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
    if (available === false) return { supported: false, reason: 'unavailable' }
    return { supported: true }
  } catch {
    return { supported: false, reason: 'unsupported' }
  }
}

/** يُفعّل البصمة ويُعيد معرّف الاعتماد لتخزينه */
export async function registerBiometric(
  userName: string,
): Promise<BiometricResult<{ credentialId: string; label: string }>> {
  const support = await biometricSupport()
  if (!support.supported) {
    return { ok: false, reason: support.reason ?? 'unsupported', message: 'البصمة غير متاحة على هذا الجهاز' }
  }

  const userId = crypto.getRandomValues(new Uint8Array(16)) as unknown as BufferSource
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge(),
        rp: { name: RP_NAME, id: window.location.hostname || undefined },
        user: { id: userId, name: userName || 'dafatar', displayName: userName || 'دفتر الديون' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null

    if (!credential) return { ok: false, reason: 'failed', message: 'لم تكتمل عملية تفعيل البصمة' }
    return {
      ok: true,
      value: { credentialId: base64UrlEncode(credential.rawId), label: 'بصمة هذا الجهاز' },
    }
  } catch (error) {
    return { ok: false, ...describe(error) }
  }
}

/** يطلب التحقق بالبصمة لمعرّف مخزَّن */
export async function verifyBiometric(credentialId: string): Promise<BiometricResult<true>> {
  const support = await biometricSupport()
  if (!support.supported) {
    return { ok: false, reason: support.reason ?? 'unsupported', message: 'البصمة غير متاحة على هذا الجهاز' }
  }

  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        allowCredentials: [{ id: base64UrlDecode(credentialId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null

    if (!assertion) return { ok: false, reason: 'cancelled', message: 'لم تُقرأ البصمة' }
    return { ok: true, value: true }
  } catch (error) {
    return { ok: false, ...describe(error) }
  }
}
