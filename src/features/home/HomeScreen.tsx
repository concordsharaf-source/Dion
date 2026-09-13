import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, BellRing, ChevronLeft, Plus, Store, TrendingUp, User, Users } from 'lucide-react'
import { Button, Card, EmptyState, Money, SectionTitle, Skeletons } from '@/components/ui'
import { useProfile } from '@/app/hooks/useAuth'
import { useAwaitingCount, useEntries, useFilteredParties, useUnreadCount } from '@/app/hooks/useData'
import { computeTotals } from '@/core/balance'
import { EntryFormSheet } from '@/features/entries/EntryFormSheet'
import { EntryRow } from '@/features/entries/EntryRow'
import { EntryDetailSheet } from '@/features/entries/EntryDetailSheet'
import type { EntryType } from '@/core/domain'

export function HomeScreen() {
  const navigate = useNavigate()
  const profile = useProfile()
  const entries = useEntries({ status: 'all', limit: 300 })
  const parties = useFilteredParties({})
  const awaiting = useAwaitingCount()
  const unread = useUnreadCount()

  const [openType, setOpenType] = useState<EntryType | null>(null)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)

  const isMerchant = profile.data?.role === 'merchant'
  const currency = profile.data?.currency ?? 'YER'
  const viewerId = profile.data?.id ?? ''

  const totals = useMemo(() => {
    if (!entries.data || !viewerId) return null
    return computeTotals(entries.data.items, viewerId)
  }, [entries.data, viewerId])

  const partyNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of parties.all) map.set(s.party.id, s.party.name)
    return map
  }, [parties.all])

  const recent = (entries.data?.items ?? []).slice(0, 6)
  const topDebtors = useMemo(() => parties.items.filter((p) => p.remaining > 0).slice(0, 3), [parties.items])

  const firstName = profile.data?.fullName ?? ''
  const loading = entries.isLoading || profile.isLoading

  return (
    <div className="pb-4">
      {/* الشريط العلوي */}
      <header className="app-bar pt-safe">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-600 text-white">
          {isMerchant ? <Store size={20} /> : <User size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-extrabold">{firstName}</p>
          <p className="text-[0.6875rem] text-ink-500">{isMerchant ? 'حساب تاجر' : 'حساب عميل'}</p>
        </div>
        <Link
          to="/notifications"
          className="relative grid h-10 w-10 place-items-center rounded-full text-ink-600 dark:text-ink-300"
          aria-label="الإشعارات"
        >
          <BellRing size={20} />
          {unread.data ? (
            <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[0.625rem] font-extrabold text-white">
              {unread.data > 9 ? '9+' : unread.data}
            </span>
          ) : null}
        </Link>
      </header>

      <div className="space-y-4 px-4 pt-4">
        {/* البطاقة الرئيسية */}
        <Card className="bg-gradient-to-bl from-brand-600 to-brand-800 text-white border-none">
          <p className="text-[0.8125rem] font-semibold text-brand-50/90">
            {isMerchant ? 'إجمالي المتبقي لدى العملاء' : 'إجمالي المتبقي عليك'}
          </p>
          {loading || !totals ? (
            <div className="skeleton mt-2 h-10 w-40 bg-white/20" />
          ) : (
            <p className="mt-1 text-[2rem] font-black leading-tight tnum" dir="ltr">
              <Money minor={totals.remaining} currency={currency} />
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-[0.6875rem] text-brand-50/80">إجمالي الدين</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={totals?.totalDebt ?? 0} currency={currency} />
              </p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-[0.6875rem] text-brand-50/80">المسدّد</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={totals?.totalPaid ?? 0} currency={currency} />
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[0.6875rem] text-brand-50/80">
            <span>{isMerchant ? `${parties.all.length} عميل` : `${parties.all.length} محل`}</span>
            <span>{totals?.confirmedCount ?? 0} حركة مؤكدة</span>
          </div>
        </Card>

        {/* تنبيه العمليات المعلّقة */}
        {awaiting.data ? (
          <Link
            to="/entries?filter=awaiting_me"
            className="flex items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50 p-3.5 text-gold-900 transition active:scale-[0.99] dark:border-gold-800/40 dark:bg-gold-900/25 dark:text-gold-100"
          >
            <AlertCircle size={20} />
            <span className="flex-1 text-[0.8125rem] font-bold">
              لديك {awaiting.data} {awaiting.data === 1 ? 'عملية' : 'عمليات'} بانتظار تأكيدك
            </span>
            <ChevronLeft size={18} />
          </Link>
        ) : null}

        {/* إجراءات سريعة */}
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" icon={<Plus size={18} />} onClick={() => setOpenType('debt')}>
            تسجيل دين
          </Button>
          <Button size="lg" variant="soft" icon={<TrendingUp size={18} />} onClick={() => setOpenType('payment')}>
            تسجيل سداد
          </Button>
        </div>

        {isMerchant && topDebtors.length > 0 ? (
          <section>
            <SectionTitle action={<Link to="/parties" className="text-[0.75rem] font-bold text-brand-600">عرض الكل</Link>}>
              أعلى المتبقي عليهم
            </SectionTitle>
            <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
              {topDebtors.map((s) => (
                <Link
                  key={s.party.id}
                  to={`/parties/${s.party.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex items-center gap-3">
                    <Users size={18} className="text-ink-400" />
                    <span className="font-bold">{s.party.name}</span>
                  </span>
                  <Money minor={s.remaining} currency={currency} className="font-extrabold text-danger-600" />
                </Link>
              ))}
            </Card>
          </section>
        ) : null}

        {/* آخر العمليات */}
        <section>
          <SectionTitle
            action={
              <Link to="/entries" className="text-[0.75rem] font-bold text-brand-600">
                كل العمليات
              </Link>
            }
          >
            آخر العمليات
          </SectionTitle>

          {loading ? (
            <Skeletons count={3} height={64} />
          ) : recent.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Plus size={26} />}
                title="لا توجد عمليات بعد"
                hint={
                  isMerchant
                    ? 'أضف عميلًا ثم سجّل أول دين أو سداد. لا تحتاج أن يكون العميل مستخدمًا للتطبيق.'
                    : 'أضف محلًا ثم سجّل أول دين أو سداد. لا تحتاج أن يكون المحل مستخدمًا للتطبيق.'
                }
                action={
                  <Button
                    onClick={() => navigate('/parties/new')}
                    icon={<Plus size={16} />}
                  >
                    {isMerchant ? 'إضافة عميل' : 'إضافة محل'}
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="p-0">
              {recent.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  viewerId={viewerId}
                  currency={currency}
                  partyName={partyNames.get(
                    (entry.scope === 'solo' ? entry.partyId : entry.merchantUserId === viewerId ? entry.merchantPartyId : entry.customerPartyId) ?? '',
                  )}
                  onOpen={() => setOpenEntryId(entry.id)}
                />
              ))}
            </Card>
          )}
        </section>
      </div>

      {/* نافذتان مستقلتان: الدين نافذة، والسداد نافذة أخرى */}
      <EntryFormSheet type="debt" open={openType === 'debt'} onClose={() => setOpenType(null)} />
      <EntryFormSheet type="payment" open={openType === 'payment'} onClose={() => setOpenType(null)} />
      <EntryDetailSheet
        entryId={openEntryId}
        open={openEntryId !== null}
        onClose={() => setOpenEntryId(null)}
        partyName={
          openEntryId
            ? partyNames.get(
                (() => {
                  const e = entries.data?.items.find((x) => x.id === openEntryId)
                  if (!e) return ''
                  return (
                    (e.scope === 'solo' ? e.partyId : e.merchantUserId === viewerId ? e.merchantPartyId : e.customerPartyId) ?? ''
                  )
                })(),
              )
            : undefined
        }
      />
    </div>
  )
}
