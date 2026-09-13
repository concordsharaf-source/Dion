/**
 * حساب الأرصدة والملخصات — المصدر الوحيد للحقيقة المالية
 *
 * القاعدة الذهبية:
 *   الرصيد = مجموع العمليات *المؤكدة* فقط.
 *   لا يوجد حقل رصيد يُكتب يدويًا في أي مكان في النظام.
 */

import type { Minor } from './money'
import { addMinor, paymentRatio, subMinor } from './money'
import type { FinancialEntry, Party } from './domain'
import { countsInBalance, entryEffect, isVisibleTo, partyIdForViewer } from './domain'

/* ============================ الأرصدة ============================ */

export interface Totals {
  /** إجمالي الديون المؤكدة */
  totalDebt: Minor
  /** إجمالي السدادات المؤكدة */
  totalPaid: Minor
  /** المتبقي = الديون − السدادات */
  remaining: Minor
  /** عدد الحركات المؤكدة */
  confirmedCount: number

  /** مبالغ معلّقة لم تُحسب بعد */
  pendingDebt: Minor
  pendingPaid: Minor
  pendingCount: number
  /** مبالغ معلّقة بانتظار تأكيدي أنا */
  awaitingMyActionCount: number
  /** مبالغ مرفوضة/ملغاة (للعلم فقط) */
  rejectedCount: number
}

export const EMPTY_TOTALS: Totals = {
  totalDebt: 0,
  totalPaid: 0,
  remaining: 0,
  confirmedCount: 0,
  pendingDebt: 0,
  pendingPaid: 0,
  pendingCount: 0,
  awaitingMyActionCount: 0,
  rejectedCount: 0,
}

/**
 * يحسب الإجماليات من قائمة عمليات من منظور مشاهد معيّن.
 * العمليات المعلقة لا تدخل في `remaining` أبدًا.
 */
export function computeTotals(entries: FinancialEntry[], viewerId: string): Totals {
  let totalDebt = 0
  let totalPaid = 0
  let confirmedCount = 0
  let pendingDebt = 0
  let pendingPaid = 0
  let pendingCount = 0
  let awaitingMyActionCount = 0
  let rejectedCount = 0

  for (const entry of entries) {
    if (!isVisibleTo(entry, viewerId)) continue

    if (countsInBalance(entry)) {
      const effect = entryEffect(entry)
      if (effect >= 0) totalDebt = addMinor(totalDebt, effect)
      else totalPaid = addMinor(totalPaid, -effect)
      confirmedCount += 1
      continue
    }

    if (entry.status === 'pending') {
      if (entry.entryType === 'debt') pendingDebt = addMinor(pendingDebt, entry.amountMinor)
      else pendingPaid = addMinor(pendingPaid, entry.amountMinor)
      pendingCount += 1
      if (entry.scope === 'shared' && entry.creatorId !== viewerId) awaitingMyActionCount += 1
      continue
    }

    if (entry.status === 'rejected' || entry.status === 'cancelled') rejectedCount += 1
  }

  return {
    totalDebt,
    totalPaid,
    remaining: subMinor(totalDebt, totalPaid),
    confirmedCount,
    pendingDebt,
    pendingPaid,
    pendingCount,
    awaitingMyActionCount,
    rejectedCount,
  }
}

/** يحسب الإجماليات لطرف واحد فقط (محل أو عميل) */
export function computeTotalsForParty(entries: FinancialEntry[], viewerId: string, partyId: string): Totals {
  const scoped = entries.filter((e) => partyIdForViewer(e, viewerId) === partyId)
  return computeTotals(scoped, viewerId)
}

/* ============================ ملخص كل طرف ============================ */

export interface PartySummary {
  party: Party
  /** المجاميع الموثّقة (المؤكدة فقط) */
  totalDebt: Minor
  totalPaid: Minor
  remaining: Minor
  /** نسبة السداد 0..1 */
  ratio: number
  /** آخر حركة (تاريخ) */
  lastActivityAt: string | null
  /** عدد الحركات المؤكدة */
  entryCount: number
  /** توجد عملية معلّقة بانتظاري */
  hasPendingForMe: boolean
  pendingCount: number
  /** رصيد سابق غير مدموج (بعد الربط — ينتظر اعتماد الطرفين) */
  legacyRemaining: Minor
  legacyCount: number
  isFullyPaid: boolean
}

/**
 * يبني ملخصات كل الأطراف من قائمة عمليات + قائمة أطراف.
 * O(n) على العمليات — تُستخدم مباشرة في القوائم مع البحث والترتيب.
 */
export function summarizeParties(parties: Party[], entries: FinancialEntry[], viewerId: string): PartySummary[] {
  const byParty = new Map<string, FinancialEntry[]>()
  for (const party of parties) byParty.set(party.id, [])

  for (const entry of entries) {
    if (!isVisibleTo(entry, viewerId)) continue
    const pid = partyIdForViewer(entry, viewerId)
    if (!pid) continue
    const bucket = byParty.get(pid)
    if (bucket) bucket.push(entry)
  }

  return parties.map((party) => {
    const list = byParty.get(party.id) ?? []
    const totals = computeTotals(list, viewerId)
    let lastActivityAt: string | null = null
    let legacyRemaining = 0
    let legacyCount = 0
    for (const e of list) {
      const at = e.occurredAt || e.createdAt
      if (!lastActivityAt || at > lastActivityAt) lastActivityAt = at
      if (e.status === 'confirmed' && e.excludedFromBalance) {
        legacyRemaining += entryEffect(e)
        legacyCount += 1
      }
    }
    const hasPendingForMe = list.some(
      (e) => e.status === 'pending' && e.scope === 'shared' && e.creatorId !== viewerId,
    )
    return {
      party,
      totalDebt: totals.totalDebt,
      totalPaid: totals.totalPaid,
      remaining: totals.remaining,
      ratio: paymentRatio(totals.totalPaid, totals.totalDebt),
      lastActivityAt,
      entryCount: totals.confirmedCount,
      hasPendingForMe,
      pendingCount: totals.pendingCount,
      legacyRemaining,
      legacyCount,
      isFullyPaid: totals.totalDebt > 0 && totals.remaining <= 0,
    }
  })
}

