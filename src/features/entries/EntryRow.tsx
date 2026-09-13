import clsx from 'clsx'
import { ArrowDownLeft, ArrowUpRight, RotateCcw } from 'lucide-react'
import { Money, StatusChip } from '@/components/ui'
import { formatRelativeAr } from '@/core/datetime'
import type { FinancialEntry } from '@/core/domain'

/**
 * صف عملية مالية — يعرض الأثر والمبلغ والحالة بوضوح
 */
export function EntryRow({
  entry,
  viewerId,
  partyName,
  currency,
  onOpen,
}: {
  entry: FinancialEntry
  viewerId: string
  partyName?: string
  currency?: string
  onOpen?: () => void
}) {
  const isPayment = entry.entryType === 'payment'
  const isReversal = entry.entryKind === 'reversal'
  const mine = entry.creatorId === viewerId

  const Icon = isReversal ? RotateCcw : isPayment ? ArrowUpRight : ArrowDownLeft
  const tone = isReversal
    ? 'bg-ink-200 text-ink-600 dark:bg-ink-800 dark:text-ink-300'
    : isPayment
      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
      : 'bg-danger-100 text-danger-600 dark:bg-danger-500/20 dark:text-danger-100'

  const title = isReversal
    ? 'قيد تصحيحي (سجل قديم)'
    : entry.entryKind === 'opening'
      ? 'رصيد افتتاحي'
      : isPayment
        ? mine
          ? 'سداد سجّلته'
          : 'سداد مسجّل'
        : mine
          ? 'دين سجّلته'
          : 'دين مسجّل عليك'

  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'flex w-full items-center gap-3 border-b border-ink-200/70 px-4 py-3 text-start transition last:border-0 dark:border-ink-800/70',
        onOpen && 'active:bg-ink-100/70 dark:active:bg-ink-900',
      )}
    >
      <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-2xl', tone)}>
        <Icon size={20} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.9375rem] font-bold">{title}</span>
          {entry.status !== 'confirmed' ? <StatusChip status={entry.status} /> : null}
          {entry.excludedFromBalance ? <span className="chip bg-ink-200 text-ink-600">سجل سابق</span> : null}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-ink-500">
          {partyName ? <span className="font-semibold">{partyName}</span> : null}
          {entry.details ? <span className="truncate">· {entry.details}</span> : null}
          <span>· {formatRelativeAr(entry.occurredAt || entry.createdAt)}</span>
          {entry.pendingSync ? <span className="text-gold-600">· بانتظار الإرسال</span> : null}
        </span>
      </span>

      <span className="shrink-0 text-end">
        <Money
          minor={isReversal ? entry.amountMinor : entry.amountMinor}
          currency={currency}
          signed={!isPayment && !isReversal}
          className={clsx(
            'block text-[0.9375rem] font-extrabold',
            isReversal ? 'text-ink-500' : isPayment ? 'text-brand-700 dark:text-brand-300' : 'text-danger-600',
          )}
        />
        {entry.entryKind === 'opening' ? <span className="block text-[0.625rem] text-ink-400">افتتاحي</span> : null}
      </span>
    </button>
  )
}
