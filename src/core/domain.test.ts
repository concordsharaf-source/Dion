import { describe, expect, it } from 'vitest'
import {
  awaitsMyConfirmation,
  canPerform,
  counterpartyOf,
  countsInBalance,
  entryEffect,
  isVisibleTo,
  partyIdForViewer,
  type FinancialEntry,
} from './domain'

/* ============================ أدوات بناء اختبارية ============================ */

const MERCHANT = 'user-merchant-1'
const CUSTOMER = 'user-customer-1'
const OTHER = 'user-other-9'

function entry(partial: Partial<FinancialEntry>): FinancialEntry {
  return {
    id: 'e1',
    scope: 'solo',
    entryType: 'debt',
    entryKind: 'normal',
    status: 'confirmed',
    amountMinor: 2_000_000,
    currency: 'YER',
    details: null,
    note: null,
    reason: null,
    occurredAt: '2026-09-13T10:00:00.000Z',
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
    creatorId: MERCHANT,
    creatorRole: 'merchant',
    creatorName: 'متجر النور',
    ownerId: MERCHANT,
    partyId: 'party-1',
    relationshipId: null,
    merchantUserId: null,
    customerUserId: null,
    merchantPartyId: null,
    customerPartyId: null,
    confirmedBy: MERCHANT,
    confirmedAt: '2026-09-13T10:00:00.000Z',
    confirmedByName: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectedByName: null,
    cancelledAt: null,
    reversesEntryId: null,
    reversedByEntryId: null,
    clientRef: 'ref-1',
    excludedFromBalance: false,
    excludedReason: null,
    ...partial,
  }
}

function sharedEntry(partial: Partial<FinancialEntry> = {}): FinancialEntry {
  return entry({
    scope: 'shared',
    status: 'pending',
    ownerId: null,
    partyId: null,
    relationshipId: 'rel-1',
    merchantUserId: MERCHANT,
    customerUserId: CUSTOMER,
    merchantPartyId: 'm-party',
    customerPartyId: 'c-party',
    confirmedBy: null,
    confirmedAt: null,
    creatorId: MERCHANT,
    ...partial,
  })
}

/* ============================ أثر القيد ============================ */

describe('أثر القيد على الرصيد', () => {
  it('الدين يزيد المتبقي والسداد ينقصه', () => {
    expect(entryEffect(entry({ entryType: 'debt', amountMinor: 2_000_000 }))).toBe(2_000_000)
    expect(entryEffect(entry({ entryType: 'payment', amountMinor: 1_000_000 }))).toBe(-1_000_000)
  })

  it('القيد العكسي يعكس أثر القيد الأصلي تمامًا', () => {
    expect(entryEffect(entry({ entryType: 'debt', entryKind: 'reversal', amountMinor: 2_000_000 }))).toBe(-2_000_000)
    expect(entryEffect(entry({ entryType: 'payment', entryKind: 'reversal', amountMinor: 1_000_000 }))).toBe(1_000_000)
  })

  it('لا تُحتسب إلا العمليات المؤكدة وغير المستثناة', () => {
    expect(countsInBalance(entry({ status: 'confirmed' }))).toBe(true)
    expect(countsInBalance(entry({ status: 'pending' }))).toBe(false)
    expect(countsInBalance(entry({ status: 'rejected' }))).toBe(false)
    expect(countsInBalance(entry({ status: 'cancelled' }))).toBe(false)
    expect(countsInBalance(entry({ status: 'confirmed', excludedFromBalance: true }))).toBe(false)
  })
})

/* ============================ آلة الحالات ============================ */

