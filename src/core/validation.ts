/**
 * التحقق من المدخلات — zod في الواجهة + نفس القواعد على الخادم (SQL)
 * كل رسالة خطأ عربية وواضحة للمستخدم.
 */

import { z } from 'zod'
import { readAmount, MAX_MINOR } from './money'

/* ============================ أدوات التنقية ============================ */

/** ينظّف النص: يزيل محارف التحكم، يوحّد المسافات، ويحدّ الطول */
export function sanitizeText(input: unknown, maxLength = 200): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/** نص متعدد الأسطر (ملاحظات) مع حد أقصى أطول */
export function sanitizeMultiline(input: unknown, maxLength = 1000): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxLength)
}

/**
 * توحيد رقم الهاتف — **بلا مفتاح دولة**.
 * يقبل الصيغ الشائعة ويكتفي بأرقام الرقم المحلي:
 *   0771234567 · 771234567 · +967771234567 · 00967771234567  ←  «771234567»
 * أي مفتاح دولة يُكتب من المستخدم يُزال، ولا يُضاف أي مفتاح من التطبيق.
 */
export function normalizePhoneNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const digits = onlyDigits(input)
  if (!digits) return null
  // إزالة مفتاح الدولة إن كتبه المستخدم، ثم صفر البداية
  const local = digits.replace(/^00/, '').replace(/^967/, '').replace(/^0+/, '')
  if (!/^\d{6,12}$/.test(local)) return null
  return local
}

/** أرقام الرقم فقط (يحوّل الأرقام العربية أيضًا) */
function onlyDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '')
}

/**
 * عرض الرقم بصيغة مقروءة **بلا مفتاح دولة**: 771 234 567
 * يتعامل مع الأرقام المحفوظة قديمًا بمفتاح الدولة فيعرضها محلية أيضًا.
 */
export function displayPhone(phone: string | null): string {
  if (!phone) return ''
  const digits = onlyDigits(phone)
  const local = digits.replace(/^00/, '').replace(/^967/, '').replace(/^0+/, '')
  if (local.length === 9) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
  if (local.length === 7) return `${local.slice(0, 3)} ${local.slice(3)}`
  return local || phone
}

/* ============================ مخططات ============================ */

const phoneField = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'string' ? v.trim() : ''))
  .refine((v) => v === '' || normalizePhoneNumber(v) !== null, { message: 'رقم الهاتف غير صحيح' })
  .transform((v) => (v === '' ? null : normalizePhoneNumber(v)))

const optionalText = (max = 200) =>
  z
    .unknown()
    .optional()
    .transform((v) => {
      const s = sanitizeText(v, max)
      return s.length ? s : null
    })

const optionalNote = z
  .unknown()
  .optional()
  .transform((v) => {
    const s = sanitizeMultiline(v, 1000)
    return s.length ? s : null
  })

/** مبلغ مالي: نص عربي أو رقم → وحدات صغرى صحيحة */
const amountField = z
  .unknown()
  .transform((v, ctx) => {
    const r = readAmount(v)
    if (!r.ok) {
      const msg =
        r.reason === 'empty'
          ? 'أدخل المبلغ'
          : r.reason === 'negative'
            ? 'لا يمكن تسجيل مبلغ سالب'
            : r.reason === 'too_many_decimals'
              ? 'لا يسمح بأكثر من خانتين عشريتين'
              : r.reason === 'too_large'
                ? 'المبلغ كبير جدًا'
                : 'المبلغ غير صالح'
      ctx.addIssue({ code: 'custom', message: msg })
      return z.NEVER
    }
    if (r.minor > MAX_MINOR) {
      ctx.addIssue({ code: 'custom', message: 'المبلغ كبير جدًا' })
      return z.NEVER
    }
    return r.minor
  })

/** مبلغ افتتاحي اختياري (يُسمح بالصفر = بدون رصيد افتتاحي) */
const optionalAmountField = z
  .unknown()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === '') return 0
    const r = readAmount(v)
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: 'المبلغ غير صالح' })
      return z.NEVER
    }
    return r.minor
  })

/* --- الطرف (محل أو عميل) --- */
export const partySchema = z.object({
  name: z
    .unknown()
    .transform((v) => sanitizeText(v, 80))
    .refine((v) => v.length >= 1, { message: 'أدخل الاسم' })
    .refine((v) => v.length <= 80, { message: 'الاسم طويل جدًا' }),
  phone: phoneField,
  address: optionalText(160),
  note: optionalNote,
  openingAmount: optionalAmountField,
})

export type PartyInput = z.input<typeof partySchema>
export type PartyParsed = z.output<typeof partySchema>

