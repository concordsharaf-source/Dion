import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Link2Off, Scale, ShieldCheck } from 'lucide-react'
import { Button, Card, ConfirmDialog, EmptyState, Money, SectionTitle, Sheet, Skeletons, useToast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useDataSource } from '@/app/DataSourceProvider'
import { useProfile } from '@/app/hooks/useAuth'
import { useBalanceProposals, useEntries, useRelationships } from '@/app/hooks/useData'
import { queryClient, qk } from '@/app/queryClient'
import { computeTotals } from '@/core/balance'
import { formatDateTimeAr } from '@/core/datetime'
import { toUserMessage } from '@/core/errors'
import { EntryRow } from '@/features/entries/EntryRow'
import { EntryDetailSheet } from '@/features/entries/EntryDetailSheet'

/** تفاصيل علاقة موثّقة: الرصيد المشترك، اعتماد الرصيد السابق، وإلغاء الربط */
export function RelationshipDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const ds = useDataSource()
  const toast = useToast()
  const profile = useProfile()
  const relationships = useRelationships()
  const proposals = useBalanceProposals()
  const entries = useEntries({ status: 'all', limit: 300 })

  const [sheet, setSheet] = useState<'approve' | 'decline' | 'unlink' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)

  const viewerId = profile.data?.id ?? ''
  const currency = profile.data?.currency ?? 'YER'
  const isMerchant = profile.data?.role === 'merchant'

  const rel = useMemo(() => relationships.data?.find((r) => r.id === id) ?? null, [relationships.data, id])

  /** الاقتراح المعلّق المقدَّم من الطرف الآخر (يُعتمد أو يُرفض) */
  const incomingProposal = useMemo(
    () =>
      (proposals.data ?? []).find(
        (p) => p.relationshipId === id && p.status === 'pending' && p.proposedBy !== viewerId,
      ) ?? null,
    [proposals.data, id, viewerId],
  )

  /** اقتراحي أنا المعلّق (بانتظار الطرف الآخر) */
  const outgoingProposal = useMemo(
    () =>
      (proposals.data ?? []).find(
        (p) => p.relationshipId === id && p.status === 'pending' && p.proposedBy === viewerId,
      ) ?? null,
    [proposals.data, id, viewerId],
  )

  const related = useMemo(
    () => (entries.data?.items ?? []).filter((e) => e.relationshipId === id),
    [entries.data, id],
  )
  const totals = useMemo(() => computeTotals(related, viewerId), [related, viewerId])

  const counterpartyName = rel ? (isMerchant ? rel.customerName : rel.merchantName) : ''

  async function approve() {
    if (!incomingProposal) return
    setBusy(true)
    try {
      await ds.links.respondProposal(incomingProposal.id, true)
      toast.show('تم اعتماد الرصيد السابق وتسجيله قيدًا افتتاحيًا')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.relationships }),
        queryClient.invalidateQueries({ queryKey: qk.proposals }),
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
        queryClient.invalidateQueries({ queryKey: ['parties'] }),
      ])
      setSheet(null)
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    if (!incomingProposal) return
    setBusy(true)
    try {
      await ds.links.respondProposal(incomingProposal.id, false)
      toast.show('تم رفض الرصيد السابق — بقي محفوظًا دون احتساب', 'info')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.relationships }),
        queryClient.invalidateQueries({ queryKey: qk.proposals }),
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
      ])
      setSheet(null)
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function counterProposal(amountMinor: number) {
    if (!rel) return
    setBusy(true)
    try {
      await ds.links.proposeOpeningBalance(rel.id, amountMinor, 'مبلغ معدّل مقترح للاعتماد')
      toast.show('تم إرسال المبلغ المعدّل للطرف الآخر للاعتماد')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.relationships }),
        queryClient.invalidateQueries({ queryKey: qk.proposals }),
      ])
      setSheet(null)
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    if (!rel) return
    setBusy(true)
    try {
      await ds.links.endRelationship(rel.id)
      toast.show('تم إلغاء الربط — السجل المالي محفوظ كما هو', 'info')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.relationships }),
        queryClient.invalidateQueries({ queryKey: ['entries'] }),
        queryClient.invalidateQueries({ queryKey: ['parties'] }),
      ])
      navigate('/link', { replace: true })
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (relationships.isLoading) {
    return (
      <div>
        <PageHeader title="..." />
        <div className="space-y-3 px-4 pt-4">
          <Skeletons count={3} />
        </div>
      </div>
    )
  }

  if (!rel) {
    return (
      <div>
        <PageHeader title="الربط" />
        <div className="px-4 pt-6">
          <Card>
            <EmptyState
              icon={<Link2Off size={24} />}
              title="لا يوجد ربط بهذا المعرّف"
              hint="ربما تم إلغاؤه. يمكنك إنشاء ربط جديد من مركز الربط."
              action={<Button onClick={() => navigate('/link')}>مركز الربط</Button>}
            />
          </Card>
        </div>
      </div>
    )
  }

  const legacy = related.filter((e) => e.excludedFromBalance && e.status === 'confirmed')
  const active = related.filter((e) => !e.excludedFromBalance)

  return (
    <div className="pb-6">
      <PageHeader title={counterpartyName ?? 'حساب موثّق'} subtitle="حساب موثّق بين طرفين" />

      <div className="space-y-4 px-4 pt-4">
        <Card className="bg-gradient-to-bl from-brand-600 to-brand-800 text-white border-none">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold text-brand-50/90">
            <ShieldCheck size={16} /> المتبقي الموثّق {isMerchant ? 'على الطرف الآخر' : 'عليك'}
          </p>
          <p className="mt-1 text-[2rem] font-black leading-tight tnum" dir="ltr">
            <Money minor={totals.remaining} currency={currency} />
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-[0.6875rem] text-brand-50/80">مؤكد</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={totals.totalDebt} currency={currency} />
              </p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-[0.6875rem] text-brand-50/80">مسدّد</p>
              <p className="mt-0.5 font-extrabold tnum" dir="ltr">
                <Money minor={totals.totalPaid} currency={currency} />
              </p>
            </div>
          </div>
          {totals.pendingCount > 0 ? (
            <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[0.75rem] font-semibold">
              {totals.pendingCount} عملية معلّقة لا تدخل الرصيد حتى تُؤكَّد
            </p>
          ) : null}
        </Card>

        <Card className="divide-y divide-ink-200/70 text-[0.8125rem] dark:divide-ink-800/70">
          <Row label="الحالة" value={rel.status === 'verified' ? 'موثّق' : 'منتهي'} />
          <Row label="تاريخ الربط" value={formatDateTimeAr(rel.createdAt)} />
          <Row
            label="الرصيد السابق"
            value={
              rel.openingBalanceStatus === 'accepted'
                ? `معتمد — ${(rel.openingBalanceMinor / 100).toLocaleString('ar-EG')}`
                : rel.openingBalanceStatus === 'proposed'
                  ? 'بانتظار الاعتماد'
                  : rel.openingBalanceStatus === 'declined'
                    ? 'مرفوض — بدأ الحساب من تاريخ الربط'
                    : 'لا يوجد'
            }
          />
        </Card>

        {rel.openingBalanceStatus === 'proposed' && incomingProposal ? (
          <Card className="space-y-3 border-gold-300 bg-gold-50 dark:bg-gold-900/20">
            <div className="flex items-center gap-2 font-extrabold text-gold-900 dark:text-gold-100">
              <Scale size={18} /> رصيد سابق يحتاج قرارًا
            </div>
            <p className="text-[0.75rem] leading-5 text-gold-900/90 dark:text-gold-100/90">
              الرصيد السابق المسجّل سابقًا:{' '}
              <Money minor={incomingProposal.amountMinor} currency={currency} className="font-extrabold" />. لن يُدمج
              تلقائيًا — الاعتماد يتطلب موافقتك الصريحة، ورفضه لا يحذف أي سجل.
            </p>
            <div className="flex gap-2">
              <Button block variant="gold" onClick={() => setSheet('approve')}>
                اعتماد الرصيد
              </Button>
              <Button
                block
                variant="ghost"
                onClick={() => {
                  setReason('')
                  setSheet('decline')
                }}
              >
                رفض والبدء من الآن
              </Button>
            </div>
          </Card>
        ) : null}

        {rel.openingBalanceStatus === 'proposed' && outgoingProposal ? (
          <div className="rounded-2xl border border-gold-300 bg-gold-50 p-3.5 text-[0.75rem] leading-5 text-gold-900 dark:bg-gold-900/20 dark:text-gold-100">
            اقترحت رصيدًا سابقًا بقيمة{' '}
            <Money minor={outgoingProposal.amountMinor} currency={currency} className="font-extrabold" /> وهو بانتظار
            موافقة الطرف الآخر. لن يُحتسب قبل اعتماده.
          </div>
        ) : null}

        {legacy.length > 0 ? (
          <div className="rounded-2xl bg-ink-200/60 p-3.5 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
            يوجد {legacy.length} قيد سابق محفوظ خارج الرصيد الموثّق (غير مدمج). يبقى ظاهرًا في السجل للرجوع إليه.
          </div>
        ) : null}

        <section>
          <SectionTitle>عمليات هذا الحساب</SectionTitle>
          {entries.isLoading ? (
            <Skeletons count={3} height={64} />
          ) : active.length === 0 ? (
            <Card>
              <EmptyState icon={<ShieldCheck size={24} />} title="لا توجد عمليات بعد" hint="سجّل عملية من بطاقة الطرف الآخر." />
            </Card>
          ) : (
            <Card className="p-0">
              {active.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  viewerId={viewerId}
                  currency={currency}
                  partyName={counterpartyName ?? undefined}
                  onOpen={() => setOpenEntryId(entry.id)}
                />
              ))}
            </Card>
          )}
        </section>

        <section className="pt-2">
          <Button
            block
            variant="ghost"
            className="text-danger-600"
            icon={<AlertTriangle size={16} />}
            onClick={() => {
              setReason('')
              setSheet('unlink')
            }}
          >
            إلغاء الربط
          </Button>
          <p className="mt-2 px-1 text-center text-[0.6875rem] leading-5 text-ink-500">
            إلغاء الربط يوقف التأكيد المتبادل الجديد. جميع العمليات المؤكدة السابقة تبقى محفوظة ولا تُحذف.
          </p>
        </section>
      </div>

      {/* اعتماد الرصيد السابق كقيد افتتاحي */}
      <ConfirmProposalSheet
        open={sheet === 'approve'}
        amountMinor={incomingProposal?.amountMinor ?? 0}
        currency={currency}
        busy={busy}
        onClose={() => setSheet(null)}
        onAccept={() => void approve()}
        onCounter={(amount) => void counterProposal(amount)}
      />

      <ConfirmDialog
        open={sheet === 'decline'}
        title="رفض الرصيد السابق"
        message="لن يُدمج الرصيد السابق. يبدأ الحساب الموثّق من تاريخ الربط، ويبقى السجل القديم محفوظًا دون احتساب."
        confirmLabel="رفض والبدء من الآن"
        tone="danger"
        loading={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() => void decline()}
      >
        <textarea
          className="field min-h-20 resize-none"
          placeholder="سبب الرفض (اختياري) — مثال: المبلغ مختلف عن دفتري"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={sheet === 'unlink'}
        title="إلغاء الربط"
        message="سيُوقف التأكيد المتبادل الجديد، وتبقى كل العمليات المؤكدة والرصيد كما هو. لا يُحذف أي سجل مالي."
        confirmLabel="إلغاء الربط"
        tone="danger"
        loading={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() => void unlink()}
      >
        <textarea
          className="field min-h-20 resize-none"
          placeholder="سبب إلغاء الربط (اختياري)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
      </ConfirmDialog>

      <EntryDetailSheet
        entryId={openEntryId}
        open={openEntryId !== null}
        onClose={() => setOpenEntryId(null)}
        partyName={counterpartyName ?? undefined}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-ink-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

