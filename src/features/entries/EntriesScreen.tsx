import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ListOrdered } from 'lucide-react'
import clsx from 'clsx'
import { Card, EmptyState, Money, Skeletons } from '@/components/ui'
import { useProfile } from '@/app/hooks/useAuth'
import { useEntries, useFilteredParties } from '@/app/hooks/useData'
import { computeTotals } from '@/core/balance'
import { dayGroupLabel } from '@/core/datetime'
import { EntryRow } from './EntryRow'
import { EntryDetailSheet } from './EntryDetailSheet'
import type { EntryQuery } from '@/data/port'
import type { FinancialEntry } from '@/core/domain'

const FILTERS: { value: NonNullable<EntryQuery['filter']>; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'awaiting_me', label: 'بانتظار تأكيدي' },
  { value: 'confirmed', label: 'مؤكدة' },
  { value: 'created_by_me', label: 'سجّلتها' },
]

export function EntriesScreen() {
  const [params, setParams] = useSearchParams()
  const profile = useProfile()
  const filter = (params.get('filter') as EntryQuery['filter']) ?? 'all'
  const entryIdParam = params.get('entryId') ?? params.get('open')
  const [openEntryId, setOpenEntryId] = useState<string | null>(entryIdParam)

  // إذا جاء من إشعار مع entryId، افتحه مباشرة
  useEffect(() => {
    if (entryIdParam) {
      setOpenEntryId(entryIdParam)
    }
  }, [entryIdParam])

  const query = useMemo<EntryQuery>(() => ({ status: 'all', filter, limit: 200 }), [filter])
  const entries = useEntries(query)
  const parties = useFilteredParties({})

  const viewerId = profile.data?.id ?? ''
  const currency = profile.data?.currency ?? 'YER'

  const partyNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of parties.all) map.set(s.party.id, s.party.name)
    return map
  }, [parties.all])

  const totals = useMemo(
    () => (entries.data ? computeTotals(entries.data.items, viewerId) : null),
    [entries.data, viewerId],
  )

  const groups = useMemo(() => {
    const out: { label: string; items: FinancialEntry[] }[] = []
    for (const entry of entries.data?.items ?? []) {
      const label = dayGroupLabel(entry.occurredAt || entry.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(entry)
      else out.push({ label, items: [entry] })
    }
    return out
  }, [entries.data])

  const nameFor = (entry: FinancialEntry): string | undefined =>
    partyNames.get(
      (entry.scope === 'solo'
        ? entry.partyId
        : entry.merchantUserId === viewerId
          ? entry.merchantPartyId
          : entry.customerPartyId) ?? '',
    )

  return (
    <div className="pb-4">
      <header className="app-bar pt-safe">
        <div className="flex-1">
          <h1 className="text-[1.0625rem] font-extrabold">العمليات</h1>
          <p className="text-[0.6875rem] text-ink-500">
            {totals ? (
              <>
                المتبقي: <Money minor={totals.remaining} currency={currency} className="font-bold" />
                {totals.pendingCount ? ` · ${totals.pendingCount} معلّقة` : ''}
              </>
            ) : (
              'جارٍ التحميل...'
            )}
          </p>
        </div>
      </header>

      <div className="space-y-3 px-4 pt-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                if (f.value === 'all') setParams({})
                else setParams({ filter: f.value! })
              }}
              className={clsx(
                'shrink-0 rounded-full px-3.5 py-1.5 text-[0.75rem] font-bold transition',
                filter === f.value ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 dark:bg-ink-900 dark:text-ink-300',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {entries.isLoading ? (
          <Skeletons count={5} height={64} />
        ) : groups.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ListOrdered size={26} />}
              title="لا توجد عمليات"
              hint={
                filter === 'awaiting_me'
                  ? 'لا شيء بانتظار تأكيدك حاليًا.'
                  : 'ابدأ بتسجيل دين أو سداد من الصفحة الرئيسية.'
              }
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-1 pb-1.5 text-[0.6875rem] font-bold text-ink-500">{group.label}</p>
                <Card className="p-0">
                  {group.items.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      viewerId={viewerId}
                      currency={currency}
                      partyName={nameFor(entry)}
                      onOpen={() => setOpenEntryId(entry.id)}
                    />
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      <EntryDetailSheet
        entryId={openEntryId}
        open={openEntryId !== null}
        onClose={() => {
          setOpenEntryId(null)
          // نظف entryId من الرابط بعد الإغلاق
          if (params.get('entryId') || params.get('open')) {
            const next = new URLSearchParams(params)
            next.delete('entryId')
            next.delete('open')
            setParams(next, { replace: true })
          }
        }}
        partyName={openEntryId ? nameFor(entries.data?.items.find((e) => e.id === openEntryId) as FinancialEntry) : undefined}
      />
    </div>
  )
}