describe('صلاحيات الإجراءات على العملية', () => {
  it('المنشئ لا يستطيع تأكيد عمليته', () => {
    const e = sharedEntry({ creatorId: MERCHANT })
    expect(canPerform('confirm', e, MERCHANT)).toMatchObject({ allowed: false, code: 'self_confirm' })
  })

  it('الطرف الآخر فقط هو من يؤكد أو يرفض', () => {
    const e = sharedEntry({ creatorId: MERCHANT })
    expect(canPerform('confirm', e, CUSTOMER).allowed).toBe(true)
    expect(canPerform('reject', e, CUSTOMER).allowed).toBe(true)
  })

  it('الغريب لا يستطيع التأكيد', () => {
    const e = sharedEntry({ creatorId: MERCHANT })
    expect(canPerform('confirm', e, OTHER)).toMatchObject({ allowed: false, code: 'forbidden' })
  })

  it('لا تأكيد بعد حسم العملية', () => {
    const e = sharedEntry({ status: 'confirmed', creatorId: MERCHANT })
    expect(canPerform('confirm', e, CUSTOMER)).toMatchObject({ allowed: false, code: 'already_decided' })
    const r = sharedEntry({ status: 'rejected', creatorId: MERCHANT })
    expect(canPerform('confirm', r, CUSTOMER)).toMatchObject({ allowed: false, code: 'already_decided' })
  })

  it('الإلغاء من المنشئ فقط وقبل التأكيد', () => {
    const pending = sharedEntry({ creatorId: MERCHANT })
    expect(canPerform('cancel', pending, MERCHANT).allowed).toBe(true)
    expect(canPerform('cancel', pending, CUSTOMER)).toMatchObject({ allowed: false, code: 'forbidden' })
    const confirmed = sharedEntry({ status: 'confirmed', creatorId: MERCHANT })
    expect(canPerform('cancel', confirmed, MERCHANT)).toMatchObject({ allowed: false, code: 'already_decided' })
  })

  it('العكس للعمليات المؤكدة فقط وللأطراف فقط', () => {
    const confirmed = sharedEntry({ status: 'confirmed', creatorId: MERCHANT })
    expect(canPerform('reverse', confirmed, CUSTOMER).allowed).toBe(true)
    expect(canPerform('reverse', confirmed, OTHER)).toMatchObject({ allowed: false, code: 'forbidden' })
    expect(canPerform('reverse', sharedEntry({ status: 'pending' }), MERCHANT)).toMatchObject({
      allowed: false,
      code: 'entry_locked',
    })
  })

  it('لا عكس لقيد عكسي ولا عكس مزدوج', () => {
    const reversal = sharedEntry({ status: 'confirmed', entryKind: 'reversal' })
    expect(canPerform('reverse', reversal, CUSTOMER).allowed).toBe(false)
    const already = sharedEntry({ status: 'confirmed', reversedByEntryId: 'e2' })
    expect(canPerform('reverse', already, CUSTOMER)).toMatchObject({ allowed: false, code: 'conflict' })
  })
})

/* ============================ الرؤية والملكية ============================ */

describe('رؤية العمليات', () => {
  it('العمليات المستقلة تُرى من صاحب الدفتر فقط', () => {
    const e = entry({ ownerId: MERCHANT })
    expect(isVisibleTo(e, MERCHANT)).toBe(true)
    expect(isVisibleTo(e, CUSTOMER)).toBe(false)
    expect(isVisibleTo(e, OTHER)).toBe(false)
  })

  it('العمليات المشتركة تُرى من طرفي العلاقة فقط', () => {
    const e = sharedEntry()
    expect(isVisibleTo(e, MERCHANT)).toBe(true)
    expect(isVisibleTo(e, CUSTOMER)).toBe(true)
    expect(isVisibleTo(e, OTHER)).toBe(false)
  })

  it('معرّف الطرف يختلف حسب المشاهد (نفس العملية في دفترين)', () => {
    const e = sharedEntry()
    expect(partyIdForViewer(e, MERCHANT)).toBe('m-party')
    expect(partyIdForViewer(e, CUSTOMER)).toBe('c-party')
    expect(partyIdForViewer(e, OTHER)).toBe(null)
    expect(partyIdForViewer(entry({ ownerId: MERCHANT, partyId: 'p1' }), MERCHANT)).toBe('p1')
  })

  it('يحدد الطرف الآخر بدقة', () => {
    const e = sharedEntry()
    expect(counterpartyOf(e, MERCHANT)).toBe(CUSTOMER)
    expect(counterpartyOf(e, CUSTOMER)).toBe(MERCHANT)
    expect(counterpartyOf(entry({}), MERCHANT)).toBe(null)
  })

  it('لا تنتظر تأكيدي إن كنت أنا المنشئ', () => {
    expect(awaitsMyConfirmation(sharedEntry({ creatorId: MERCHANT }), CUSTOMER)).toBe(true)
    expect(awaitsMyConfirmation(sharedEntry({ creatorId: MERCHANT }), MERCHANT)).toBe(false)
    expect(awaitsMyConfirmation(sharedEntry({ creatorId: MERCHANT, status: 'confirmed' }), CUSTOMER)).toBe(false)
  })
})