/** ورقة اعتماد الرصيد السابق — تعرض المبلغ القادم من الطرف الآخر وتسمح بالتصحيح قبل الاعتماد */
function ConfirmProposalSheet({
  open,
  amountMinor,
  currency,
  busy,
  onClose,
  onAccept,
  onCounter,
}: {
  open: boolean
  amountMinor: number
  currency?: string
  busy: boolean
  onClose: () => void
  onAccept: () => void
  onCounter: (amountMinor: number) => void
}) {
  const [value, setValue] = useState('')
  const proposed = amountMinor / 100

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="اعتماد الرصيد السابق"
      footer={
        <div className="space-y-2">
          <Button block size="lg" loading={busy} onClick={onAccept}>
            أعتمد المبلغ المذكور
          </Button>
          <Button
            block
            variant="ghost"
            loading={busy}
            disabled={!value || Number(value.replace(/[^\d.]/g, '')) <= 0}
            onClick={() => {
              const minor = Math.round(Number(value.replace(/[^\d.]/g, '')) * 100)
              onCounter(minor)
            }}
          >
            أعتمد مبلغًا مختلفًا
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="rounded-2xl bg-ink-100 p-4 text-center dark:bg-ink-900">
          <p className="text-[0.75rem] text-ink-500">المبلغ المسجّل في دفتر الطرف الآخر</p>
          <p className="mt-1 text-2xl font-black tnum" dir="ltr">
            {proposed.toLocaleString('ar-EG')} <span className="text-sm font-bold">{currency}</span>
          </p>
        </div>
        <p className="text-[0.75rem] leading-5 text-ink-500">
          عند الاعتماد يُسجَّل هذا المبلغ كقيد افتتاحي موثّق في دفترك أنت أيضًا. لا تتم أي عملية دمج تلقائية — القرار
          بيدك، ويمكنك تسجيل مبلغ مختلف.
        </p>
        <div>
          <label className="mb-1.5 block text-[0.8125rem] font-bold" htmlFor="alt-amount">
            مبلغ مختلف (اختياري)
          </label>
          <input
            id="alt-amount"
            className="field tnum"
            dir="ltr"
            inputMode="decimal"
            placeholder="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
    </Sheet>
  )
}
