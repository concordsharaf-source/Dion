/**
 * المال — تمثيل دقيق بلا أخطاء الفواصل العشرية (Float)
 *
 * القاعدة:
 *   - التمثيل الداخلي = عدد صحيح من الوحدات الصغرى (1 وحدة كبرى = 100 صغرى)
 *   - جميع الحسابات على الأعداد الصحيحة فقط → لا كسور عائمة، ولا 0.1 + 0.2
 *   - في PostgreSQL: numeric(18,2) — تطابق تام مع الوحدة الصغرى
 *   - لا يعرف هذا الملف أي عملة بعينها: العملة إعداد قابل للتغيير
 */

/** الوحدات الصغرى لكل وحدة كبرى (ثابت = 2 خانات عشرية) */
export const SCALE = 100

/** أقصى مبلغ مسموح: 999,999,999,999.99 (12 خانة قبل الفاصلة) */
export const MAX_MINOR = 99_999_999_999_999

export type Minor = number

export interface Currency {
  /** رمز ISO */
  code: string
  /** الاسم بالعربية */
  name: string
  /** الرمز المختصر المعروض */
  symbol: string
  /** عدد الخانات العشرية المعروضة (0 = بدون هللات) */
  decimals: number
  /** وضع إضافي اختياري */
  suffix?: boolean
}

/** العملات المدعومة — الافتراضي: ريال يمني */
export const CURRENCIES: Record<string, Currency> = {
  YER: { code: 'YER', name: 'ريال يمني', symbol: 'ر.ي', decimals: 0 },
  SAR: { code: 'SAR', name: 'ريال سعودي', symbol: 'ر.س', decimals: 2 },
  AED: { code: 'AED', name: 'درهم إماراتي', symbol: 'د.إ', decimals: 2 },
  OMR: { code: 'OMR', name: 'ريال عماني', symbol: 'ر.ع', decimals: 3 },
  USD: { code: 'USD', name: 'دولار أمريكي', symbol: '$', decimals: 2, suffix: false },
  EUR: { code: 'EUR', name: 'يورو', symbol: '€', decimals: 2, suffix: false },
  EGP: { code: 'EGP', name: 'جنيه مصري', symbol: 'ج.م', decimals: 2 },
  JOD: { code: 'JOD', name: 'دينار أردني', symbol: 'د.أ', decimals: 3 },
  SDG: { code: 'SDG', name: 'جنيه سوداني', symbol: 'ج.س', decimals: 2 },
  DJF: { code: 'DJF', name: 'فرنك جيبوتي', symbol: 'ف.ج', decimals: 0 },
}

export const DEFAULT_CURRENCY = 'YER'

export function getCurrency(code: string | undefined | null): Currency {
  if (!code) return CURRENCIES[DEFAULT_CURRENCY]
  return CURRENCIES[code.toUpperCase()] ?? { code, name: code, symbol: code, decimals: 2 }
}

/* ------------------------------------------------------------------
   تحويل المدخلات النصية إلى وحدات صغرى
   ------------------------------------------------------------------ */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹'

/** يحوّل الأرقام العربية/الفارسية إلى أرقام لاتينية */
export function normalizeDigits(input: string): string {
  let out = ''
  for (const ch of input) {
    const ai = ARABIC_INDIC.indexOf(ch)
    if (ai >= 0) {
      out += String(ai)
      continue
    }
    const ei = EXT_ARABIC_INDIC.indexOf(ch)
    if (ei >= 0) {
      out += String(ei)
      continue
    }
    out += ch
  }
  return out
}

export type ParseResult =
  | { ok: true; minor: Minor; negative: boolean }
  | { ok: false; reason: 'empty' | 'invalid' | 'too_large' | 'too_many_decimals' }

/**
 * يقرأ مبلغًا مكتوبًا بأي صيغة عربية شائعة:
 *   "20,000" · "٢٠٬٠٠٠٫٥" · "20 000.50" · "1,234.5"
 * الفاصلة العشرية: "." أو "٫" — وفاصلة الآلاف: "," أو "٬" أو مسافة
 */
export function parseAmount(raw: string | number | null | undefined): ParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: 'empty' }

  let s = typeof raw === 'number' ? String(raw) : normalizeDigits(String(raw))

  // مسافات بأنواعها
  s = s.replace(/[\u200f\u200e\u00a0\u202f\s]/g, '')
  if (!s) return { ok: false, reason: 'empty' }

  let negative = false
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }

  // فاصلة الآلاف (العربية ٬ واللاتينية ,)
  s = s.replace(/[,\u066c]/g, '')
  // الفاصلة العشرية العربية
  s = s.replace(/\u066b/g, '.')

  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') return { ok: false, reason: 'invalid' }

  const [intPart = '', fracPartRaw = ''] = s.split('.')
  if (fracPartRaw.length > 2) return { ok: false, reason: 'too_many_decimals' }

  const intDigits = intPart.replace(/^0+(?=\d)/, '')
  if (intDigits.length > 12) return { ok: false, reason: 'too_large' }

  const frac = (fracPartRaw + '00').slice(0, 2)
  const minor = Number(intDigits || '0') * SCALE + Number(frac)
  if (!Number.isFinite(minor)) return { ok: false, reason: 'too_large' }
  if (minor > MAX_MINOR) return { ok: false, reason: 'too_large' }

  return { ok: true, minor, negative }
}

