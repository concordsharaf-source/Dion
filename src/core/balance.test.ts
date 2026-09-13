import { describe, expect, it } from 'vitest'
import {
  computeTotals,
  computeTotalsForParty,
  filterAndSortParties,
  normalizeArabic,
  normalizePhone,
  projectedRemaining,
  summarizeParties,
  validateAmountRule,
} from './balance'
import { CUSTOMER, MERCHANT, makeEntry, makeParty } from '@/test/factories'

/* ============================ الإجماليات ============================ */

describe('حساب الإجماليات', () => {
  it('يجمع الديون والسدادات المؤكدة فقط', () => {
    const entries = [
      makeEntry({ entryType: 'debt', amountMinor: 5_000_000, status: 'confirmed' }),
      makeEntry({ entryType: 'debt', amountMinor: 5_000_000, status: 'confirmed' }),
      makeEntry({ entryType: 'payment', amountMinor: 3_000_000, status: 'confirmed' }),
      // هذه لا تدخل
      makeEntry({ entryType: 'debt', amountMinor: 9_000_000, status: 'pending' }),
      makeEntry({ entryType: 'payment', amountMinor: 9_000_000, status: 'rejected' }),
      makeEntry({ entryType: 'debt', amountMinor: 9_000_000, status: 'cancelled' }),
    ]
    const totals = computeTotals(entries, MERCHANT)
    expect(totals.totalDebt).toBe(10_000_000)
    expect(totals.totalPaid).toBe(3_000_000)
    expect(totals.remaining).toBe(7_000_000)
    expect(totals.pendingDebt).toBe(9_000_000)
    expect(totals.pendingCount).toBe(1)
  })

  it('المثال المطلوب: ديون 100,000 وسداد 30,000 → متبقي 70,000', () => {
    const entries = [
      makeEntry({ entryType: 'debt', amountMinor: 10_000_000, status: 'confirmed' }),
      makeEntry({ entryType: 'payment', amountMinor: 3_000_000, status: 'confirmed' }),
    ]
    const totals = computeTotals(entries, MERCHANT)
    expect(totals.remaining).toBe(7_000_000)
    expect(totals.remaining / 100).toBe(70_000)
  })

  it('العمليات المعلقة لا تدخل في الرصيد المؤكد', () => {
    const entries = [makeEntry({ entryType: 'debt', amountMinor: 5_000_000, status: 'pending' })]
    const totals = computeTotals(entries, MERCHANT)
    expect(totals.remaining).toBe(0)
    expect(totals.confirmedCount).toBe(0)
  })

  it('القيد العكسي يلغي أثر القيد الأصلي', () => {
    const original = makeEntry({ id: 'orig', entryType: 'debt', amountMinor: 2_000_000, status: 'confirmed' })
    const reversal = makeEntry({
      id: 'rev',
      entryType: 'debt',
      entryKind: 'reversal',
      amountMinor: 2_000_000,
      status: 'confirmed',
      reversesEntryId: 'orig',
    })
    const totals = computeTotals([original, reversal], MERCHANT)
    expect(totals.remaining).toBe(0)
    expect(totals.confirmedCount).toBe(2)
  })

  it('السجل السابق المستثنى لا يدخل في الرصيد الموثّق', () => {
    const entries = [
      makeEntry({ entryType: 'debt', amountMinor: 5_000_000, status: 'confirmed' }),
      makeEntry({ entryType: 'debt', amountMinor: 8_000_000, status: 'confirmed', excludedFromBalance: true }),
    ]
    expect(computeTotals(entries, MERCHANT).remaining).toBe(5_000_000)
  })

  it('لا يرى المستخدم إجماليات غيره', () => {
    const entries = [makeEntry({ ownerId: CUSTOMER, creatorId: CUSTOMER })]
    expect(computeTotals(entries, MERCHANT).remaining).toBe(0)
  })

  it('يعد العملليات التي تنتظر تأكيدي', () => {
    const entries = [
      makeEntry({ status: 'pending', scope: 'shared', creatorId: CUSTOMER, merchantUserId: MERCHANT, customerUserId: CUSTOMER }),
      makeEntry({ status: 'pending', scope: 'shared', creatorId: MERCHANT, merchantUserId: MERCHANT, customerUserId: CUSTOMER }),
    ]
    // من منظور التاجر: واحدة فقط تنتظره (التي أنشأها العميل)
    expect(computeTotals(entries, MERCHANT).awaitingMyActionCount).toBe(1)
    expect(computeTotals(entries, CUSTOMER).awaitingMyActionCount).toBe(1)
  })
})