/* --- العملية المالية --- */
export const entrySchema = z.object({
  partyId: z.string().min(1, { message: 'اختر الطرف' }),
  entryType: z.enum(['debt', 'payment'], { message: 'نوع العملية غير صحيح' }),
  amount: amountField,
  details: optionalText(160),
  note: optionalNote,
  occurredAt: z.string().optional(),
})

export type EntryInput = z.input<typeof entrySchema>
export type EntryParsed = z.output<typeof entrySchema>

/* --- تأكيد / رفض --- */
export const decisionSchema = z.object({
  entryId: z.string().min(1),
  reason: optionalNote,
})

export const reversalSchema = z.object({
  entryId: z.string().min(1),
  note: optionalNote,
})

/* --- الملف الشخصي --- */
export const profileSchema = z.object({
  fullName: z
    .unknown()
    .transform((v) => sanitizeText(v, 60))
    .refine((v) => v.length >= 2, { message: 'أدخل الاسم' }),
  role: z.enum(['customer', 'merchant']),
  currency: z.string().min(3).max(3).default('YER'),
})

/* --- المصادقة --- */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), { message: 'البريد الإلكتروني غير صحيح' })

/**
 * كلمة المرور: **4 خانات وما فوق، ولا شيء غير ذلك**.
 * لا تُفرض حروف ولا رموز ولا حالات خاصة — الأرقام وحدها مقبولة (مثل 1234).
 */
export const passwordSchema = z
  .string()
  .min(4, { message: 'كلمة المرور 4 خانات على الأقل' })
  .max(72, { message: 'كلمة المرور طويلة جدًا' })

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z
    .unknown()
    .transform((v) => sanitizeText(v, 60))
    .refine((v) => v.length >= 2, { message: 'أدخل الاسم' }),
  role: z.enum(['customer', 'merchant']),
})

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'أدخل كلمة المرور' }),
})

/** الهاتف مطلوب (إنشاء حساب) — يُقبل بالصيغ اليمنية الشائعة */
const requiredPhoneField = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v.trim() : ''))
  .refine((v) => normalizePhoneNumber(v) !== null, { message: 'رقم الهاتف غير صحيح — مثال: 777123456' })

/** كلمة المرور مرتين — للتأكد من عدم الخطأ في الكتابة */
const confirmPassword = z
  .string()
  .min(1, { message: 'أعد كتابة كلمة المرور' })

/** إنشاء حساب على هذا الجهاز: الاسم + رقم الهاتف (بلا كلمة مرور) */
export const signUpDeviceSchema = z.object({
  fullName: z
    .unknown()
    .transform((v) => sanitizeText(v, 60))
    .refine((v) => v.length >= 2, { message: 'أدخل الاسم' }),
  phone: requiredPhoneField,
})

export const signUpCloudSchema = z
  .object({
    fullName: z
      .unknown()
      .transform((v) => sanitizeText(v, 60))
      .refine((v) => v.length >= 2, { message: 'أدخل الاسم' }),
    email: emailSchema,
    phone: requiredPhoneField,
    password: passwordSchema,
    confirmPassword,
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirmPassword'],
  })

/** فتح حساب على الجهاز: رقم الهاتف وحده (بلا كلمة مرور) */
export const deviceSignInSchema = z.object({
  identifier: requiredPhoneField,
})

/* --- رمز الربط --- */
export const linkCodeSchema = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : ''))
  .refine((v) => v.length >= 16, { message: 'رمز الربط غير مكتمل' })

/* ============================ مساعد النتائج ============================ */

export interface ValidationResult<T> {
  success: boolean
  data?: T
  /** أخطاء مرتبطة بالحقول */
  errors: Record<string, string>
  /** أول رسالة خطأ للعرض السريع */
  firstError?: string
}

/**
 * يشغّل مخطط zod ويعيد أخطاء عربية مفتاحية بالحقل.
 */
export function validate<T extends z.ZodType>(schema: T, input: unknown): ValidationResult<z.output<T>> {
  const result = schema.safeParse(input)
  if (result.success) return { success: true, data: result.data, errors: {} }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    if (!errors[key]) errors[key] = issue.message
  }
  return { success: false, errors, firstError: Object.values(errors)[0] }
}

/** يتحقق من مبلغ واحد ويعيد رسالة عربية */
export function checkAmountInput(raw: unknown): { ok: true; minor: number } | { ok: false; message: string } {
  const r = readAmount(raw)
  if (!r.ok) {
    const message =
      r.reason === 'empty'
        ? 'أدخل المبلغ'
        : r.reason === 'negative'
          ? 'لا يمكن تسجيل مبلغ سالب'
          : r.reason === 'too_large'
            ? 'المبلغ كبير جدًا'
            : 'المبلغ غير صالح'
    return { ok: false, message }
  }
  if (r.minor === 0) return { ok: false, message: 'لا يمكن تسجيل مبلغ صفر' }
  return { ok: true, minor: r.minor }
}