/* ============================ البحث والترتيب ============================ */

export type PartySort =
  | 'recent_activity'
  | 'highest_debt'
  | 'lowest_debt'
  | 'remaining'
  | 'fully_paid'
  | 'name'
  | 'newest'

export const PARTY_SORT_LABELS: Record<PartySort, string> = {
  recent_activity: 'آخر حركة',
  highest_debt: 'الأعلى دينًا',
  lowest_debt: 'الأقل دينًا',
  remaining: 'الأكثر متبقيًا',
  fully_paid: 'المسدَّد بالكامل',
  name: 'الاسم (أ–ي)',
  newest: 'الأحدث إضافة',
}

/** توحيد النص العربي للبحث: إزالة التشكيل وتوحيد الألف والهاء */
export function normalizeArabic(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, ' ')
}

/** أرقام فقط للمقارنة بالهاتف — بلا مفتاح دولة وبلا صفر بداية */
export function normalizePhone(input: string): string {
  return input
    .replace(/\D/g, '')
    .replace(/^00/, '')
    .replace(/^967/, '')
    .replace(/^0+/, '')
}

export interface FilterOptions {
  query?: string
  sort?: PartySort
  /** إظهار المؤرشَفين */
  includeArchived?: boolean
  /** فقط من عليه رصيد */
  onlyWithBalance?: boolean
  /** فقط من بانتظاره إجراء مني */
  onlyPending?: boolean
}

export function filterAndSortParties(summaries: PartySummary[], opts: FilterOptions = {}): PartySummary[] {
  const { query = '', sort = 'recent_activity', includeArchived = false, onlyWithBalance = false, onlyPending = false } = opts

  const q = normalizeArabic(query)
  const phoneQuery = normalizePhone(query)
  const qIsPhone = /^\d{3,}$/.test(phoneQuery)

  let list = summaries.filter((s) => {
    if (!includeArchived && s.party.archivedAt) return false
    if (onlyWithBalance && s.remaining <= 0) return false
    if (onlyPending && !s.hasPendingForMe) return false
    if (!q) return true
    const haystack = `${normalizeArabic(s.party.name)} ${normalizeArabic(s.party.note ?? '')} ${normalizeArabic(s.party.address ?? '')}`
    if (haystack.includes(q)) return true
    if (qIsPhone && s.party.phone && normalizePhone(s.party.phone).includes(phoneQuery)) return true
    return false
  })

  const byName = (a: PartySummary, b: PartySummary) => a.party.name.localeCompare(b.party.name, 'ar')

  list = [...list].sort((a, b) => {
    switch (sort) {
      case 'highest_debt':
        return b.remaining - a.remaining || byName(a, b)
      case 'lowest_debt':
        return a.remaining - b.remaining || byName(a, b)
      case 'remaining':
        return b.totalDebt - b.totalPaid - (a.totalDebt - a.totalPaid) || byName(a, b)
      case 'fully_paid': {
        // المسدَّد بالكامل أولًا، ثم الأقرب للسداد
        if (a.isFullyPaid !== b.isFullyPaid) return a.isFullyPaid ? -1 : 1
        return b.ratio - a.ratio || byName(a, b)
      }
      case 'name':
        return byName(a, b)
      case 'newest':
        return (b.party.createdAt ?? '').localeCompare(a.party.createdAt ?? '') || byName(a, b)
      case 'recent_activity':
      default: {
        const am = a.lastActivityAt ?? a.party.createdAt
        const bm = b.lastActivityAt ?? b.party.createdAt
        return (bm ?? '').localeCompare(am ?? '') || byName(a, b)
      }
    }
  })

  return list
}

/* ============================ قواعد العمل على المبالغ ============================ */

export interface AmountRuleInput {
  entryType: 'debt' | 'payment'
  amountMinor: Minor
  /** الرصيد المؤكد الحالي للطرف */
  confirmedRemaining: Minor
}

/**
 * قواعد المبالغ:
 *   - لا صفر · لا سالب · لا تجاوز الحد
 *   - السداد لا يتجاوز الرصيد المؤكد (لا أرصدة دائنة في الإصدار الأول)
 */
export function validateAmountRule({ entryType, amountMinor, confirmedRemaining }: AmountRuleInput): { ok: true } | { ok: false; code: 'zero_amount' | 'negative_amount' | 'over_payment' } {
  if (amountMinor < 0) return { ok: false, code: 'negative_amount' }
  if (amountMinor === 0) return { ok: false, code: 'zero_amount' }
  if (entryType === 'payment' && amountMinor > confirmedRemaining) return { ok: false, code: 'over_payment' }
  return { ok: true }
}

/**
 * الرصيد المتوقع بعد تأكيد عملية معلّقة (للعرض قبل الموافقة)
 */
export function projectedRemaining(currentRemaining: Minor, entry: Pick<FinancialEntry, 'entryType' | 'entryKind' | 'amountMinor'>): Minor {
  return addMinor(currentRemaining, entryEffect(entry as FinancialEntry))
}

/**
 * الديون تجاوزت السداد؟ (تدقيق بسيط للواجهة)
 */
export function isOverPaid(totalPaid: Minor, totalDebt: Minor): boolean {
  return totalPaid > totalDebt
}