describe('إجماليات طرف واحد', () => {
  it('تفصل أرصدة الأطراف عن بعضها', () => {
    const entries = [
      makeEntry({ partyId: 'p1', amountMinor: 2_000_000 }),
      makeEntry({ partyId: 'p2', amountMinor: 5_000_000 }),
    ]
    expect(computeTotalsForParty(entries, MERCHANT, 'p1').remaining).toBe(2_000_000)
    expect(computeTotalsForParty(entries, MERCHANT, 'p2').remaining).toBe(5_000_000)
  })
})

/* ============================ الملخصات ============================ */

describe('ملخصات الأطراف', () => {
  const p1 = makeParty({ id: 'p1', name: 'بقالة النور' })
  const p2 = makeParty({ id: 'p2', name: 'مؤسسة الفجر' })

  const entries = [
    makeEntry({ partyId: 'p1', entryType: 'debt', amountMinor: 8_000_000 }),
    makeEntry({ partyId: 'p1', entryType: 'payment', amountMinor: 3_000_000 }),
    makeEntry({ partyId: 'p2', entryType: 'debt', amountMinor: 5_000_000 }),
    makeEntry({ partyId: 'p2', entryType: 'payment', amountMinor: 5_000_000 }),
  ]

  it('يحسب رصيد كل طرف ونسبة السداد', () => {
    const [s1, s2] = summarizeParties([p1, p2], entries, MERCHANT)
    expect(s1.remaining).toBe(5_000_000)
    expect(s1.totalDebt).toBe(8_000_000)
    expect(s1.totalPaid).toBe(3_000_000)
    expect(s1.ratio).toBeCloseTo(0.375, 3)
    expect(s1.isFullyPaid).toBe(false)

    expect(s2.remaining).toBe(0)
    expect(s2.isFullyPaid).toBe(true)
  })

  it('يرصد الرصيد السابق غير المدموج', () => {
    const legacy = makeEntry({ partyId: 'p1', amountMinor: 5_000_000, excludedFromBalance: true, excludedReason: 'legacy_unverified' })
    const [s1] = summarizeParties([p1], [...entries, legacy], MERCHANT)
    expect(s1.remaining).toBe(5_000_000)
    expect(s1.legacyRemaining).toBe(5_000_000)
    expect(s1.legacyCount).toBe(1)
  })

  it('يرصد وجود عملية معلقة تنتظرني', () => {
    const pending = makeEntry({
      partyId: 'p1',
      status: 'pending',
      scope: 'shared',
      creatorId: CUSTOMER,
      merchantUserId: MERCHANT,
      customerUserId: CUSTOMER,
      merchantPartyId: 'p1',
    })
    const [s1] = summarizeParties([p1], [pending], MERCHANT)
    expect(s1.hasPendingForMe).toBe(true)
    expect(s1.remaining).toBe(0)
  })
})

/* ============================ البحث والترتيب ============================ */

