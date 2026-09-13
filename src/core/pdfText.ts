/**
 * نص عربي/عبري جاهز للرسم في PDF — منطق نقي بلا أي مكتبة رسم.
 *
 * مشكلة PDF: لا يشكّل الحروف العربية ولا يعيد ترتيب النص من اليمين لليسار.
 * الحل هنا على مرحلتين:
 *   1) **تشكيل الحروف**: كل حرف يُحوَّل إلى شكله السياقي (مفرد/بدئي/وسطي/نهائي)
 *      من كتلة Arabic Presentation Forms-B، مع دعم الحروف التي لا تتصل بما بعدها
 *      (ا د ذ ر ز و ؤ أ إ آ ة ى …) والمدّ (ـ).
 *   2) **الترتيب البصري**: قلب المقاطع لتُقرأ من اليمين إلى اليسار مع إبقاء
 *      الأرقام والنصوص اللاتينية بترتيبها الطبيعي (خوارزمية ثنائية الاتجاه مبسّطة
 *      على مستوى المقاطع — تكفي لنصوص الفواتير وأسماء الأطراف).
 */

/* ---------------------------- جداول الحروف ---------------------------- */

/**
 * الأشكال السياقية لكل حرف: [مفرد، نهائي، بدئي، وسطي]
 * (القيمة `null` تعني أن الحرف لا يأخذ هذا الشكل أصلًا)
 */
const FORMS: Record<string, [string, string, string | null, string | null]> = {
  'ء': ['\u0621', '\u0621', null, null],
  'آ': ['\uFE81', '\uFE82', null, null],
  'أ': ['\uFE83', '\uFE84', null, null],
  'ؤ': ['\uFE85', '\uFE86', null, null],
  'إ': ['\uFE87', '\uFE88', null, null],
  'ئ': ['\uFE89', '\uFE8A', '\uFE8B', '\uFE8C'],
  'ا': ['\uFE8D', '\uFE8E', null, null],
  'ب': ['\uFE8F', '\uFE90', '\uFE91', '\uFE92'],
  'ة': ['\uFE93', '\uFE94', null, null],
  'ت': ['\uFE95', '\uFE96', '\uFE97', '\uFE98'],
  'ث': ['\uFE99', '\uFE9A', '\uFE9B', '\uFE9C'],
  'ج': ['\uFE9D', '\uFE9E', '\uFE9F', '\uFEA0'],
  'ح': ['\uFEA1', '\uFEA2', '\uFEA3', '\uFEA4'],
  'خ': ['\uFEA5', '\uFEA6', '\uFEA7', '\uFEA8'],
  'د': ['\uFEA9', '\uFEAA', null, null],
  'ذ': ['\uFEAB', '\uFEAC', null, null],
  'ر': ['\uFEAD', '\uFEAE', null, null],
  'ز': ['\uFEAF', '\uFEB0', null, null],
  'س': ['\uFEB1', '\uFEB2', '\uFEB3', '\uFEB4'],
  'ش': ['\uFEB5', '\uFEB6', '\uFEB7', '\uFEB8'],
  'ص': ['\uFEB9', '\uFEBA', '\uFEBB', '\uFEBC'],
  'ض': ['\uFEBD', '\uFEBE', '\uFEBF', '\uFEC0'],
  'ط': ['\uFEC1', '\uFEC2', '\uFEC3', '\uFEC4'],
  'ظ': ['\uFEC5', '\uFEC6', '\uFEC7', '\uFEC8'],
  'ع': ['\uFEC9', '\uFECA', '\uFECB', '\uFECC'],
  'غ': ['\uFECD', '\uFECE', '\uFECF', '\uFED0'],
  'ف': ['\uFED1', '\uFED2', '\uFED3', '\uFED4'],
  'ق': ['\uFED5', '\uFED6', '\uFED7', '\uFED8'],
  'ك': ['\uFED9', '\uFEDA', '\uFEDB', '\uFEDC'],
  'ل': ['\uFEDD', '\uFEDE', '\uFEDF', '\uFEE0'],
  'م': ['\uFEE1', '\uFEE2', '\uFEE3', '\uFEE4'],
  'ن': ['\uFEE5', '\uFEE6', '\uFEE7', '\uFEE8'],
  'ه': ['\uFEE9', '\uFEEA', '\uFEEB', '\uFEEC'],
  'و': ['\uFEED', '\uFEEE', null, null],
  'ى': ['\uFEEF', '\uFEF0', null, null],
  'ي': ['\uFEF1', '\uFEF2', '\uFEF3', '\uFEF4'],
  'ٱ': ['\uFB50', '\uFB51', null, null],
  'پ': ['\uFB56', '\uFB57', '\uFB58', '\uFB59'],
  'چ': ['\uFB7A', '\uFB7B', '\uFB7C', '\uFB7D'],
  'ژ': ['\uFB8A', '\uFB8B', null, null],
  'گ': ['\uFB92', '\uFB93', '\uFB94', '\uFB95'],
  'ک': ['\uFB8E', '\uFB8F', '\uFB90', '\uFB91'],
  'ی': ['\uFBFC', '\uFBFD', '\uFBFE', '\uFBFF'],
  'ە': ['\uFBA9', '\uFBAA', null, null],
}

