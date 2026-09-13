/**
 * ورقة «تصدير كشف الحساب PDF»:
 *   · يختار المستخدم الفترة (كل الفترة / هذا الشهر / آخر 30 يومًا)
 *   · يرى ملخّصًا سريعًا (الرصيد المؤكد والمعلّق) قبل التصدير
 *   · يشارك الملف عبر تطبيقات الجهاز أو ينزّله على الجهاز
 *
 * تعمل للدورين: التاجر يُصدر كشفًا لأي عميل، والعميل يُصدر كشفًا لأي محل.
 * التوليد يتم داخل الجهاز بالكامل (لا يُرسل أي شيء إلى أي خادم).
 */

import { useMemo, useState } from 'react'
import { Download, FileText, Share2 } from 'lucide-react'
import { Button, Card, Chip, Money, Sheet, useToast } from '@/components/ui'
import { useProfile } from '@/app/hooks/useAuth'
import { usePartyEntries } from '@/app/hooks/useData'
import { buildStatement, type StatementPeriod } from '@/core/statement'
import { toUserMessage } from '@/core/errors'
import type { Party } from '@/core/domain'

const PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: 'all', label: 'كل الفترة' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'last30', label: 'آخر 30 يومًا' },
]

export function StatementExportSheet({
  open,
  onClose,
  party,
}: {
  open: boolean
  onClose: () => void
  party: Party | null
}) {
  const profile = useProfile()
  const entries = usePartyEntries(open ? party?.id : undefined)
  const toast = useToast()

  const [period, setPeriod] = useState<StatementPeriod>('all')
  const [busy, setBusy] = useState<'share' | 'download' | null>(null)

  const currency = profile.data?.currency ?? 'YER'

  const model = useMemo(() => {
    if (!party) return null
    return buildStatement({
      party,
      entries: entries.data ?? [],
      profile: profile.data ?? null,
      period,
      currency,
    })
  }, [party, entries.data, profile.data, period, currency])

  // فحص خفيف بلا تحميل محرّك PDF (يُحمَّل عند التصدير فقط)
  const share = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  async function exportPdf(mode: 'share' | 'download') {
    if (!model || busy) return
    setBusy(mode)
    try {
      // يُحمَّل محرّك PDF (وخطوطه) عند الحاجة فقط — لا يثقل فتح التطبيق
      const { buildStatementPdf, downloadPdf, pdfFileName, shareOrDownloadPdf } = await import('@/services/pdf')
      const bytes = await buildStatementPdf(model)
      const fileName = pdfFileName(model)
      if (mode === 'download') {
        downloadPdf(bytes, fileName)
        toast.show('تم تنزيل الكشف على جهازك', 'info')
      } else {
        const result = await shareOrDownloadPdf(bytes, fileName)
        toast.show(result === 'shared' ? 'تم تجهيز الكشف للمشاركة' : 'تم تنزيل الكشف على جهازك', 'info')
      }
      onClose()
    } catch (error) {
      toast.show(toUserMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="تصدير كشف حساب PDF"
      footer={
        <div className="space-y-2">
          {share ? (
            <Button
              block
              size="lg"
              icon={<Share2 size={18} />}
              loading={busy === 'share'}
              disabled={!model || busy !== null}
              onClick={() => void exportPdf('share')}
            >
              مشاركة الكشف
            </Button>
          ) : null}
          <Button
            block
            size="lg"
            variant={share ? 'soft' : 'primary'}
            icon={<Download size={18} />}
            loading={busy === 'download'}
            disabled={!model || busy !== null}
            onClick={() => void exportPdf('download')}
          >
            تنزيل ملف PDF
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <Card className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            <FileText size={22} />
          </span>
          <div className="text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
            <p className="font-bold text-ink-800 dark:text-ink-100">{party?.name ?? '—'}</p>
            <p className="mt-0.5">
              كشف حساب واضح بالتاريخ والمبلغ والحالة، يُبنى داخل جهازك ويُشارك كملف PDF. الرصيد يُحسب من العمليات
              المؤكدة فقط.
            </p>
          </div>
        </Card>

        <section>
          <p className="px-1 pb-1.5 text-[0.6875rem] font-bold text-ink-500">الفترة</p>
          <div className="grid grid-cols-3 gap-2">
            {PERIODS.map((item) => {
              const active = item.value === period
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setPeriod(item.value)}
                  aria-pressed={active}
                  className={
                    'h-11 rounded-2xl border text-[0.8125rem] font-bold transition active:scale-[0.98] ' +
                    (active
                      ? 'border-brand-600 bg-brand-600 text-white '
                      : 'border-ink-200 bg-white text-ink-700 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-200')
                  }
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <p className="px-1 pb-1.5 text-[0.6875rem] font-bold text-ink-500">ملخّص سريع</p>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] font-bold">الرصيد المتبقي (المؤكد)</span>
              <Money
                minor={model?.totals.remainingMinor ?? 0}
                currency={currency}
                className="text-[1.125rem] font-black text-brand-700 dark:text-brand-300"
              />
            </div>
            <div className="flex items-center justify-between text-[0.75rem] text-ink-600 dark:text-ink-300">
              <span>إجمالي الدين المؤكد</span>
              <Money minor={model?.totals.debtMinor ?? 0} currency={currency} className="font-extrabold" />
            </div>
            <div className="flex items-center justify-between text-[0.75rem] text-ink-600 dark:text-ink-300">
              <span>إجمالي السداد المؤكد</span>
              <Money minor={model?.totals.paidMinor ?? 0} currency={currency} className="font-extrabold" />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Chip tone="ok">{model?.counts.confirmed ?? 0} عملية مؤكدة</Chip>
              {(model?.counts.pending ?? 0) > 0 ? <Chip tone="warn">{model?.counts.pending} معلّقة</Chip> : null}
              <Chip tone="neutral">{model?.rows.length ?? 0} سطر في الكشف</Chip>
            </div>
            {(model?.counts.pending ?? 0) > 0 ? (
              <p className="rounded-xl bg-gold-50 px-3 py-2 text-[0.6875rem] font-semibold text-gold-800 dark:bg-gold-900/25 dark:text-gold-200">
                العمليات المعلّقة تظهر في الكشف بوسم «بانتظار التأكيد» ولا تدخل الرصيد.
              </p>
            ) : null}
          </Card>
        </section>
      </div>
    </Sheet>
  )
}
