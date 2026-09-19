import { useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { Button, ConfirmDialog, Money, Sheet, StatusChip, useToast } from '@/components/ui'
import { useEntry, useEntryActions } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { formatDateTimeAr } from '@/core/datetime'
import { canPerform } from '@/core/domain'
import { toUserMessage } from '@/core/errors'
import { sanitizeMultiline } from '@/core/validation'

/**
 * تفاصيل عملية + الإجراءات المسموح بها حسب الحالة والصلاحية
 * (تأكيد · رفض بسبب · إلغاء) — لا «عكس عملية»: التصحيح بتسجيل العملية المعاكسة
 */
export function EntryDetailSheet({
  entryId,
  open,
  onClose,
  partyName,
}: {
  entryId: string | null
  open: boolean
  onClose: () => void
  partyName?: string
}) {
  const profile = useProfile()
  const entryQuery = useEntry(entryId ?? undefined)
  const actions = useEntryActions()
  const toast = useToast()

  const [dialog, setDialog] = useState<'reject' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')

  const entry = entryQuery.data ?? null
  const viewerId = profile.data?.id ?? ''
  const currency = profile.data?.currency

  const canConfirm = entry ? canPerform('confirm', entry, viewerId).allowed : false
  const canCancel = entry ? canPerform('cancel', entry, viewerId).allowed : false

  async function run(kind: 'confirm' | 'reject' | 'cancel') {
    if (!entry) return
    try {
      if (kind === 'confirm') {
        await actions.confirm.mutateAsync(entry.id)
        toast.show('تم تأكيد العملية ودخلت في الرصيد')
      } else if (kind === 'reject') {
        await actions.reject.mutateAsync({ id: entry.id, reason: sanitizeMultiline(reason, 300) || null })
        toast.show('تم رفض العملية', 'info')
      } else {
        await actions.cancel.mutateAsync(entry.id)
        toast.show('تم إلغاء العملية', 'info')
      }
      setDialog(null)
      setReason('')
      onClose()
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    }
  }

  const busy = actions.confirm.isPending || actions.reject.isPending || actions.cancel.isPending

  return (
    <>
      <Sheet open={open} onClose={onClose} title="تفاصيل العملية" size="tall">
        {!entry ? (
          <div className="skeleton h-40" />
        ) : (
          <div className="space-y-4 pb-2">
            <div className="card p-4 text-center">
              <p className="text-[0.75rem] text-ink-500">
                {entry.entryType === 'debt' ? 'دين' : 'سداد'} · {partyName ?? ''}
              </p>
              <p className="mt-1 text-3xl font-black tnum" dir="ltr">
                <Money minor={entry.amountMinor} currency={currency} showSymbol={false} />
              </p>
              <div className="mt-2 flex justify-center">
                <StatusChip status={entry.status} />
              </div>
            </div>

            <dl className="card divide-y divide-ink-200/70 text-[0.8125rem] dark:divide-ink-800/70">
              <Row label="النوع" value={entry.entryType === 'debt' ? 'دين' : 'سداد'} />
              {entry.entryKind !== 'normal' ? (
                <Row label="الطبيعة" value={entry.entryKind === 'reversal' ? 'قيد عكسي' : 'رصيد افتتاحي'} />
              ) : null}
              <Row label="النطاق" value={entry.scope === 'shared' ? 'موثّق بين طرفين' : 'دفتر شخصي'} />
              {entry.details ? <Row label="التفاصيل" value={entry.details} /> : null}
              {entry.note ? <Row label="ملاحظة" value={entry.note} /> : null}
              <Row label="أنشئت بواسطة" value={entry.creatorName ?? (entry.creatorId === viewerId ? 'أنا' : 'الطرف الآخر')} />
              <Row label="وقت الإنشاء" value={formatDateTimeAr(entry.createdAt)} />
              {entry.occurredAt !== entry.createdAt ? (
                <Row label="وقت الواقعة" value={formatDateTimeAr(entry.occurredAt)} />
              ) : null}
              {entry.confirmedAt ? (
                <Row
                  label="تم التأكيد"
                  value={`${formatDateTimeAr(entry.confirmedAt)}${entry.confirmedByName ? ` · ${entry.confirmedByName}` : ''}`}
                />
              ) : null}
              {entry.rejectedAt ? (
                <Row
                  label="تم الرفض"
                  value={`${formatDateTimeAr(entry.rejectedAt)}${entry.rejectedByName ? ` · ${entry.rejectedByName}` : ''}`}
                />
              ) : null}
              {entry.reason ? <Row label="سبب الرفض" value={entry.reason} /> : null}
              {entry.reversedByEntryId ? <Row label="حالة القيد" value="مصحّحة بقيد لاحق (سجل قديم)" /> : null}
              <Row label="المعرّف" value={entry.id.slice(0, 8)} />
            </dl>

            {entry.status === 'pending' && entry.scope === 'shared' && entry.creatorId !== viewerId ? (
              <p className="rounded-2xl bg-gold-50 p-3 text-[0.75rem] leading-5 text-gold-800 dark:bg-gold-900/25 dark:text-gold-200">
                هذا الدين/السداد سجّله الطرف الآخر. لن يُحتسب في الرصيد حتى تؤكّده أو ترفضه.
              </p>
            ) : null}

            <div className="space-y-2">
              {canConfirm ? (
                <div className="flex gap-2">
                  <Button block size="lg" icon={<Check size={18} />} loading={busy} onClick={() => void run('confirm')}>
                    تأكيد
                  </Button>
                  <Button
                    block
                    size="lg"
                    variant="ghost"
                    icon={<X size={18} />}
                    disabled={busy}
                    onClick={() => {
                      setReason('')
                      setDialog('reject')
                    }}
                  >
                    رفض
                  </Button>
                </div>
              ) : null}

              {canCancel ? (
                <Button
                  block
                  variant="ghost"
                  icon={<Trash2 size={16} />}
                  onClick={() => setDialog('cancel')}
                  className="text-danger-600"
                >
                  إلغاء العملية
                </Button>
              ) : null}

              {entry.status === 'confirmed' ? (
                <p className="rounded-2xl bg-ink-100 p-3 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
                  سُجّلت خطأً؟ لا نحذف أي سجل مالي: سجّل العملية المعاكسة (سداد مقابل دين، أو دين مقابل سداد) ويتعدّل الرصيد فورًا.
                </p>
              ) : null}

              {entry.status === 'pending' && entry.creatorId === viewerId ? (
                <p className="text-center text-[0.75rem] text-ink-500">بانتظار تأكيد الطرف الآخر — لا يمكنك تأكيد عمليتك.</p>
              ) : null}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={dialog === 'reject'}
        title="رفض العملية"
        message="لن تُحتسب العملية في الرصيد. يمكنك كتابة سبب الرفض ليظهر للطرف الآخر."
        confirmLabel="رفض العملية"
        tone="danger"
        loading={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('reject')}
      >
        <textarea
          className="field min-h-20 resize-none"
          placeholder="سبب الرفض (اختياري) — مثال: المبلغ الصحيح 15,000 وليس 20,000"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'cancel'}
        title="إلغاء العملية"
        message="سيتم إلغاء العملية قبل تأكيدها. يبقى أثرها في السجل."
        confirmLabel="إلغاء العملية"
        tone="danger"
        loading={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('cancel')}
      />

    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="text-end font-semibold">{value}</dd>
    </div>
  )
}
