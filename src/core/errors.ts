/**
 * الأخطاء الموحّدة — كل خطأ يظهر للمستخدم بالعربية بنص واضح.
 * الشفرة (`code`) تُستخدم في المنطق والاختبارات، والنص للعرض.
 */

export type ErrorCode =
  | 'network'
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'invalid_amount'
  | 'zero_amount'
  | 'negative_amount'
  | 'amount_too_large'
  | 'over_payment'
  | 'already_decided'
  | 'self_confirm'
  | 'self_link'
  | 'already_linked'
  | 'link_expired'
  | 'link_used'
  | 'link_invalid'
  | 'entry_locked'
  | 'duplicate'
  | 'rate_limited'
  | 'not_configured'
  | 'unknown'

export class AppError extends Error {
  readonly code: ErrorCode
  /** نص عربي جاهز للعرض */
  readonly userMessage: string
  /** تفاصيل إضافية اختيارية (تُسجَّل ولا تُعرض) */
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, userMessage: string, details?: Record<string, unknown>) {
    super(`${code}: ${userMessage}`)
    this.name = 'AppError'
    this.code = code
    this.userMessage = userMessage
    this.details = details
  }
}

/** رسائل عربية موحّدة حسب الشفرة */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  network: 'تعذّر الاتصال بالخدمة. تحقّق من الإنترنت وحاول مجددًا.',
  offline: 'لا يوجد اتصال بالإنترنت. سيتم الحفظ محليًا والمزامنة تلقائيًا.',
  unauthorized: 'انتهت الجلسة. الرجاء تسجيل الدخول من جديد.',
  forbidden: 'لا تملك صلاحية تنفيذ هذه العملية.',
  not_found: 'العنصر المطلوب غير موجود.',
  conflict: 'حدث تعارض في البيانات. حدّث الصفحة وحاول مجددًا.',
  validation: 'البيانات المدخلة غير صحيحة.',
  invalid_amount: 'المبلغ غير صالح. أدخل رقمًا صحيحًا.',
  zero_amount: 'لا يمكن تسجيل مبلغ صفر.',
  negative_amount: 'لا يمكن تسجيل مبلغ سالب.',
  amount_too_large: 'المبلغ كبير جدًا. تحقّق من الرقم.',
  over_payment: 'مبلغ السداد أكبر من الرصيد المتبقي.',
  already_decided: 'تمت معالجة هذه العملية مسبقًا.',
  self_confirm: 'لا يمكنك تأكيد عملية سجّلتها بنفسك. التأكيد من مسؤولية الطرف الآخر.',
  self_link: 'لا يمكنك ربط حسابك بنفسك.',
  already_linked: 'يوجد ارتباط قائم بين الحسابين بالفعل.',
  link_expired: 'انتهت صلاحية رمز الربط. اطلب رمزًا جديدًا.',
  link_used: 'تم استخدام رمز الربط سابقًا.',
  link_invalid: 'رمز الربط غير صحيح.',
  entry_locked: 'لا يمكن تعديل عملية مؤكدة. استخدم «عكس العملية» للحفاظ على السجل.',
  duplicate: 'تم إرسال هذه العملية مسبقًا.',
  rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.',
  not_configured: 'هذه الميزة تحتاج إعداد الخدمة السحابية.',
  unknown: 'حدث خطأ غير متوقع. حاول مجددًا.',
}

export function appError(code: ErrorCode, details?: Record<string, unknown>, userMessage?: string): AppError {
  return new AppError(code, userMessage ?? ERROR_MESSAGES[code], details)
}

/** يحوّل أي خطأ إلى نص عربي صالح للعرض */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage
  if (err instanceof Error) {
    if (/failed to fetch|network|load failed/i.test(err.message)) return ERROR_MESSAGES.network
    return ERROR_MESSAGES.unknown
  }
  return ERROR_MESSAGES.unknown
}

export function toErrorCode(err: unknown): ErrorCode {
  return err instanceof AppError ? err.code : 'unknown'
}
