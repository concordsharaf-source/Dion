/**
 * تشفير كلمات المرور للمحرّك المحلي
 * PBKDF2-SHA256 · 210,000 دورة · ملح عشوائي 16 بايت
 *
 * الغرض: حساب محلي على الجهاز (وضع الدفتر الشخصي بلا حساب سحابي)
 * لا تُخزَّن كلمة المرور أبدًا بصيغة مقروءة.
 */

const ITERATIONS = 210_000
const KEY_LENGTH_BITS = 256

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto?.subtle
  if (!c) throw new Error('WebCrypto غير متاح في هذه البيئة')
  return c
}

export function randomSaltHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(arr)
  return toHex(arr)
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ?? randomSaltHex()
  const enc = new TextEncoder()
  const keyMaterial = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: fromHex(salt) as unknown as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS,
  )
  return { hash: toHex(bits), salt }
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const result = await hashPassword(password, salt)
  // مقارنة ثابتة الزمن
  if (result.hash.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= result.hash.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

/** بصمة SHA-256 (تُستخدم لتخزين رموز الربط بصيغة غير قابلة للاسترجاع) */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(value))
  return toHex(digest)
}
