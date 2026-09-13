/**
 * اختبارات تصدير كشف الحساب PDF:
 * تُبنى نسخة PDF فعلية بخط Cairo المدمج، ثم تُقرأ مرة أخرى للتحقق من سلامتها،
 * ويُكتب الملف في /tmp لمعاينته بصريًا.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildStatement } from '@/core/statement'
import { buildStatementPdf, pdfFileName, canShareFiles, shareOrDownloadPdf, visualSegments } from './pdf'
import type { FinancialEntry, Party, Profile } from '@/core/domain'

const party: Party = {
  id: 'p1',
  ownerId: 'u1',
  kind: 'customer',
  name: 'أحمد محمد الشامي',
  // رقم محفوظ قديمًا بمفتاح دولة — يجب أن يُطبع في الكشف بلا مفتاح
  phone: '+967771234567',
  address: 'صنعاء',
  note: null,
  searchKey: 'احمد محمد الشامي',
  linkedUserId: null,
  linkedProfileName: null,
  relationshipId: null,
  linkStatus: 'verified',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
}

function makeEntry(
  index: number,
  entryType: 'debt' | 'payment',
  amountMinor: number,
  status: FinancialEntry['status'],
  details: string | null,
  day: string,
): FinancialEntry {
  return {
    id: `e${index}`,
    createdAt: day,
    updatedAt: day,
    scope: 'solo',
    entryType,
    entryKind: 'normal',
    status,
    amountMinor,
    currency: 'YER',
    details,
    note: null,
    reason: null,
    occurredAt: day,
    creatorId: 'u1',
    creatorRole: 'merchant',
    creatorName: 'بقالة النور',
    ownerId: 'u1',
    partyId: 'p1',
    relationshipId: null,
    merchantUserId: null,
    customerUserId: null,
    merchantPartyId: null,
    customerPartyId: null,
    confirmedBy: 'u1',
    confirmedByName: 'بقالة النور',
    confirmedAt: day,
    rejectedBy: null,
    rejectedByName: null,
    rejectedAt: null,
    cancelledAt: null,
    reversesEntryId: null,
    reversedByEntryId: null,
    excludedFromBalance: false,
    excludedReason: null,
    clientRef: `r${index}`,
  } as FinancialEntry
}

const entries: FinancialEntry[] = [
  makeEntry(1, 'debt', 2_500_000, 'confirmed', 'مواد غذائية', '2026-09-10T09:12:00.000Z'),
  makeEntry(2, 'payment', 1_000_000, 'confirmed', null, '2026-09-11T17:40:00.000Z'),
  makeEntry(3, 'debt', 750_000, 'pending', 'خضار وفواكه', '2026-09-13T10:05:00.000Z'),
  makeEntry(4, 'debt', 430_000, 'confirmed', null, '2026-09-14T08:30:00.000Z'),
]

const profile = {
  id: 'u1',
  role: 'merchant',
  roles: ['merchant'],
  fullName: 'بقالة النور',
  phone: '0771112233',
  currency: 'YER',
  theme: 'system',
  numerals: 'latin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Profile

const originalFetch = globalThis.fetch

beforeAll(() => {
  // نحاكي خدمة ملفات الخطوط من مجلد public
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const name = url.split('/').pop() ?? ''
    const bytes = readFileSync(`public/fonts/${name}`)
    return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'font/ttf' } })
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('كشف الحساب — النموذج', () => {
  it('يحسب المؤكد فقط ويُبقي المعلّق منفصلًا', () => {
    const model = buildStatement({ party, entries, profile, period: 'all', currency: 'YER' })
    expect(model.totals.debtMinor).toBe(2_930_000)
    expect(model.totals.paidMinor).toBe(1_000_000)
    expect(model.totals.remainingMinor).toBe(1_930_000)
    expect(model.totals.pendingDebtMinor).toBe(750_000)
    expect(model.counts).toEqual({ confirmed: 3, pending: 1 })
    expect(model.title).toBe('كشف حساب عميل')
    // رقم الهاتف في الكشف بلا مفتاح دولة (حتى لو كان محفوظًا قديمًا بـ+967)
    expect(model.partyPhone).toBe('771 234 567')
    expect(model.partyPhone).not.toContain('967')
    expect(model.rows).toHaveLength(4)
    // مرتّبة زمنيًا
    expect(model.rows[0]!.amountMinor).toBe(2_500_000)
  })

  it('يحدّ العمليات بالفترة المختارة', () => {
    const now = new Date('2026-09-14T21:00:00.000Z')
    const month = buildStatement({ party, entries, profile, period: 'month', currency: 'YER', now })
    expect(month.rows).toHaveLength(4)

    const older = [...entries, makeEntry(9, 'debt', 100_000, 'confirmed', null, '2026-05-01T10:00:00.000Z')]
    const last30 = buildStatement({ party, entries: older, profile, period: 'last30', currency: 'YER', now })
    expect(last30.rows.map((r) => r.id)).not.toContain('e9')
  })
})

describe('كشف الحساب — تقسيم النص لمقاطع بخطوط', () => {
  it('يفصل العربية عن الأرقام ويحفظ ترتيب القراءة من اليمين', () => {
    const segments = visualSegments('دين مواد غذائية 25,000')
    expect(segments.map((s) => s.kind)).toContain('ar')
    expect(segments.map((s) => s.kind)).toContain('la')
    // الأرقام مقطع لاتيني سليم غير مقلوب
    // الرقم مقطع لاتيني واحد غير مقلوب (وقد تُلحَق به مسافة فاصلة)
    expect(segments.some((s) => s.kind === 'la' && s.text.trim() === '25,000')).toBe(true)
    // المقاطع مرتّبة منطقيًا: النص العربي أولًا ثم الرقم (الرسم يبدأ من اليمين)
    expect(segments[0]!.kind).toBe('ar')
    expect(segments[segments.length - 1]!.kind).toBe('la')
  })

  it('يجمع النص العربي المتصل في مقطع واحد ويحفظ المسافات داخله', () => {
    const segments = visualSegments('بقالة النور')
    expect(segments).toHaveLength(1)
    expect(segments[0]!.kind).toBe('ar')
    expect(segments[0]!.text).toContain(' ')
  })

  it('يعامل علامات الترقيم العربية كنص عربي', () => {
    const segments = visualSegments('المبلغ ٥٠٠؟')
    expect(segments.some((s) => s.kind === 'ar' && s.text.includes('؟'))).toBe(true)
  })
})

describe('كشف الحساب — ملف PDF', () => {
  it('يُنتج ملف PDF صالحًا بخطوط مدمجة ومحتوى', async () => {
    const model = buildStatement({ party, entries, profile, period: 'all', currency: 'YER' })
    const bytes = await buildStatementPdf(model)

    // ترويسة ملف PDF
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')

    const reloaded = await PDFDocument.load(bytes)
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(reloaded.getTitle()).toContain('أحمد محمد الشامي')
    expect(reloaded.getSubject()).toContain('كشف حساب')

    const page = reloaded.getPage(0)
    const { width, height } = page.getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)

    // حجم الملف يدل على أن الخطوط العربية مدمجة فعلًا (بلا خطوط ≈ 2 ك.ب)
    expect(bytes.length).toBeGreaterThan(20_000)

    writeFileSync('/tmp/statement-preview.pdf', bytes)
  })

  it('يفتح صفحات إضافية عند كثرة العمليات', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      makeEntry(index + 100, index % 3 === 0 ? 'payment' : 'debt', 250_000, 'confirmed', `عملية رقم ${index + 1}`, `2026-09-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`),
    )
    const model = buildStatement({ party, entries: many, profile, period: 'all', currency: 'YER' })
    const bytes = await buildStatementPdf(model)
    const reloaded = await PDFDocument.load(bytes)
    expect(reloaded.getPageCount()).toBeGreaterThan(1)
    writeFileSync('/tmp/statement-many.pdf', bytes)
  })

  it('اسم الملف يحمل اسم الطرف والتاريخ', () => {
    const model = buildStatement({ party, entries, profile, period: 'all', currency: 'YER' })
    const name = pdfFileName(model)
    expect(name).toContain('كشف-أحمد-محمد-الشامي')
    expect(name.endsWith('.pdf')).toBe(true)
  })
})

describe('كشف الحساب — المشاركة', () => {
  it('يكتشف دعم المشاركة من الجهاز', () => {
    expect(canShareFiles({ canShare: () => true })).toBe(true)
    expect(canShareFiles({})).toBe(false)
    expect(canShareFiles(null)).toBe(false)
  })

  it('ينزّل الملف إن كان الجهاز لا يدعم المشاركة', async () => {
    const clicks: string[] = []
    const originalCreate = document.createElement.bind(document)
    const spy = (tag: string) => {
      const element = originalCreate(tag) as HTMLAnchorElement
      if (tag === 'a') {
        element.click = () => clicks.push(element.download)
      }
      return element
    }
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => spy(tag)) as typeof document.createElement)
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])
    const result = await shareOrDownloadPdf(bytes, 'كشف-test.pdf')

    expect(result).toBe('downloaded')
    expect(clicks).toEqual(['كشف-test.pdf'])

    createSpy.mockRestore()
    urlSpy.mockRestore()
    revokeSpy.mockRestore()
  })
})
