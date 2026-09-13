import { describe, expect, it } from 'vitest'
import {
  checkAmountInput,
  displayPhone,
  normalizePhoneNumber,
  partySchema,
  passwordSchema,
  sanitizeMultiline,
  sanitizeText,
  validate,
} from './validation'

describe('تنقية النصوص', () => {
  it('يزيل محارف التحكم ويوحّد المسافات', () => {
    expect(sanitizeText('  أحمد \n\n  علي  ')).toBe('أحمد علي')
    expect(sanitizeText('قيمة\u0000خبيثة')).toBe('قيمةخبيثة')
  })

  it('يحد الطول', () => {
    expect(sanitizeText('ا'.repeat(500), 10)).toHaveLength(10)
  })

  it('يحتفظ بأسطر الملاحظات', () => {
    expect(sanitizeMultiline('سطر أول\nسطر ثانٍ')).toBe('سطر أول\nسطر ثانٍ')
  })

  it('يرفض غير النصوص', () => {
    expect(sanitizeText(undefined)).toBe('')
    expect(sanitizeText(123 as unknown)).toBe('')
  })
})

describe('أرقام الهاتف', () => {
  it('يوحّد الصيغ اليمنية', () => {
    expect(normalizePhoneNumber('0771234567')).toBe('+967771234567')
    expect(normalizePhoneNumber('771234567')).toBe('+967771234567')
    expect(normalizePhoneNumber('+967 771 234 567')).toBe('+967771234567')
    expect(normalizePhoneNumber('00967771234567')).toBe('+967771234567')
    expect(normalizePhoneNumber('٧٧١٢٣٤٥٦٧')).toBe(null)
  })

  it('يرفض الأرقام غير الصالحة', () => {
    expect(normalizePhoneNumber('123')).toBe(null)
    expect(normalizePhoneNumber('')).toBe(null)
    expect(normalizePhoneNumber(undefined)).toBe(null)
  })

  it('يعرض الرقم بصيغة مقروءة', () => {
    expect(displayPhone('+967771234567')).toBe('771 234 567')
    expect(displayPhone(null)).toBe('')
  })
})

describe('مخطط الطرف (محل/عميل)', () => {
  it('يقبل بيانات صحيحة', () => {
    const r = validate(partySchema, { name: 'بقالة النور', phone: '0771234567', openingAmount: '50,000' })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('بقالة النور')
    expect(r.data?.phone).toBe('+967771234567')
    expect(r.data?.openingAmount).toBe(5_000_000)
  })

  it('يرفض الاسم الفارغ', () => {
    const r = validate(partySchema, { name: '   ' })
    expect(r.success).toBe(false)
    expect(r.errors.name).toBe('أدخل الاسم')
  })

  it('يرفض الهاتف غير الصالح', () => {
    const r = validate(partySchema, { name: 'أحمد', phone: '12' })
    expect(r.success).toBe(false)
    expect(r.errors.phone).toBe('رقم الهاتف غير صحيح')
  })

  it('يقبل الاسم بدون هاتف (الهاتف اختياري)', () => {
    const r = validate(partySchema, { name: 'أحمد' })
    expect(r.success).toBe(true)
    expect(r.data?.phone).toBe(null)
  })

  it('يرفض رصيدًا افتتاحيًا سالبًا', () => {
    const r = validate(partySchema, { name: 'أحمد', openingAmount: '-5000' })
    expect(r.success).toBe(false)
  })
})

describe('التحقق من المبالغ', () => {
  it('يقبل المبالغ الصحيحة بصيغ عربية', () => {
    expect(checkAmountInput('20,000')).toEqual({ ok: true, minor: 2_000_000 })
    expect(checkAmountInput('٢٠٬٠٠٠')).toEqual({ ok: true, minor: 2_000_000 })
  })

  it('يرفض الصفر والفراغ والمبالغ السالبة', () => {
    expect(checkAmountInput('0')).toEqual({ ok: false, message: 'لا يمكن تسجيل مبلغ صفر' })
    expect(checkAmountInput('')?.ok).toBe(false)
    expect(checkAmountInput('-100')?.ok).toBe(false)
  })
})

describe('كلمة المرور', () => {
  it('تقبل الأرقام وحدها بلا فرض حروف أو رموز', () => {
    expect(passwordSchema.safeParse('1234').success).toBe(true)
    expect(passwordSchema.safeParse('12345678').success).toBe(true)
    expect(passwordSchema.safeParse('abcd').success).toBe(true)
    expect(passwordSchema.safeParse('123456').success).toBe(true)
  })

  it('ترفض الأقل من 4 خانات', () => {
    const r = passwordSchema.safeParse('123')
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('كلمة المرور 4 خانات على الأقل')
  })
})
