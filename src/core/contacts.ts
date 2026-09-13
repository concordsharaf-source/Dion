/**
 * استيراد جهات الاتصال — تحليل خالص (بلا DOM) لملفات vCard وCSV.
 *
 * يعمل مع:
 *   · تصدير أندرويد/آيفون لجهة اتصال واحدة أو كل الجهات (.vcf / vCard 3.0 و4.0)
 *   · تصدير Google Contacts وExcel (.csv بفواصل , أو ; أو Tab)
 *
 * المنطق هنا نقي وقابل للاختبار؛ الواجهة (`ContactImportButton`) هي التي تتعامل مع
 * منتقي جهات الاتصال الأصلي في النظام أو مع ملف يختاره المستخدم.
 */
import { normalizeArabic } from '@/core/balance'

export interface ImportedContact {
  /** الاسم كما هو في جهة الاتصال (قد يكون فارغًا) */
  name: string | null
  /** أفضل رقم هاتف (مُهيّأ للعرض) — قد يكون فارغًا */
  phone: string | null
}

/* ============================ أدوات مساعدة ============================ */

/** ينظّف رقم الهاتف من التنسيقات ليصبح صالحًا للإدخال: +967771234567 */
export function cleanPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let value = trimmed.replace(/[\u200e\u200f\u00a0]/g, '').replace(/^tel:/i, '').trim()
  // يحوّل الأرقام العربية إلى لاتينية قبل الفحص
  value = value.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
  const plus = value.trim().startsWith('+') || value.trim().startsWith('00')
  const digits = value.replace(/\D/g, '')
  if (digits.length < 6) return null
  return plus ? `+${digits.replace(/^00/, '')}` : digits
}

/** هل يوجد منتقي جهات اتصال أصلي (Contact Picker API — كروم على أندرويد)؟ */
export function hasContactsPicker(nav: unknown): boolean {
  const contacts = (nav as { contacts?: { select?: unknown } } | null | undefined)?.contacts
  return typeof contacts?.select === 'function'
}

/** ترتيب أولوية نوع الرقم: الجوال أولًا، ثم أي رقم، ويُستبعد الفاكس */
export function scorePhoneType(params: string): number {
  const p = params.toLowerCase()
  if (/fax|pager|beeper/.test(p)) return 0
  if (/cell|mobile|iphone|android/.test(p)) return 3
  if (p.includes('pref')) return 2.5
  if (/home|work|main|voice|other/.test(p)) return 2
  return 1
}

/** يختار أفضل رقم من قائمة مرشّحين */
export function pickBestPhone(candidates: { value: string; score: number }[]): string | null {
  const usable = candidates
    .map((c) => ({ ...c, cleaned: cleanPhone(c.value) }))
    .filter((c): c is { value: string; score: number; cleaned: string } => Boolean(c.cleaned) && c.score > 0)
  if (usable.length === 0) return null
  usable.sort((a, b) => b.score - a.score)
  return usable[0]!.cleaned
}

/* ============================ vCard ============================ */

function unescapeVCardValue(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim()
}

/** يفتح الأسطر المطويّة في vCard (السطر التالي يبدأ بمسافة أو Tab) */
export function unfoldVCards(text: string): string {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
}

export function parseVCards(text: string): ImportedContact[] {
  const cards = unfoldVCards(text).split(/BEGIN:VCARD/i).slice(1)
  const out: ImportedContact[] = []

  for (const card of cards) {
    const body = card.split(/END:VCARD/i)[0] ?? ''
    const lines = body.split(/\r?\n/)

    let fn: string | null = null
    let structured: string | null = null
    let org: string | null = null
    const phones: { value: string; score: number }[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const colon = line.indexOf(':')
      if (colon <= 0) continue

      const rawKey = line.slice(0, colon)
      const rawValue = line.slice(colon + 1)
      const keyParts = rawKey.split(';')
      // تصدير آبل يضيف بادئة المجموعة: item1.TEL
      const prop = keyParts[0]!.replace(/^item\d+\./i, '').replace(/^[^.]+\.(?=[A-Z])/, '').toUpperCase()
      const params = keyParts.slice(1).join(';')
      const value = unescapeVCardValue(rawValue)
      if (!value) continue

      if (prop === 'FN' && !fn) fn = value
      else if (prop === 'N' && !structured) {
        const parts = value.split(';').map((p) => p.trim())
        const composed = parts.length >= 2 ? `${parts[1] ?? ''} ${parts[0] ?? ''}`.trim() : parts.join(' ').trim()
        structured = composed || null
      } else if (prop === 'ORG' && !org) {
        org = value.replace(/;+$/, '').trim() || null
      } else if (prop === 'TEL') {
        phones.push({ value, score: scorePhoneType(params) })
      }
    }

    const name = fn ?? structured ?? org
    const phone = pickBestPhone(phones)
    if (name || phone) out.push({ name, phone })
  }

  return out
}

