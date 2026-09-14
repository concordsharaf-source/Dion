/**
 * روابط البريد الإلكتروني (تأكيد الحساب / استعادة كلمة المرور / تغيير البريد).
 *
 * لماذا صيغة `?token_hash=…&type=…` بدل الصيغة الافتراضية؟
 * لأن التطبيق يعمل بتوجيه بالهاش (`createHashRouter`)، والصيغة الافتراضية تضع الرمز
 * بعد `#` (`#access_token=…`) فيتعارض الرمز مع المسار ويضيع. أمّا الاستعلام قبل `#`
 * فيبقى سليمًا ويقرأه التطبيق عند الإقلاع ثم يتحقق منه بـ`verifyOtp`.
 */

export type EmailLinkType = 'email' | 'recovery' | 'email_change' | 'magiclink' | 'invite'

export interface EmailLink {
  tokenHash: string
  type: EmailLinkType
  /** المسار الذي نفتحه بعد نجاح التحقق */
  nextRoute: string
}

const KNOWN_TYPES: EmailLinkType[] = ['email', 'recovery', 'email_change', 'magiclink', 'invite']

function isEmailLinkType(value: string): value is EmailLinkType {
  return (KNOWN_TYPES as string[]).includes(value)
}

/** يحلّل استعلام الرابط ⇒ تفاصيل الرابط، أو null إن لم يكن رابط بريد صالحًا */
export function parseEmailLink(search: string): EmailLink | null {
  if (!search) return null
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  const tokenHash = params.get('token_hash')?.trim()
  const rawType = params.get('type')?.trim()
  if (!tokenHash || !rawType || !isEmailLinkType(rawType)) return null
  return {
    tokenHash,
    type: rawType,
    nextRoute: rawType === 'recovery' ? '/settings/security' : '/',
  }
}

/** رسالة النجاح المناسبة لنوع الرابط */
export function emailLinkSuccessMessage(type: EmailLinkType): string {
  switch (type) {
    case 'recovery':
      return 'تم التحقق — اختر كلمة مرور جديدة الآن.'
    case 'email_change':
      return 'تم تأكيد بريدك الجديد.'
    case 'magiclink':
      return 'تم تسجيل دخولك.'
    case 'invite':
      return 'تم قبول الدعوة — حسابك جاهز.'
    default:
      return 'تم تأكيد بريدك — دفترك جاهز الآن.'
  }
}

/** حذف رموز الرابط من العنوان حتى لا تُستخدم مرة أخرى بالخطأ */
export function stripEmailLinkParams(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
  params.delete('token_hash')
  params.delete('type')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

/**
 * هل العنوان يحمل رمز دخول في الهاش؟ (صيغة Supabase الافتراضية: `#access_token=…&type=signup`)
 * نكتشفها لننظّف العنوان ونُظهر رسالة، لأن الهاش يتعارض مع التوجيه بالهاش في التطبيق.
 */
export function hasAuthFragment(hash: string): boolean {
  return /(^|[#&])access_token=/.test(hash)
}

/** نوع الرابط من الهاش (لتحديد الرسالة) */
export function authFragmentType(hash: string): string | null {
  const match = /(^|[#&])type=([A-Za-z_]+)/.exec(hash)
  return match ? match[2] : null
}