/** الأشكال السياقية للام-ألف (حرفان يُرسمان شكلًا واحدًا): [مفرد، نهائي] */
const LAM_ALEF: Record<string, [string, string]> = {
  'آ': ['\uFEF5', '\uFEF6'],
  'أ': ['\uFEF7', '\uFEF8'],
  'إ': ['\uFEF9', '\uFEFA'],
  'ا': ['\uFEFB', '\uFEFC'],
}

/** حروف تتصل بما قبلها فقط (لا تتصل بما بعدها) */
const NON_JOINING_AFTER = new Set(['ا', 'أ', 'إ', 'آ', 'د', 'ذ', 'ر', 'ز', 'و', 'ؤ', 'ة', 'ى', 'ٱ', 'ء'])

/** حركات وعلامات تُدمج مع الحرف السابق */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/u

export function isArabicLetter(char: string): boolean {
  return Boolean(FORMS[char])
}

/** هل الحرف يتصل بالحرف التالي؟ */
export function joinsForward(char: string): boolean {
  return Boolean(FORMS[char]) && !NON_JOINING_AFTER.has(char)
}

/** هل الحرف يمكن أن يتصل بما قبله؟ (كل حروف الجدول ما عدا المدّ والألف المفردة) */
export function joinsBackward(char: string): boolean {
  return Boolean(FORMS[char]) && char !== 'ء'
}

/** يزيل المدّ الزائد ويحوّل الحروف اللاتينية الخاصة */
export function normalizeForPdf(input: string): string {
  return input
    .replace(/\u0640/g, '') // تطويل
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u200f|\u200e/g, '')
}

/* ---------------------------- التشكيل ---------------------------- */

/**
 * يحوّل النص العربي إلى أشكاله السياقية الجاهزة للرسم.
 * الحركات تُتجاهل في حساب الاتصال (كما تفعل محرّكات الرسم) وتبقى فوق حرفها.
 */
export function shapeArabic(input: string): string {
  const text = normalizeForPdf(input)
  const chars = Array.from(text)
  const out: string[] = []

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]!

    if (MARKS.test(char)) {
      out.push(char)
      continue
    }

    const forms = FORMS[char]
    if (!forms) {
      out.push(char)
      continue
    }

    // الحرف السابق والتالي مع تجاهل الحركات
    let prev = i - 1
    while (prev >= 0 && MARKS.test(chars[prev]!)) prev -= 1
    const prevChar = prev >= 0 ? chars[prev]! : ''

    let next = i + 1
    while (next < chars.length && MARKS.test(chars[next]!)) next += 1
    const nextChar = next < chars.length ? chars[next]! : ''

    const [iso, fin, ini, med] = forms
    const connectsBefore = Boolean(prevChar) && joinsForward(prevChar) && fin !== null
    const connectsAfter = Boolean(nextChar) && joinsBackward(nextChar) && ini !== null

    // لام + ألف ⇒ شكل مدموج واحد
    if (char === 'ل' && LAM_ALEF[nextChar] && connectsBefore) {
      const [isolatedLigature, finalLigature] = LAM_ALEF[nextChar]!
      out.push(finalLigature || isolatedLigature)
      i = next // تخطّي الألف
      continue
    }

    if (connectsBefore && connectsAfter && med) out.push(med)
    else if (connectsBefore && fin) out.push(fin)
    else if (connectsAfter && ini) out.push(ini)
    else out.push(iso)
  }

  return out.join('')
}

