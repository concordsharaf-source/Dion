/**
 * رموز الربط عبر QR — أمان أولًا
 *
 * مواصفات الرمز (كما هو مطلوب):
 *   ✔ عشوائي مشفّر قوي (192 بت من crypto.getRandomValues)
 *   ✔ صعب التخمين
 *   ✔ قصير العمر (10 دقائق افتراضيًا) وينتهي تلقائيًا
 *   ✔ للاستخدام مرة واحدة
 *   ✔ مرتبط بحساب التاجر في قاعدة البيانات
 *   ✘ لا يحتوي كلمة مرور
 *   ✘ لا يحتوي مبلغًا
 *   ✘ لا يحتوي أي بيانات مالية أو شخصية
 *
 * ما يحتويه الـ QR فعليًا: رابط + رمز عشوائي فقط. لا شيء آخر.
 */

import { appError } from './errors'

/** مدة صلاحية رمز الربط: 10 دقائق */
export const LINK_TTL_MS = 10 * 60 * 1000
/** أقصر مدة نقبلها للاختبار */
export const LINK_TTL_MIN_MS = 30 * 1000

/**
 * أبجدية base32 من 32 محرفًا بلا الأحرف المُلتبسة (O و I) وبلا الصفر والواحد،
 * لتقليل خطأ الإدخال اليدوي: 2-9 ثم الحروف بلا I و O.
 */
const BASE32_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/* ============================ التوليد ============================ */

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const c = globalThis.crypto
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    // احتياطي نظري فقط (لا يُستخدم في المتصفحات الحديثة)
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

/**
 * رمز عشوائي 192-بت بترميز base64url (يُستخدم داخل رابط QR)
 */
export function generateToken(byteLength = 24): string {
  const bytes = randomBytes(byteLength)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** يحوّل الرمز إلى كود base32 قابل للإدخال اليدوي (مجموعات من 4) */
export function tokenToCode(token: string, groupSize = 4): string {
  const bytes = base64UrlToBytes(token)
  let bits = 0
  let value = 0
  let out = ''

  for (const byte of bytes) {
    value = ((value << 8) | byte) >>> 0
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    // نُبقي البتات غير المستهلكة فقط (منعًا لفيض 32 بت)
    value = bits === 0 ? 0 : value & ((1 << bits) - 1)
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]

  // مجموعات لتسهيل القراءة
  const groups: string[] = []
  for (let i = 0; i < out.length; i += groupSize) groups.push(out.slice(i, i + groupSize))
  return groups.join('-')
}

/** يعيد الكود إلى صيغة الرمز الأصلية */
export function codeToToken(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (((value << 5) | idx) >>> 0) & 0xffffffff
    bits += 5
    while (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
    value = bits === 0 ? 0 : value & ((1 << bits) - 1)
  }
  return bytesToBase64Url(new Uint8Array(bytes))
}

function base64UrlToBytes(token: string): Uint8Array {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/* ============================ المدة والصلاحية ============================ */

export function expiryFromNow(ttlMs: number = LINK_TTL_MS, now: number = Date.now()): string {
  return new Date(now + ttlMs).toISOString()
}

export function isExpired(expiresAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(expiresAt)
  if (Number.isNaN(t)) return true
  return t <= now
}

/** المدة المتبقية بالثواني */
export function secondsRemaining(expiresAt: string, now: number = Date.now()): number {
  const t = Date.parse(expiresAt)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((t - now) / 1000))
}

/** يتحقق من صلاحية طلب ربط ويعيد خطأ عربيًا مناسبًا */
export function assertLinkUsable(
  request: { expiresAt: string; status: string } | null | undefined,
  now: number = Date.now(),
): void {
  if (!request) throw appError('link_invalid')
  if (request.status === 'accepted' || request.status === 'rejected' || request.status === 'expired') {
    throw appError('link_used')
  }
  if (request.status === 'cancelled') throw appError('link_invalid')
  if (isExpired(request.expiresAt, now)) throw appError('link_expired')
}

/* ============================ الرابط ============================ */

export const LINK_SCHEME = 'dafatar'

/**
 * محتوى QR: رابط فقط. لا بيانات مالية، لا أسماء، لا معرّفات أخرى.
 */
export function buildLinkUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : 'https://localhost')
  return `${base.replace(/\/$/, '')}/#/link/scan?t=${encodeURIComponent(token)}`
}

/** يستخرج الرمز من أي نص مقروء من QR أو رابط أو كود يدوي */
export function parseLinkPayload(payload: string): string | null {
  const raw = (payload ?? '').trim()
  if (!raw) return null

  // رابط فيه ?t=...
  const m = raw.match(/[?&]t=([A-Za-z0-9\-_]+)/)
  if (m) return m[1]

  // صيغة dafatar://link/<token>
  const scheme = raw.match(new RegExp(`^${LINK_SCHEME}://link/([A-Za-z0-9\\-_]+)$`, 'i'))
  if (scheme) return scheme[1]

  // رمز يدوي مجموعات
  if (/^[A-Za-z0-9\-\s]{16,}$/.test(raw)) {
    const token = codeToToken(raw)
    return token.length >= 16 ? token : null
  }

  // رمز خام base64url
  if (/^[A-Za-z0-9\-_]{16,64}$/.test(raw)) return raw

  return null
}
