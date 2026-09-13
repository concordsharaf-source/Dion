/**
 * كشف الحساب — بناء نموذج العرض (منطق نقي، بلا رسم ولا شبكة).
 * يُستخدم لتصدير PDF للعميل (تاجر) أو للمحل (عميل).
 */

import { entryEffect } from '@/core/domain'
import type { FinancialEntry, Party, Profile } from '@/core/domain'
import { formatMinorForPdf } from '@/core/pdfText'
import { displayPhone } from './validation'

export type StatementPeriod = 'all' | 'month' | 'last30'

export interface StatementRow {
  id: string
  date: string
  /** وصف مقروء: دين / سداد / رصيد افتتاحي */
  label: string
  details: string
  amountMinor: number
  /** نص المبلغ بالإشارة (+ دين / − سداد) */
  amountText: string
  statusLabel: string
  statusTone: 'confirmed' | 'pending' | 'rejected' | 'other'
}

export interface StatementModel {
  title: string
  /** اسم الطرف كما يظهر في الكشف */
  partyName: string
  partyPhone: string | null
  partyKindLabel: string
  ownerName: string
  ownerRole: 'merchant' | 'customer'
  ownerPhone: string | null
  linkLabel: string
  periodLabel: string
  generatedAt: Date
  rows: StatementRow[]
  totals: {
    /** مجموع الديون المؤكدة */
    debtMinor: number
    /** مجموع السدادات المؤكدة */
    paidMinor: number
    /** المتبقي = ديون مؤكدة − سدادات مؤكدة */
    remainingMinor: number
    /** المعلّق (لا يدخل الرصيد) */
    pendingDebtMinor: number
    pendingPaidMinor: number
  }
  counts: { confirmed: number; pending: number }
  currency: string
  footerNote: string
}

const STATUS_LABELS: Record<string, { label: string; tone: StatementRow['statusTone'] }> = {
  pending: { label: 'بانتظار التأكيد', tone: 'pending' },
  confirmed: { label: 'مؤكدة', tone: 'confirmed' },
  rejected: { label: 'مرفوضة', tone: 'rejected' },
  cancelled: { label: 'ملغاة', tone: 'other' },
  reversed: { label: 'معكوسة', tone: 'other' },
}

export const PERIOD_LABELS: Record<StatementPeriod, string> = {
  all: 'كل الفترة',
  month: 'هذا الشهر',
  last30: 'آخر 30 يومًا',
}

/** أول لحظة في فترة الكشف — `null` يعني بلا حد */
export function periodStart(period: StatementPeriod, now: Date = new Date()): Date | null {
  if (period === 'all') return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'month') {
    start.setDate(1)
    return start
  }
  start.setDate(start.getDate() - 29)
  return start
}

export function isWithinPeriod(iso: string, period: StatementPeriod, now: Date = new Date()): boolean {
  const start = periodStart(period, now)
  if (!start) return true
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? time >= start.getTime() : false
}

function labelFor(entry: FinancialEntry): string {
  if (entry.entryKind === 'opening') return 'رصيد افتتاحي'
  return entry.entryType === 'debt' ? 'دين' : 'سداد'
}

/** يبني صفوف الكشف من عمليات الطرف */
export function buildStatementRows(entries: FinancialEntry[]): StatementRow[] {
  return entries
    .slice()
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1))
    .map((entry) => {
      const status = STATUS_LABELS[entry.status] ?? { label: entry.status, tone: 'other' as const }
      const effect = entryEffect(entry)
      return {
        id: entry.id,
        date: entry.occurredAt || entry.createdAt,
        label: labelFor(entry),
        details: entry.details ?? '',
        amountMinor: entry.amountMinor,
        amountText: formatMinorForPdf(entry.amountMinor),
        statusLabel: status.label,
        statusTone: status.tone,
        // الأثر موجب للدين وسالب للسداد — يُستخدم في الترتيب والتلوين فقط
        ...(effect === 0 ? {} : {}),
      }
    })
}

export function buildStatement(input: {
  party: Party
  entries: FinancialEntry[]
  profile: Profile | null
  period: StatementPeriod
  currency: string
  now?: Date
}): StatementModel {
  const now = input.now ?? new Date()
  const inPeriod = input.entries.filter((e) => isWithinPeriod(e.occurredAt || e.createdAt, input.period, now))

  // الرصيد من المؤكد فقط، والمعلّق يُعرض منفصلًا
  const confirmed = inPeriod.filter((e) => e.status === 'confirmed')
  const pending = inPeriod.filter((e) => e.status === 'pending')

  const debtMinor = confirmed.filter((e) => e.entryType === 'debt').reduce((sum, e) => sum + e.amountMinor, 0)
  const paidMinor = confirmed.filter((e) => e.entryType === 'payment').reduce((sum, e) => sum + e.amountMinor, 0)

  const pendingDebtMinor = pending.filter((e) => e.entryType === 'debt').reduce((sum, e) => sum + e.amountMinor, 0)
  const pendingPaidMinor = pending.filter((e) => e.entryType === 'payment').reduce((sum, e) => sum + e.amountMinor, 0)

  const ownerRole = input.profile?.role ?? 'merchant'

  return {
    title: ownerRole === 'merchant' ? 'كشف حساب عميل' : 'كشف حساب محل',
    partyName: input.party.name,
    partyPhone: displayPhone(input.party.phone),
    partyKindLabel: input.party.kind === 'customer' ? 'عميل' : 'محل',
    ownerName: input.profile?.fullName ?? 'دفتر الديون',
    ownerRole,
    ownerPhone: displayPhone(input.profile?.phone ?? null),
    linkLabel: input.party.linkStatus === 'verified' ? 'حساب موثّق بين الطرفين' : 'دفتر شخصي',
    periodLabel: PERIOD_LABELS[input.period],
    generatedAt: now,
    rows: buildStatementRows(inPeriod),
    totals: {
      debtMinor,
      paidMinor,
      remainingMinor: debtMinor - paidMinor,
      pendingDebtMinor,
      pendingPaidMinor,
    },
    counts: { confirmed: confirmed.length, pending: pending.length },
    currency: input.currency,
    footerNote: 'الرصيد يُحسب من العمليات المؤكدة فقط. العمليات المعلّقة لا تدخل الرصيد حتى يؤكّدها الطرف الآخر.',
  }
}