/* ---------------------------- الترتيب البصري ---------------------------- */

type Direction = 'rtl' | 'ltr' | 'neutral'

function directionOf(char: string): Direction {
  const code = char.codePointAt(0) ?? 0
  // عربي/عبري وعربيات العرض
  if ((code >= 0x0590 && code <= 0x08ff) || (code >= 0xfb1d && code <= 0xfeff)) return 'rtl'
  // لاتيني وأرقام ورموز الاتجاه المحايدة
  if (/[0-9]/.test(char) || (code >= 0x20 && code <= 0x40) || (code >= 0x41 && code <= 0x7a)) return 'ltr'
  return 'neutral'
}

interface Run {
  dir: Direction
  text: string
}

/** يقسّم النص إلى مقاطع حسب الاتجاه */
export function splitBidiRuns(text: string): Run[] {
  const runs: Run[] = []
  for (const char of Array.from(text)) {
    // الحركات تُلحق بالمجموعة السابقة كما هي (اتجاه حرفها الأساسي)
    if (MARKS.test(char) && runs.length > 0) {
      runs[runs.length - 1]!.text += char
      continue
    }
    const dir = directionOf(char)
    const last = runs[runs.length - 1]
    if (last && (last.dir === dir || dir === 'neutral')) {
      last.text += char
      continue
    }
    if (last && last.dir === 'neutral' && dir !== 'neutral') {
      last.dir = dir
      last.text += char
      continue
    }
    runs.push({ dir, text: char })
  }
  return runs
}

/**
 * يعيد ترتيب النص بصريًا للسطر الواحد من اليمين إلى اليسار:
 * المقاطع العربية تُقلَب، والمقاطع اللاتينية/الأرقام تبقى بترتيبها،
 * وترتيب المقاطع نفسه من اليمين لليسار.
 */
export function toVisualRtl(text: string): string {
  const runs = splitBidiRuns(text)
  const ordered = runs
    .map((run) => (run.dir === 'ltr' ? run.text : clusterMarks(run.text).reverse().join('')))
    .reverse()
  return ordered.join('')
}

/**
 * يجمع الحركات مع حرفها في وحدة واحدة (مقطع رسومي).
 * ضروري عند القلب: الحركة تبقى مع حرفها ولا تنتقل إلى الحرف المجاور.
 */
export function clusterMarks(text: string): string[] {
  const clusters: string[] = []
  for (const char of Array.from(text)) {
    if (MARKS.test(char) && clusters.length > 0) clusters[clusters.length - 1] += char
    else clusters.push(char)
  }
  return clusters
}

/** الحرف الأساسي لوحدة رسومية (أول محرف غير حركة) */
export function baseOfCluster(cluster: string): string {
  return Array.from(cluster).find((char) => !MARKS.test(char)) ?? cluster
}

/**
 * النص النهائي الجاهز للرسم في PDF: **تشكيل الحروف فقط**.
 * الترتيب البصري من اليمين لليسار يتولاه محرّك الخط في pdf-lib؛
 * إجراء القلب يدويًا يجعل النص يظهر مقلوبًا.
 */
export function preparePdfText(input: string): string {
  return shapeArabic(input)
}

/* ---------------------------- الأدوات المالية ---------------------------- */

/** تنسيق مبلغ بوحدات صغرى إلى نص لاتيني (لا يتأثر بالتشكيل) */
export function formatMinorForPdf(minor: number, decimals = 0): string {
  const units = Math.floor(Math.abs(minor) / 100)
  const frac = Math.abs(minor) % 100
  const grouped = units.toLocaleString('en-US')
  if (decimals <= 0 || frac === 0) return grouped
  return `${grouped}.${String(Math.round((frac / 100) * 10 ** decimals)).padStart(decimals, '0')}`
}
