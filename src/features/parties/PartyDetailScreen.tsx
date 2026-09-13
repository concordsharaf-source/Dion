import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FileText, Link2, Pencil, Phone, Plus, TrendingUp } from 'lucide-react'
import { Button, Card, Chip, EmptyState, Money, SectionTitle, Skeletons } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useProfile } from '@/app/hooks/useAuth'
import { useParty, usePartyEntries, useRelationships } from '@/app/hooks/useData'
import { computeTotals } from '@/core/balance'
import { dayGroupLabel, formatDateTimeAr } from '@/core/datetime'
import { EntryRow } from '@/features/entries/EntryRow'
import { EntryFormSheet } from '@/features/entries/EntryFormSheet'
import { EntryDetailSheet } from '@/features/entries/EntryDetailSheet'
import { StatementExportSheet } from '@/features/statement/StatementExportSheet'
import type { EntryType, FinancialEntry } from '@/core/domain'

export function PartyDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useProfile()
  const party = useParty(id)
  const entries = usePartyEntries(id)
  const relationships = useRelationships()

  const [openType, setOpenType] = useState<EntryType | null>(null)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const viewerId = profile.data?.id ?? ''
  const currency = profile.data?.currency ?? 'YER'
  const isMerchant = profile.data?.role === 'merchant'

  const data = useMemo(() => {
    const list = entries.data ?? []
    const totals = computeTotals(list, viewerId)
    const legacy = list.filter((e) => e.status === 'confirmed' && e.excludedFromBalance)
    const legacyRemaining = legacy.reduce(
      (sum, e) => sum + (e.entryType === 'debt' ? e.amountMinor : -e.amountMinor) * (e.entryKind === 'reversal' ? -1 : 1),
      0,
    )
    const active = list.filter((e) => !e.excludedFromBalance)
    const groups: { label: string; items: FinancialEntry[] }[] = []
    for (const entry of active) {
      const label = dayGroupLabel(entry.occurredAt || entry.createdAt)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(entry)
      else groups.push({ label, items: [entry] })
    }
    return { totals, legacy, legacyRemaining, groups }
  }, [entries.data, viewerId])

  const relationship = useMemo(
    () => relationships.data?.find((r) => r.id === party.data?.relationshipId) ?? null,
    [relationships.data, party.data],
  )

  const pendingForMe = (entries.data ?? []).filter(
    (e) => e.status === 'pending' && e.scope === 'shared' && e.creatorId !== viewerId,
  ).length

  if (party.isLoading) {
    return (
      <div>
        <PageHeader title="..." />
        <div className="space-y-3 px-4 pt-4">
          <Skeletons count={3} />
        </div>
      </div>
    )
  }

  if (!party.data) {
    return (
      <div>
        <PageHeader title="غير موجود" />
        <div className="px-4 pt-6">
          <Card>
            <EmptyState icon={<Plus size={24} />} title="لم يتم العثور على السجل" hint="ربما تم حذفه أو أرشفته." />
          </Card>
        </div>
      </div>
    )
  }

  const p = party.data
  const label = isMerchant ? 'عميل' : 'محل'

  return (
    <div className="pb-6">
      <PageHeader
        title={p.name}
        subtitle={p.phone ?? undefined}
        actions={
          <>
            {p.phone ? (
              <a
                href={`tel:${p.phone}`}
                aria-label="اتصال"
                className="grid h-10 w-10 place-items-center rounded-full text-ink-600 dark:text-ink-300"
              >
                <Phone size={19} />
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              aria-label="تصدير كشف PDF"
              className="grid h-10 w-10 place-items-center rounded-full text-ink-600 dark:text-ink-300"
            >
              <FileText size={18} />
            </button>
            <button
              type="button"
              onClick={() => navigate(`/parties/${p.id}/edit`)}
              aria-label="تعديل"
              className="grid h-10 w-10 place-items-center rounded-full text-ink-600 dark:text-ink-300"
            >
              <Pencil size={18} />
            </button>
          </>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        {p.linkStatus === 'verified' ? (
          <Link
            to={relationship ? `/link/${relationship.id}` : '/link'}
            className="flex items-center gap-2 rounded-2xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-[0.8125rem] font-bold text-brand-800 transition active:scale-[0.99] dark:border-brand-800/50 dark:bg-brand-900/25 dark:text-brand-200"
          >
            <Link2 size={18} />
            <span className="flex-1">
              حساب موثّق{p.linkedProfileName ? ` مع ${p.linkedProfileName}` : ''} — كل عملية تحتاج تأكيد الطرفين
            </span>
            <Chip tone="ok">موثّق</Chip>
          </Link>
        ) : (
          <div className="rounded-2xl bg-ink-200/50 px-3.5 py-3 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
            سجل مستقل — يعمل بلا ربط. يمكنك لاحقًا ربط حساب الطرف الآخر (اختياري) للتحقق المتبادل.
          </div>
        )}

        <Card className="text-center">
          <p className="text-[0.8125rem] font-semibold text-ink-500">{data.totals.remaining > 0 ? 'المتبقي' : 'الرصيد'}</p>
          <p className="mt-1 text-[2rem] font-black leading-tight tnum" dir="ltr">
            <Money minor={data.totals.remaining} currency={currency} />
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 text-start">
            <div className="rounded-2xl bg-ink-100 p-3 dark:bg-ink-900">
              <p className="text-[0.6875rem] text-ink-500">إجمالي الدين</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={data.totals.totalDebt} currency={currency} />
              </p>
            </div>
            <div className="rounded-2xl bg-ink-100 p-3 dark:bg-ink-900">
              <p className="text-[0.6875rem] text-ink-500">المسدّد</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={data.totals.totalPaid} currency={currency} />
              </p>
            </div>
          </div>

          {data.totals.pendingCount > 0 ? (
            <p className="mt-3 rounded-xl bg-gold-50 px-3 py-2 text-[0.75rem] font-semibold text-gold-800 dark:bg-gold-900/25 dark:text-gold-200">
              {data.totals.pendingCount} عملية معلّقة لا تدخل الرصيد حتى تُؤكَّد
              {pendingForMe > 0 ? ` — منها ${pendingForMe} بانتظارك` : ''}
            </p>
          ) : null}
        </Card>

        <Button block variant="soft" icon={<FileText size={17} />} onClick={() => setExportOpen(true)}>
          تصدير كشف حساب PDF
        </Button>

        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" icon={<Plus size={18} />} onClick={() => setOpenType('debt')}>
            تسجيل دين
          </Button>
          <Button size="lg" variant="soft" icon={<TrendingUp size={18} />} onClick={() => setOpenType('payment')}>
            تسجيل سداد
          </Button>
        </div>

        {data.legacy.length > 0 ? (
          <section>
            <SectionTitle>سجل سابق غير معتمد</SectionTitle>
            <Card className="space-y-2 bg-ink-100/70 dark:bg-ink-900/70">
              <p className="text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
                هذا سجل من قبل الربط. لا يُحتسب في الرصيد الموثّق، ويحتاج اعتمادًا صريحًا من الطرفين لدمجه.
              </p>
              <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 dark:bg-ink-950">
                <span className="text-[0.8125rem] font-bold">الرصيد السابق</span>
                <Money minor={data.legacyRemaining} currency={currency} className="font-extrabold" />
              </div>
              {relationship && relationship.openingBalanceStatus === 'proposed' ? (
                <Button block variant="gold" onClick={() => navigate(`/link/${relationship.id}`)}>
                  مراجعة اعتماد الرصيد السابق
                </Button>
              ) : null}
            </Card>
          </section>
        ) : null}

        <section>
          <SectionTitle>سجل العمليات</SectionTitle>
          {entries.isLoading ? (
            <Skeletons count={3} height={64} />
          ) : data.groups.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Plus size={24} />}
                title="لا توجد عمليات بعد"
                hint="سجّل أول دين أو سداد لهذا السجل."
                action={
                  <Button icon={<Plus size={16} />} onClick={() => setOpenType('debt')}>
                    تسجيل أول دين
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {data.groups.map((group) => (
                <div key={group.label}>
                  <p className="px-1 pb-1.5 text-[0.6875rem] font-bold text-ink-500">{group.label}</p>
                  <Card className="p-0">
                    {group.items.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        viewerId={viewerId}
                        currency={currency}
                        onOpen={() => setOpenEntryId(entry.id)}
                      />
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}
        </section>

        {p.note || p.address ? (
          <section>
            <SectionTitle>بيانات {label}</SectionTitle>
            <Card className="space-y-2 text-[0.8125rem]">
              {p.address ? (
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">العنوان</span>
                  <span className="font-semibold">{p.address}</span>
                </div>
              ) : null}
              {p.note ? (
                <div className="flex justify-between gap-3">
                  <span className="shrink-0 text-ink-500">ملاحظات</span>
                  <span className="text-end font-semibold">{p.note}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <span className="text-ink-500">تاريخ الإضافة</span>
                <span className="font-semibold">{formatDateTimeAr(p.createdAt)}</span>
              </div>
            </Card>
          </section>
        ) : null}
      </div>

      {/* نافذتان مستقلتان: الدين نافذة، والسداد نافذة أخرى */}
      <EntryFormSheet
        type="debt"
        open={openType === 'debt'}
        onClose={() => setOpenType(null)}
        defaultPartyId={p.id}
      />
      <EntryFormSheet
        type="payment"
        open={openType === 'payment'}
        onClose={() => setOpenType(null)}
        defaultPartyId={p.id}
      />
      <EntryDetailSheet
        entryId={openEntryId}
        open={openEntryId !== null}
        onClose={() => setOpenEntryId(null)}
        partyName={p.name}
      />
      <StatementExportSheet open={exportOpen} onClose={() => setExportOpen(false)} party={p} />
    </div>
  )
}
