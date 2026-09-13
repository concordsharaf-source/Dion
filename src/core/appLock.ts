/**
 * قفل التطبيق — منطق نقي (بلا شبكة وبلا واجهة):
 *   · الوضع: مغلق (بلا قفل) / بصمة / باترن
 *   · الباترن يُخزَّن مُشتقًّا (PBKDF2-SHA256 مع ملح عشوائي) لا كنص صريح
 *   · معرّف البصمة (WebAuthn credential id) يُخزَّن محليًا للتحقق عند الفتح
 *
 * كل الاستدعاءات هنا آمنة على الخادم/الاختبارات: أي فشل في التخزين
 * يُعامَل كـ«لا قفل» بدل تعطيل التطبيق.
 */

export type LockMode = 'off' | 'biometric' | 'pattern'

export interface LockConfig {
  /** الوضع المطلوب للفتح */
  mode: LockMode
  /** هل هناك باترن مخزَّن (احتياطي أو أساسي)؟ */
  hasPattern: boolean
  /** هل هناك تفعيل بصمة مخزَّن؟ */
  hasBiometric: boolean
  /** اسم الجهاز/البصمة كما ظهر عند التفعيل */
  biometricLabel: string | null
}

export const LOCK_MODE_KEY = 'dafatar.lock.mode'
export const LOCK_PATTERN_KEY = 'dafatar.lock.pattern'
export const LOCK_CREDENTIAL_KEY = 'dafatar.lock.credential'
export const LOCK_LABEL_KEY = 'dafatar.lock.credential-label'

/** أقل عدد نقاط في الباترن (أندرويد يستخدم 4) */
export const MIN_PATTERN_LENGTH = 4
/** أقصى عدد نقاط */
export const MAX_PATTERN_LENGTH = 9

const PATTERN_SALT_BYTES = 16
const PATTERN_ITERATIONS = 60_000

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) storage()?.removeItem(key)
    else storage()?.setItem(key, value)
  } catch {
    // تخزين ممتلئ أو محجوب — لا نُعطّل التطبيق
  }
}

/* ============================ الباترن ============================ */

/** هل الباترن صالح؟ (من 4 إلى 9 نقاط بلا تكرار) */
export function isValidPattern(pattern: number[]): boolean {
  if (pattern.length < MIN_PATTERN_LENGTH || pattern.length > MAX_PATTERN_LENGTH) return false
  if (pattern.some((n) => !Number.isInteger(n) || n < 0 || n > 8)) return false
  return new Set(pattern).size === pattern.length
}

/** مفتاح نصي ثابت لمقارنة الباترن (0-1-2-5) */
export function patternToKey(pattern: number[]): string {
  return pattern.join('-')
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomSalt(): string {
  const bytes = new Uint8Array(PATTERN_SALT_BYTES)
  crypto.getRandomValues(bytes)
  return toHex(bytes.buffer)
}

async function derive(pattern: number[], saltHex: string, iterations: number): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  const encoder = new TextEncoder()
  const key = encoder.encode(patternToKey(pattern))
  if (!subtle) {
    // بيئة بلا WebCrypto: مقارنة بسيطة غير تشفيرية (لا تكسر التطبيق)
    return `plain$${saltHex}$${patternToKey(pattern)}`
  }
  const material = await subtle.importKey('raw', key, 'PBKDF2', false, ['deriveBits'])
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    256,
  )
  return `pbkdf2$${iterations}$${saltHex}$${toHex(bits)}`
}

/** يخزّن الباترن مُشتقًّا (لا يُخزَّن كنص صريح) */
export async function setPattern(pattern: number[]): Promise<void> {
  if (!isValidPattern(pattern)) throw new Error('الباترن قصير — استخدم 4 نقاط على الأقل')
  const salt = randomSalt()
  write(LOCK_PATTERN_KEY, await derive(pattern, salt, PATTERN_ITERATIONS))
  if (readLockMode() === 'off') write(LOCK_MODE_KEY, 'pattern')
}

/** يتحقق من الباترن المُدخل */
export async function verifyPattern(pattern: number[]): Promise<boolean> {
  const stored = read(LOCK_PATTERN_KEY)
  if (!stored || !isValidPattern(pattern)) return false
  const [, iterations, salt] = stored.split('$')
  if (!salt) return false
  const candidate = await derive(pattern, salt, Number(iterations) || PATTERN_ITERATIONS)
  return candidate === stored
}

/** يحذف الباترن المخزَّن */
export function clearPattern(): void {
  write(LOCK_PATTERN_KEY, null)
}

export function hasPattern(): boolean {
  return Boolean(read(LOCK_PATTERN_KEY))
}

/* ============================ معرّف البصمة ============================ */

export function readCredentialId(): string | null {
  return read(LOCK_CREDENTIAL_KEY)
}

export function writeCredentialId(id: string | null, label: string | null = null): void {
  write(LOCK_CREDENTIAL_KEY, id)
  write(LOCK_LABEL_KEY, label)
}

export function readCredentialLabel(): string | null {
  return read(LOCK_LABEL_KEY)
}

/* ============================ الوضع العام ============================ */

export function readLockMode(): LockMode {
  const value = read(LOCK_MODE_KEY)
  return value === 'biometric' || value === 'pattern' ? value : 'off'
}

export function writeLockMode(mode: LockMode): void {
  write(LOCK_MODE_KEY, mode === 'off' ? null : mode)
}

export function readLockConfig(): LockConfig {
  return {
    mode: readLockMode(),
    hasPattern: hasPattern(),
    hasBiometric: Boolean(readCredentialId()),
    biometricLabel: readCredentialLabel(),
  }
}

/** هل القفل مفعّل فعلًا؟ (الوضع مفعّل ولا بد أن تكون وسيلة الفتح متاحة) */
export function isLockEnabled(config: LockConfig = readLockConfig()): boolean {
  if (config.mode === 'biometric') return config.hasBiometric || config.hasPattern
  if (config.mode === 'pattern') return config.hasPattern
  return false
}

/** القفل الذي يجب استخدامه فعليًا (مع تراجع تلقائي للباترن) */
export function effectiveLockMode(config: LockConfig = readLockConfig()): LockMode {
  if (!isLockEnabled(config)) return 'off'
  if (config.mode === 'biometric') return config.hasBiometric ? 'biometric' : 'pattern'
  return 'pattern'
}

/** إلغاء القفل بالكامل */
export function disableLock(): void {
  write(LOCK_MODE_KEY, null)
  write(LOCK_PATTERN_KEY, null)
  write(LOCK_CREDENTIAL_KEY, null)
  write(LOCK_LABEL_KEY, null)
}

/* ============================ تشغيل القفل/إلغاؤه ============================ */

export const LOCK_GRACE_MS = 15_000
export const LOCK_HIDDEN_AT_KEY = 'dafatar.lock.hidden-at'

export function markHidden(at: number = Date.now()): void {
  write(LOCK_HIDDEN_AT_KEY, String(at))
}

export function clearHidden(): void {
  write(LOCK_HIDDEN_AT_KEY, null)
}

/** هل انقضت مدة السماح منذ آخر إخفاء للتطبيق؟ (يُستخدم عند العودة للتطبيق) */
export function shouldRelock(now: number = Date.now(), graceMs: number = LOCK_GRACE_MS): boolean {
  const raw = read(LOCK_HIDDEN_AT_KEY)
  if (!raw) return false
  const hiddenAt = Number(raw)
  if (!Number.isFinite(hiddenAt)) return false
  return now - hiddenAt > graceMs
}
