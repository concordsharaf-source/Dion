/** أدوات بناء بيانات اختبارية */

import type { FinancialEntry, Party } from '@/core/domain'

export const MERCHANT = 'user-merchant-0001'
export const CUSTOMER = 'user-customer-0001'
export const OTHER = 'user-other-000009'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

export function makeEntry(partial: Partial<FinancialEntry> = {}): FinancialEntry {
  const id = partial.id ?? nextId('eeee')
  return {
    id,
    scope: 'solo',
    entryType: 'debt',
    entryKind: 'normal',
    status: 'confirmed',
    amountMinor: 1_000_000,
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
    partyId: 'aaaa0000-0000-4000-8000-000000000001',
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
    clientRef: `ref-${id}`,
    excludedFromBalance: false,
    excludedReason: null,
    ...partial,
  }
}

export function makeParty(partial: Partial<Party> = {}): Party {
  const id = partial.id ?? nextId('pppp')
  return {
    id,
    ownerId: MERCHANT,
    kind: 'customer',
    name: 'أحمد',
    phone: null,
    address: null,
    note: null,
    searchKey: 'احمد',
    linkedUserId: null,
    linkedProfileName: null,
    relationshipId: null,
    linkStatus: 'none',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    archivedAt: null,
    ...partial,
  }
}
