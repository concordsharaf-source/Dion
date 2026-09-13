import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, Plus, Search, Store, Users } from 'lucide-react'
import clsx from 'clsx'
import { Avatar, Button, Card, Chip, EmptyState, Money, Skeletons, StatusChip } from '@/components/ui'
import { useProfile } from '@/app/hooks/useAuth'
import { useFilteredParties } from '@/app/hooks/useData'
import { PARTY_SORT_LABELS, type PartySort } from '@/core/balance'
import { displayPhone } from '@/core/validation'

const SORTS: PartySort[] = ['recent_activity', 'highest_debt', 'lowest_debt', 'remaining', 'fully_paid', 'name', 'newest']

export function PartiesScreen() {
  const navigate = useNavigate()
  const profile = useProfile()
  const isMerchant = profile.data?.role === 'merchant'
  const currency = profile.data?.currency ?? 'YER'

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PartySort>('recent_activity')
  const [showArchived, setShowArchived] = useState(false)

  const options = useMemo(
    () => ({ query, sort, includeArchived: showArchived }),
    [query, sort, showArchived],
  )
  const { items, isLoading } = useFilteredParties(options)

  const label = isMerchant ? 'عميل' : 'محل'
  const plural = isMerchant ? 'العملاء' : 'المحلات'

  return (
    <div className="pb-4">
      <header className="app-bar pt-safe">
        <div className="flex-1">
          <h1 className="text-[1.0625rem] font-extrabold">{plural}</h1>
          <p className="text-[0.6875rem] text-ink-500">
            {isLoading ? 'جارٍ التحميل...' : `${items.length} ${items.length === 1 ? label : plural}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={clsx(
            'rounded-xl px-2.5 py-1.5 text-[0.6875rem] font-bold transition',
            showArchived ? 'bg-brand-600 text-white' : 'bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
          )}
        >
          المؤرشفون
        </button>
      </header>

      <div className="space-y-3 px-4 pt-3">
        <div className="relative">
          <Search size={18} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={'ابحث بالاسم أو رقم الهاتف...'}
            className="field pe-10"
            inputMode="search"
          />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={clsx(
                'shrink-0 rounded-full px-3 py-1.5 text-[0.75rem] font-bold transition',
                sort === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-ink-600 dark:bg-ink-900 dark:text-ink-300',
              )}
            >
              {PARTY_SORT_LABELS[s]}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Skeletons count={4} />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon={isMerchant ? <Users size={26} /> : <Store size={26} />}
              title={query ? 'لا نتائج مطابقة' : `لا يوجد ${plural} بعد`}
              hint={
                query
                  ? 'جرّب اسمًا آخر أو جزءًا من رقم الهاتف.'
                  : isMerchant
                    ? 'أضف عميلك الأول لتسجيل الديون والسدادات — لا يلزم أن يكون لديه حساب في التطبيق.'
                    : 'أضف المحل الذي تتعامل معه لتسجيل ديونك وسداداتك.'
              }
              action={
                query ? null : (
                  <Button icon={<Plus size={16} />} onClick={() => navigate('/parties/new')}>
                    إضافة {label}
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((s) => (
              <li key={s.party.id}>
                <Link to={`/parties/${s.party.id}`} className="card block p-3.5 transition active:scale-[0.99]">
                  <div className="flex items-start gap-3">
                    <Avatar name={s.party.name} className="h-11 w-11 text-base" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-extrabold">{s.party.name}</p>
                        {s.party.linkStatus === 'verified' ? (
                          <Chip tone="ok">
                            <Link2 size={11} /> موثّق
                          </Chip>
                        ) : null}
                        {s.party.archivedAt ? <Chip>مؤرشف</Chip> : null}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem] text-ink-500">
                        {s.party.phone ? <span dir="ltr">{displayPhone(s.party.phone)}</span> : <span>لا يوجد رقم</span>}
                        {s.entryCount ? <span>· {s.entryCount} حركة</span> : null}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <Money
                        minor={s.remaining}
                        currency={currency}
                        className={clsx(
                          'block text-[0.9375rem] font-extrabold',
                          s.remaining > 0 ? 'text-danger-600' : 'text-brand-700 dark:text-brand-300',
                        )}
                      />
                      <span className="text-[0.625rem] text-ink-400">{s.remaining > 0 ? 'متبقي' : 'مسدَّد'}</span>
                    </div>
                  </div>

                  {s.totalDebt > 0 ? (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.ratio * 100}%` }} />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[0.625rem] text-ink-500">
                        <span>
                          الدين: <Money minor={s.totalDebt} currency={currency} showSymbol={false} />
                        </span>
                        <span>
                          المسدّد: <Money minor={s.totalPaid} currency={currency} showSymbol={false} />
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {s.hasPendingForMe ? (
                    <div className="mt-2.5 flex items-center gap-2">
                      <StatusChip status="pending" />
                      <span className="text-[0.6875rem] font-semibold text-gold-700 dark:text-gold-300">
                        بانتظار تأكيدك
                      </span>
                    </div>
                  ) : null}

                  {s.legacyCount > 0 ? (
                    <p className="mt-2 rounded-xl bg-ink-200/60 px-3 py-2 text-[0.6875rem] text-ink-600 dark:bg-ink-900 dark:text-ink-300">
                      سجل سابق غير معتمد: <Money minor={s.legacyRemaining} currency={currency} className="font-bold" /> — لا يُحتسب
                      حتى يُعتمد من الطرفين.
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* زر عائم */}
      <button
        type="button"
        onClick={() => navigate('/parties/new')}
        aria-label={`إضافة ${label} جديد`}
        className="fixed bottom-24 end-4 z-40 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-white shadow-float transition active:scale-95 sm:end-[calc(50%-15rem+1rem)]"
      >
        <Plus size={26} />
      </button>
    </div>
  )
}
