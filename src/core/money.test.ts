import { describe, expect, it } from 'vitest'
import {
  addMinor,
  formatAmount,
  fromDecimalString,
  getCurrency,
  normalizeDigits,
  parseAmount,
  paymentRatio,
  percentOf,
  readAmount,
  subMinor,
  toDecimalString,
} from './money'

describe('تحويل الأرقام العربية', () => {
  it('يحوّل الأرقام العربية إلى لاتينية', () => {
    expect(normalizeDigits('٢٠٬٠٠٠')).toBe('20٬000')
    expect(normalizeDigits('۱۲۳')).toBe('123')
  })
})

describe('قراءة المبالغ', () => {
  it('يقرأ الأرقام اللاتينية بفواصل الآلاف', () => {
    expect(parseAmount('20,000')).toEqual({ ok: true, minor: 2_000_000, negative: false })
    expect(parseAmount('1,234,567')).toEqual({ ok: true, minor: 123_456_700, negative: false })
  })

  it('يقرأ الأرقام العربية بفواصلها', () => {
    expect(parseAmount('٢٠٬٠٠٠')).toEqual({ ok: true, minor: 2_000_000, negative: false })
    expect(parseAmount('٥٠٠٫٥٠')).toEqual({ ok: true, minor: 50_050, negative: false })
  })

  it('يقرأ الكسور العشرية بدقة', () => {
    expect(parseAmount('0.1')).toEqual({ ok: true, minor: 10, negative: false })
    expect(parseAmount('0.2')).toEqual({ ok: true, minor: 20, negative: false })
    expect(parseAmount('0.01')).toEqual({ ok: true, minor: 1, negative: false })
    // 0.1 + 0.2 بالوحدات الصغرى = 30 بالضبط (لا خطأ عائم)
    const a = parseAmount('0.1')
    const b = parseAmount('0.2')
    if (a.ok && b.ok) expect(addMinor(a.minor, b.minor)).toBe(30)
  })

  it('يرفض المدخلات غير الصالحة', () => {
    expect(parseAmount('')).toEqual({ ok: false, reason: 'empty' })
    expect(parseAmount('abc')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseAmount('12.345')).toEqual({ ok: false, reason: 'too_many_decimals' })
    expect(parseAmount('9999999999999')).toEqual({ ok: false, reason: 'too_large' })
  })

  it('يكشف الإشارة السالبة', () => {
    expect(readAmount('-500')).toEqual({ ok: false, reason: 'negative' })
    expect(parseAmount('-500')).toEqual({ ok: true, minor: 50_000, negative: true })
  })

  it('يقبل المسافات ومحارف الاتجاه', () => {
    expect(parseAmount('20\u00a0000')).toEqual({ ok: true, minor: 2_000_000, negative: false })
    expect(parseAmount('\u200f25,000')).toEqual({ ok: true, minor: 2_500_000, negative: false })
  })
})

describe('تنسيق المبالغ', () => {
  it('ينسّق بالريال اليمني بلا كسور', () => {
    expect(formatAmount(2_000_000, 'YER')).toBe('20,000 ر.ي')
    expect(formatAmount(2_000_050, 'YER')).toBe('20,000 ر.ي')
    expect(formatAmount(7_500_000, getCurrency('YER'))).toBe('75,000 ر.ي')
  })

  it('ينسّق العملات ذات الكسور', () => {
    expect(formatAmount(2_000_050, 'SAR')).toBe('20,000.50 ر.س')
    expect(formatAmount(2_000_000, 'SAR')).toBe('20,000 ر.س')
  })

  it('ينسّق بالأرقام العربية عند الطلب', () => {
    expect(formatAmount(2_000_000, 'YER', { numerals: 'arabic' })).toBe('٢٠٬٠٠٠ ر.ي')
  })

  it('يعرض الإشارة الموجبة عند الطلب', () => {
    expect(formatAmount(1_000_000, 'YER', { signed: true, withSymbol: false })).toBe('+10,000')
    expect(formatAmount(-1_000_000, 'YER', { withSymbol: false })).toBe('−10,000')
  })
})

describe('التحويل إلى التخزين والعكس', () => {
  it('يحوّل إلى نص عشري متوافق مع numeric(18,2)', () => {
    expect(toDecimalString(2_000_000)).toBe('20000.00')
    expect(toDecimalString(50_050)).toBe('500.50')
    expect(toDecimalString(5)).toBe('0.05')
    expect(toDecimalString(-1_500)).toBe('-15.00')
  })

  it('يقرأ من قاعدة البيانات', () => {
    expect(fromDecimalString('20000.00')).toBe(2_000_000)
    expect(fromDecimalString(20000)).toBe(2_000_000)
    expect(fromDecimalString(null)).toBe(0)
  })

  it('رحلة كاملة لا تفقد أي هللة', () => {
    for (const v of [1, 99, 100, 12_345, 999_999_999]) {
      expect(fromDecimalString(toDecimalString(v))).toBe(v)
    }
  })
})

describe('عمليات حسابية', () => {
  it('يجمع ويطرح بدقة', () => {
    expect(subMinor(2_000_000, 1_000_000)).toBe(1_000_000)
    expect(addMinor(1, 2, 3)).toBe(6)
  })

  it('يحسب النسبة المئوية', () => {
    expect(percentOf(10_000, 25)).toBe(2_500)
  })

  it('يحسب نسبة السداد بحدود 0..1', () => {
    expect(paymentRatio(2_500_000, 10_000_000)).toBe(0.25)
    expect(paymentRatio(20_000_000, 10_000_000)).toBe(1)
    expect(paymentRatio(0, 0)).toBe(0)
  })
})