/* ============================ CSV ============================ */

function detectDelimiter(line: string): string {
  const counts: [string, number][] = [
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
}

/** قارئ CSV يراعي علامات التنصيص والأسطر المتعددة داخل الحقل */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function headerIndex(header: string[], matchers: ((h: string) => number)[]): number {
  for (const match of matchers) {
    let best = -1
    let bestScore = 0
    header.forEach((cell, index) => {
      const score = match(cell)
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    if (best >= 0) return best
  }
  return -1
}

const NAME_MATCHERS: ((h: string) => number)[] = [
  (h) => (h === 'fn' || h === 'name' || h.includes('display name') || h === 'الاسم' || h.includes('الاسم الكامل') ? 10 : 0),
  (h) => (h.includes('given name') || h.includes('first name') || h.includes('اسم') ? 8 : 0),
  (h) => (h.includes('name') ? 6 : 0),
]

const PHONE_MATCHERS: ((h: string) => number)[] = [
  (h) => (h.includes('phone') && /(1|primary)/.test(h) ? 10 : 0),
  (h) => (/mobile|جوال|موبايل/.test(h) ? 9 : 0),
  (h) => (/phone|tel|هاتف|جوال|تلفون|رقم/.test(h) ? 7 : 0),
]

export function parseContactsCsv(text: string): ImportedContact[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const rows = parseCsvRows(text, delimiter)
  if (rows.length === 0) return []

  const header = rows[0]!.map((cell) => normalizeArabic(cell).toLowerCase().trim())
  let nameIndex = headerIndex(header, NAME_MATCHERS)
  let phoneIndex = headerIndex(header, PHONE_MATCHERS)
  let hasHeader = nameIndex >= 0 || phoneIndex >= 0
  let dataRows = hasHeader ? rows.slice(1) : rows

  // لا عناوين مفهومة؟ نستنتج الأعمدة من شكل البيانات نفسها
  if (!hasHeader) {
    const columns = rows[0]!.length
    let bestPhone = -1
    let bestCount = 0
    for (let c = 0; c < columns; c += 1) {
      const count = rows.filter((r) => (r[c] ?? '').replace(/\D/g, '').length >= 7).length
      if (count > bestCount) {
        bestCount = count
        bestPhone = c
      }
    }
    if (bestPhone < 0) return []
    phoneIndex = bestPhone
    nameIndex = rows[0]!.findIndex((_, c) => c !== bestPhone && rows.filter((r) => (r[c] ?? '').trim().length >= 2).length > 0)
    hasHeader = false
    dataRows = rows
  }

  if (phoneIndex < 0 && nameIndex < 0) return []

  const out: ImportedContact[] = []
  for (const row of dataRows) {
    const phone = phoneIndex >= 0 ? cleanPhone(row[phoneIndex] ?? '') : null
    const rawName = nameIndex >= 0 ? (row[nameIndex] ?? '').trim() : ''
    const name = rawName || null
    if (name || phone) out.push({ name, phone })
  }
  return out
}

/** يقرأ ملفًا نصيًا لجهات الاتصال ويختار المُحلِّل المناسب */
export function parseContactsFile(text: string): ImportedContact[] {
  if (!text || !text.trim()) return []
  const list = /BEGIN:VCARD/i.test(text) ? parseVCards(text) : parseContactsCsv(text)
  return dedupeContacts(list)
}

/** يزيل التكرار (نفس الرقم أو نفس الاسم بلا رقم) */
export function dedupeContacts(contacts: ImportedContact[]): ImportedContact[] {
  const seen = new Set<string>()
  const out: ImportedContact[] = []
  for (const contact of contacts) {
    const name = contact.name?.trim() || null
    const phone = cleanPhone(contact.phone)
    if (!name && !phone) continue
    const key = phone ?? `name:${(name ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, phone })
  }
  return out
}
