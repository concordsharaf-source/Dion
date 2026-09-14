import { describe, expect, it } from 'vitest'
import {
  authFragmentType,
  emailLinkSuccessMessage,
  hasAuthFragment,
  parseEmailLink,
  stripEmailLinkParams,
} from './emailLink'

describe('تحليل روابط البريد', () => {
  it('يفهم رابط تأكيد الحساب ويوجّه للرئيسية', () => {
    const link = parseEmailLink('?token_hash=abc123&type=email')
    expect(link).toEqual({ tokenHash: 'abc123', type: 'email', nextRoute: '/' })
  })

  it('يفهم رابط الاستعادة ويوجّه لشاشة الأمان', () => {
    const link = parseEmailLink('?type=recovery&token_hash=xyz789')
    expect(link?.type).toBe('recovery')
    expect(link?.nextRoute).toBe('/settings/security')
  })

  it('يقبل الاستعلام بلا علامة استفهام، ويفكّ ترميز الرمز', () => {
    const link = parseEmailLink('token_hash=a%2Bb%3D&type=email_change')
    expect(link?.tokenHash).toBe('a+b=')
    expect(link?.type).toBe('email_change')
  })

  it('يرفض الاستعلامات الناقصة أو غير المعروفة', () => {
    expect(parseEmailLink('')).toBeNull()
    expect(parseEmailLink('?type=email')).toBeNull()
    expect(parseEmailLink('?token_hash=abc')).toBeNull()
    expect(parseEmailLink('?token_hash=abc&type=signup')).toBeNull()
    expect(parseEmailLink('?token_hash=%20&type=email')).toBeNull()
  })

  it('يفهم رابط الدعوة ورابط الدخول بالبريد', () => {
    expect(parseEmailLink('?token_hash=inv1&type=invite')?.type).toBe('invite')
    expect(parseEmailLink('?token_hash=mag1&type=magiclink')?.type).toBe('magiclink')
  })

  it('يتجاهل روابط الدخول القديمة (access_token في الهاش)', () => {
    expect(parseEmailLink('?access_token=zzz&type=signup&refresh_token=r')).toBeNull()
  })
})

describe('رسائل الروابط وتنظيف العنوان', () => {
  it('لكل نوع رسالة مناسبة', () => {
    expect(emailLinkSuccessMessage('email')).toContain('تم تأكيد بريدك')
    expect(emailLinkSuccessMessage('recovery')).toContain('كلمة مرور جديدة')
    expect(emailLinkSuccessMessage('email_change')).toContain('بريدك الجديد')
  })

  it('يحذف رموز الرابط ويُبقي ما عداها', () => {
    expect(stripEmailLinkParams('?token_hash=abc&type=email')).toBe('')
    expect(stripEmailLinkParams('?token_hash=abc&type=email&next=%2Fparties')).toBe('?next=%2Fparties')
  })
})

describe('صيغة Supabase الافتراضية (الرمز في الهاش)', () => {
  it('يكتشف رمز الدخول في الهاش', () => {
    expect(hasAuthFragment('#access_token=abc&refresh_token=x&type=signup')).toBe(true)
    expect(hasAuthFragment('#/parties')).toBe(false)
    expect(hasAuthFragment('')).toBe(false)
  })

  it('يستخرج نوع الرابط من الهاش', () => {
    expect(authFragmentType('#access_token=abc&type=signup')).toBe('signup')
    expect(authFragmentType('#access_token=abc&type=recovery')).toBe('recovery')
    expect(authFragmentType('#access_token=abc')).toBeNull()
  })
})