/** يقرأ مبلغًا ويرفض الحالات غير الصالحة (يُستخدم في التحقق) */
export function readAmount(raw: unknown):
  | { ok: true; minor: Minor }
  | { ok: false; reason: 'empty' | 'invalid' | 'too_large' | 'too_many_decimals' | 'negative' } {
  const r = parseAmount(typeof raw === 'string' || typeof raw === 'number' ? raw : null)
  if (!r.ok) return r
  if (r.negative && r.minor !== 0) return { ok: false, reason: 'negative' }
  return { ok: true, minor: r.minor }
}

/* ------------------------------------------------------------------
   التنسيق للعرض
   ------------------------------------------------------------------ */

export interface FormatOptions {
  /** نمط الأرقام المعروض */
  numerals?: 'latin' | 'arabic'
  /** إظهار رمز العملة */
  withSymbol?: boolean
  /** إظهار الإشارة الموجبة (+) */
  signed?: boolean
  /** إظهار الكسور الصفرية */
  trimZeros?: boolean
}

function groupDigits(intStr: string, separator = ','): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

function toArabicDigits(s: string): string {
  return s.replace(/\d/g, (d) => ARABIC_INDIC[Number(d)])
}

/**
 * يحوّل الوحدات الصغرى إلى نص منسّق.
 * مثال: 2_000_000 + YER → "20,000 ر.ي"
 */
export function formatAmount(minor: Minor, currency: Currency | string = DEFAULT_CURRENCY, opts: FormatOptions = {}): string {
  const cur = typeof currency === 'string' ? getCurrency(currency) : currency
  const { numerals = 'latin', withSymbol = true, signed = false, trimZeros = true } = opts

  const safe = Number.isFinite(minor) ? Math.round(minor) : 0
  const neg = safe < 0
  const abs = Math.abs(safe)

  const units = Math.floor(abs / SCALE)
  const frac = abs % SCALE

  let num = groupDigits(String(units))
  const showDecimals = cur.decimals > 0 && !(trimZeros && frac === 0)
  if (cur.decimals > 0) {
    if (showDecimals) {
      num += '.' + String(Math.round((frac / SCALE) * Math.pow(10, cur.decimals))).padStart(cur.decimals, '0').slice(0, cur.decimals)
    }
  }

  if (numerals === 'arabic') {
    num = toArabicDigits(num.replace(/,/g, '\u066c'))
  }

  const sign = neg ? '−' : signed && safe > 0 ? '+' : ''
  const body = `${sign}${num}`
  if (!withSymbol) return body
  return cur.suffix === false ? `${cur.symbol} ${body}` : `${body} ${cur.symbol}`
}

/** بدون رمز العملة — للأرقام الكبيرة في اللوحات */
export function formatNumber(minor: Minor, numerals: 'latin' | 'arabic' = 'latin'): string {
  return formatAmount(minor, { code: 'X', name: '', symbol: '', decimals: 2 }, { withSymbol: false, numerals })
}

/** تحويل الوحدات الصغرى إلى نص عشري لتخزينه في PostgreSQL numeric(18,2) */
export function toDecimalString(minor: Minor): string {
  const safe = Math.round(Number.isFinite(minor) ? minor : 0)
  const neg = safe < 0
  const abs = Math.abs(safe)
  return `${neg ? '-' : ''}${Math.floor(abs / SCALE)}.${String(abs % SCALE).padStart(2, '0')}`
}

/** قراءة قيمة قادمة من قاعدة البيانات: "20000.00" → 2000000 */
export function fromDecimalString(value: string | number | null | undefined): Minor {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Math.round(value * SCALE)
  const r = parseAmount(value)
  return r.ok ? (r.negative ? -r.minor : r.minor) : 0
}

/* ------------------------------------------------------------------
   عمليات حسابية آمنة (أعداد صحيحة فقط)
   ------------------------------------------------------------------ */

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((a, b) => a + Math.round(b), 0)
}

export function subMinor(a: Minor, b: Minor): Minor {
  return Math.round(a) - Math.round(b)
}

export function isZero(minor: Minor): boolean {
  return Math.round(minor) === 0
}

export function isPositive(minor: Minor): boolean {
  return Math.round(minor) > 0
}

export function isNegative(minor: Minor): boolean {
  return Math.round(minor) < 0
}

/** النسبة المئوية من مبلغ (تقريب إلى أقرب وحدة صغرى) */
export function percentOf(minor: Minor, percent: number): Minor {
  return Math.round((minor * percent) / 100)
}

/** حصة السداد من الدين (0..1) — للعرض في الأشرطة */
export function paymentRatio(paid: Minor, total: Minor): number {
  if (total <= 0) return paid > 0 ? 1 : 0
  const r = paid / total
  return Math.max(0, Math.min(1, r))
}
