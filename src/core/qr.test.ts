import { describe, expect, it } from 'vitest'
import {
  assertLinkUsable,
  buildLinkUrl,
  codeToToken,
  expiryFromNow,
  generateToken,
  isExpired,
  LINK_TTL_MS,
  parseLinkPayload,
  secondsRemaining,
  tokenToCode,
} from './qr'
import { AppError } from './errors'

describe('توليد رمز الربط', () => {
  it('ينتج رموزًا عشوائية قوية ومختلفة', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(tokens.size).toBe(200)
    const t = generateToken()
    // 24 بايت = 32 محرف base64url
    expect(t.length).toBeGreaterThanOrEqual(30)
    expect(t).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('لا يحتوي الرمز أي بيانات مالية أو شخصية', () => {
    const token = generateToken()
    expect(token).not.toMatch(/\d{4,}/) // لا أرقام مبالغ
    expect(token).not.toMatch(/@/) // لا بريد
  })

  it('الكود اليدوي يعيد نفس الرمز بالضبط', () => {
    for (let i = 0; i < 30; i++) {
      const token = generateToken()
      const code = tokenToCode(token)
      expect(codeToToken(code)).toBe(token)
    }
  })

  it('الكود اليدوي لا يستخدم أحرفًا مُلتبسة', () => {
    const code = tokenToCode(generateToken())
    expect(code).not.toMatch(/[OI01]/)
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4})*(-[2-9A-HJ-NP-Z]{1,4})?$/)
  })

  it('الكود اليدوي يقبل الإدخال بمسافات وشرطات مختلفة', () => {
    const token = generateToken()
    const code = tokenToCode(token)
    expect(codeToToken(code.replace(/-/g, ' '))).toBe(token)
    expect(codeToToken(code.toLowerCase())).toBe(token)
  })
})

describe('صلاحية الرمز', () => {
  it('ينتهي بعد المدة المحددة', () => {
    const now = Date.now()
    const expiresAt = expiryFromNow(LINK_TTL_MS, now)
    expect(isExpired(expiresAt, now)).toBe(false)
    expect(isExpired(expiresAt, now + LINK_TTL_MS - 1000)).toBe(false)
    expect(isExpired(expiresAt, now + LINK_TTL_MS + 1)).toBe(true)
  })

  it('مدة رمز الربط 10 دقائق', () => {
    expect(LINK_TTL_MS).toBe(600_000)
  })

  it('يعرض الوقت المتبقي', () => {
    const now = Date.now()
    const expiresAt = new Date(now + 90_000).toISOString()
    expect(secondsRemaining(expiresAt, now)).toBe(90)
  })

  it('يرفض الرمز المنتهي', () => {
    const expired = { expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'awaiting_scan' }
    expect(() => assertLinkUsable(expired)).toThrow(AppError)
    try {
      assertLinkUsable(expired)
    } catch (e) {
      expect((e as AppError).code).toBe('link_expired')
    }
  })

  it('يرفض الرمز المستخدَم مرة واحدة', () => {
    const used = { expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'accepted' }
    try {
      assertLinkUsable(used)
      throw new Error('كان يجب أن يفشل')
    } catch (e) {
      expect((e as AppError).code).toBe('link_used')
    }
  })

  it('يرفض الرمز غير الموجود', () => {
    expect(() => assertLinkUsable(null)).toThrow(AppError)
  })

  it('يقبل الرمز الصالح المعلّق', () => {
    const ok = { expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'pending' }
    expect(() => assertLinkUsable(ok)).not.toThrow()
  })
})

describe('محتوى الـ QR والرابط', () => {
	it('يبني رابطًا ويستخرجه من جديد', () => {
		const token = generateToken()
		const url = buildLinkUrl(token, 'https://example.com')
		expect(url).toBe(`https://example.com/#/link/scan?t=${encodeURIComponent(token)}`)
		expect(parseLinkPayload(url)).toBe(token)
	})

	it('يستخرج الرابط المنسوخ مع نص محيط وترميز URL', () => {
		const token = generateToken()
		const url = buildLinkUrl(token, 'https://example.com')
		expect(parseLinkPayload(`افتح الرابط: ${url} الآن`)).toBe(token)
		expect(parseLinkPayload(url.replace(token, encodeURIComponent(token)))).toBe(token)
	})

	it('يستخرج الرمز من الكود اليدوي', () => {
		const token = generateToken()
		expect(parseLinkPayload(tokenToCode(token))).toBe(token)
	})

	it('يستخرج الرمز الخام كما هو ولا يحوله إلى كود يدوي', () => {
		const token = generateToken()
		expect(parseLinkPayload(token)).toBe(token)
	})

  it('يرفض المحتوى غير الصالح', () => {
    expect(parseLinkPayload('')).toBe(null)
    expect(parseLinkPayload('مرحبًا بالعالم')).toBe(null)
    expect(parseLinkPayload('http://evil.com')).toBe(null)
  })

  it('لا يحتوي أي مبلغ أو بيانات مالية', () => {
    const url = buildLinkUrl(generateToken(), 'https://example.com')
    expect(url).not.toContain('amount')
    expect(url).not.toContain('20000')
    expect(url).not.toContain('password')
  })
})