describe('البحث والترتيب', () => {
  it('يوحّد النص العربي في البحث', () => {
    expect(normalizeArabic('أَحْمَد')).toBe('احمد')
    expect(normalizeArabic('إبراهيم')).toBe('ابراهيم')
    expect(normalizeArabic('مصطفى')).toBe('مصطفي')
    expect(normalizeArabic('فاطمة')).toBe('فاطمه')
  })

  it('يوحّد أرقام الهاتف اليمنية', () => {
    expect(normalizePhone('+967771234567')).toBe('771234567')
    expect(normalizePhone('0771234567')).toBe('771234567')
  })

  const parties = [
    makeParty({ id: 'p1', name: 'أحمد علي', createdAt: '2026-09-01T00:00:00Z' }),
    makeParty({ id: 'p2', name: 'محمد صالح', createdAt: '2026-09-05T00:00:00Z' }),
    makeParty({ id: 'p3', name: 'سعاد', phone: '+967771234567', createdAt: '2026-09-03T00:00:00Z' }),
  ]
  const entries = [
    makeEntry({ partyId: 'p1', amountMinor: 1_000_000, occurredAt: '2026-09-10T00:00:00Z' }),
    makeEntry({ partyId: 'p2', amountMinor: 9_000_000, occurredAt: '2026-09-12T00:00:00Z' }),
    makeEntry({ partyId: 'p3', amountMinor: 5_000_000, occurredAt: '2026-09-11T00:00:00Z' }),
  ]
  const summaries = summarizeParties(parties, entries, MERCHANT)

  it('يرتب الأعلى دينًا', () => {
    const sorted = filterAndSortParties(summaries, { sort: 'highest_debt' })
    expect(sorted.map((s) => s.party.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('يرتب الأقل دينًا', () => {
    const sorted = filterAndSortParties(summaries, { sort: 'lowest_debt' })
    expect(sorted.map((s) => s.party.id)).toEqual(['p1', 'p3', 'p2'])
  })

  it('يرتب حسب آخر حركة', () => {
    const sorted = filterAndSortParties(summaries, { sort: 'recent_activity' })
    expect(sorted.map((s) => s.party.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('يبحث بالاسم مع تجاهل التشكيل واختلاف الألف', () => {
    expect(filterAndSortParties(summaries, { query: 'احمد' }).map((s) => s.party.id)).toEqual(['p1'])
    expect(filterAndSortParties(summaries, { query: 'أحمد' }).map((s) => s.party.id)).toEqual(['p1'])
    expect(filterAndSortParties(summaries, { query: 'محمد' }).map((s) => s.party.id)).toEqual(['p2'])
  })

  it('يبحث برقم الهاتف', () => {
    expect(filterAndSortParties(summaries, { query: '7712' }).map((s) => s.party.id)).toEqual(['p3'])
  })

  it('يخفي المؤرشف افتراضيًا', () => {
    const archived = summarizeParties([makeParty({ id: 'p9', archivedAt: '2026-09-01T00:00:00Z' })], [], MERCHANT)
    expect(filterAndSortParties(archived)).toHaveLength(0)
    expect(filterAndSortParties(archived, { includeArchived: true })).toHaveLength(1)
  })

  it('يستبعد من لا رصيد عليه عند الطلب', () => {
    const paid = summarizeParties([makeParty({ id: 'pz', name: 'مسدد' })], [], MERCHANT)
    expect(filterAndSortParties([...summaries, ...paid], { onlyWithBalance: true })).toHaveLength(3)
  })
})

/* ============================ قواعد المبالغ ============================ */

describe('قواعد المبالغ', () => {
  it('يرفض الصفر والسالب', () => {
    expect(validateAmountRule({ entryType: 'debt', amountMinor: 0, confirmedRemaining: 1 })).toEqual({
      ok: false,
      code: 'zero_amount',
    })
    expect(validateAmountRule({ entryType: 'debt', amountMinor: -5, confirmedRemaining: 1 })).toEqual({
      ok: false,
      code: 'negative_amount',
    })
  })

  it('يرفض سدادًا أكبر من الرصيد المؤكد', () => {
    expect(validateAmountRule({ entryType: 'payment', amountMinor: 2_000_000, confirmedRemaining: 1_000_000 })).toEqual({
      ok: false,
      code: 'over_payment',
    })
    expect(validateAmountRule({ entryType: 'payment', amountMinor: 1_000_000, confirmedRemaining: 1_000_000 }).ok).toBe(true)
  })

  it('يسمح بالدين بأي مبلغ موجب', () => {
    expect(validateAmountRule({ entryType: 'debt', amountMinor: 9_000_000, confirmedRemaining: 0 }).ok).toBe(true)
  })

  it('يحسب الرصيد المتوقع بعد التأكيد', () => {
    expect(projectedRemaining(5_000_000, makeEntry({ entryType: 'payment', amountMinor: 2_000_000 }))).toBe(3_000_000)
    expect(projectedRemaining(5_000_000, makeEntry({ entryType: 'debt', amountMinor: 2_000_000 }))).toBe(7_000_000)
  })
})
