import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, Delete, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { Button, Field, Input, Money, Sheet, useToast } from '@/components/ui'
import { useCreateEntry, useFilteredParties } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { sanitizeMultiline, sanitizeText } from '@/core/validation'
import { getCurrency, readAmount, SCALE } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import { uuid } from '@/core/id'
import type { EntryType, Party } from '@/core/domain'

/**
 * نافذة تسجيل عملية مالية — مستقلة لكل نوع:
 *   · «تسجيل دين»   (نافذة الدين)
 *   · «تسجيل سداد» (نافذة السداد)
 *
 * تُفتح مباشرة على خانة المبلغ مع لوحة أرقام داخلية لإدخال سريع بلا تعقيد،
 * وتعمل بلوحة المفاتيح أيضًا (أرقام · Backspace · Enter).
 */

/** إضافات سريعة بالوحدات الكبرى (تُحوّل لوحدات صغرى داخلية) */
const QUICK_ADD_UNITS = [1_000, 5_000, 10_000, 25_000, 50_000]

export function EntryFormSheet({
  open,
  onClose,
  type,
  defaultPartyId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  /** نوع العملية — تحدّده النافذة التي فتحها المستخدم ولا يمكن تبديله داخلها */
  type: EntryType
  defaultPartyId?: string
  onSaved?: (partyId: string) => void
}) {
  const isDebt = type === 'debt'
  const profile = useProfile()
  const partiesQuery = useFilteredParties({})
  const createEntry = useCreateEntry()
  const toast = useToast()

  const currency = profile.data?.currency ?? 'YER'
  const cur = getCurrency(currency)

  const [partyId, setPartyId] = useState(defaultPartyId ?? '')
  const [picking, setPicking] = useState(!defaultPartyId)
  const [search, setSearch] = useState('')
  const [raw, setRaw] = useState('')
  const [details, setDetails] = useState('')
  const [note, setNote] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState('')

  const amountRef = useRef<HTMLInputElement>(null)

  /* ----- إعادة الضبط والتركيز على المبلغ عند الفتح ----- */
  useEffect(() => {
    if (!open) return
    setPartyId(defaultPartyId ?? '')
    setPicking(!defaultPartyId)
    setSearch('')
    setRaw('')
    setDetails('')
    setNote('')
    setShowMore(false)
    setError('')
    const timer = window.setTimeout(() => amountRef.current?.focus(), 260)
    return () => window.clearTimeout(timer)
  }, [open, defaultPartyId, type])

  const all = partiesQuery.all
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = all.map((s) => s.party)
    if (!q) return list.slice(0, 60)
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)).slice(0, 60)
  }, [all, search])

  const selected: Party | null = useMemo(() => all.find((s) => s.party.id === partyId)?.party ?? null, [all, partyId])
  const summary = useMemo(() => all.find((s) => s.party.id === partyId) ?? null, [all, partyId])

  const isLinked = selected?.linkStatus === 'verified'
  const isCustomer = profile.data?.role === 'customer'
  const partyLabel = isCustomer ? 'المحل' : 'العميل'

  /* ----- المبلغ: قراءة مباشرة من نص الإدخال ----- */
  const parsed = raw === '' ? null : readAmount(raw)
  const minor = parsed && parsed.ok ? parsed.minor : 0
  const display = minor > 0 ? new Intl.NumberFormat('en-US', { maximumFractionDigits: cur.decimals }).format(minor / 100) : '0'

  // المتبقي القابل للسداد (من الملخّصات المحسوبة)
  const remaining = summary?.remaining ?? 0
  const overPayment = !isDebt && minor > 0 && minor > remaining

  const canSubmit = Boolean(partyId) && minor > 0 && !overPayment && !createEntry.isPending

  /* ----- لوحة الأرقام ----- */
  const press = useCallback(
    (key: string) => {
      setError('')
      setRaw((prev) => {
        if (key === 'back') return prev.slice(0, -1)
        if (key === 'clear') return ''
        if (key === '.') {
          if (cur.decimals === 0 || prev.includes('.')) return prev
          return prev === '' ? '0.' : prev + '.'
        }
        // خانات عشرية بحد العملة
        if (prev.includes('.') && prev.split('.')[1]!.length >= cur.decimals) return prev
        if (prev.replace(/[^\d]/g, '').length >= 12) return prev
        if (prev === '0') return key === '0' || key === '00' ? prev : key
        return prev + key
      })
    },
    [cur.decimals],
  )

  const addAmount = useCallback(
    (increment: number) => {
      setError('')
      setRaw((prev) => {
        const base = readAmount(prev)
        const current = base.ok ? base.minor : 0
        const next = current + increment
        if (next <= 0) return ''
        return String(next / 100)
      })
    },
    [],
  )

  /* ----- لوحة المفاتيح الخارجية (سطح المكتب) ----- */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        press('back')
      } else if (e.key === '.' || e.key === '٫' || e.key === ',') {
        e.preventDefault()
        press('.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, press])

  async function submit() {
    setError('')
    if (!partyId) {
      setError(`اختر ${partyLabel}`)
      setPicking(true)
      return
    }
    if (!(minor > 0)) {
      setError(isDebt ? 'أدخل مبلغ الدين' : 'أدخل مبلغ السداد')
      return
    }
    if (overPayment) {
      setError('مبلغ السداد أكبر من الرصيد المتبقي')
      return
    }

    try {
      await createEntry.mutateAsync({
        partyId,
        entryType: type,
        amountMinor: minor,
        currency,
        details: sanitizeText(details, 160) || null,
        note: sanitizeMultiline(note, 500) || null,
        clientRef: uuid(),
      })
      toast.show(
        isLinked
          ? isDebt
            ? 'تم تسجيل الدين — بانتظار تأكيد الطرف الآخر'
            : 'تم تسجيل السداد — بانتظار تأكيد الطرف الآخر'
          : isDebt
            ? 'تم تسجيل الدين في دفترك'
            : 'تم تسجيل السداد في دفترك',
      )
      onSaved?.(partyId)
      onClose()
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  const Icon = isDebt ? ArrowDownLeft : ArrowUpRight

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isDebt ? 'تسجيل دين' : 'تسجيل سداد'}
      size="tall"
      footer={
        <div className="space-y-2">
          {error ? (
            <p className="text-center text-[0.8125rem] font-bold text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            block
            size="lg"
            variant={isDebt ? 'danger' : 'primary'}
            loading={createEntry.isPending}
            disabled={!canSubmit}
            icon={<Check size={18} />}
            onClick={submit}
          >
            {isDebt ? 'تسجيل الدين' : 'تسجيل السداد'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pb-2">
        {/* ---------- الطرف ---------- */}
        {picking ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.8125rem] font-bold">{`اختر ${partyLabel}`}</p>
              {selected ? (
                <button type="button" className="text-[0.75rem] font-bold text-brand-600" onClick={() => setPicking(false)}>
                  إغلاق
                </button>
              ) : null}
            </div>
            {all.length > 6 ? (
              <div className="relative">
                <Search size={18} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`ابحث عن ${partyLabel}...`}
                  className="pe-10"
                  aria-label={`بحث ${partyLabel}`}
                />
              </div>
            ) : null}
            <div className="max-h-[28dvh] space-y-2 overflow-y-auto pe-1">
              {filtered.length === 0 ? (
                <p className="py-3 text-center text-[0.8125rem] text-ink-500">
                  لا يوجد {partyLabel}. أضفه أولًا من قسم {isCustomer ? 'المحلات' : 'العملاء'}.
                </p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPartyId(p.id)
                      setPicking(false)
                      amountRef.current?.focus()
                    }}
                    aria-pressed={p.id === partyId}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-3 py-2.5 text-start transition',
                      p.id === partyId
                        ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30'
                        : 'border-transparent bg-white dark:bg-ink-900',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{p.name}</span>
                      {p.phone ? (
                        <span className="block text-[0.6875rem] text-ink-500" dir="ltr">
                          {p.phone}
                        </span>
                      ) : null}
                    </span>
                    {p.linkStatus === 'verified' ? <span className="chip bg-brand-100 text-brand-800">موثّق</span> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-white p-3 dark:bg-ink-900">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={clsx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                  isDebt ? 'bg-danger-100 text-danger-600 dark:bg-danger-500/20' : 'bg-brand-100 text-brand-700',
                )}
              >
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-extrabold">{selected?.name ?? '—'}</span>
                <span className="block text-[0.6875rem] text-ink-500">
                  {isLinked ? 'حساب موثّق · يحتاج تأكيد الطرف الآخر' : 'دفتر شخصي'}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="shrink-0 rounded-xl px-2.5 py-1.5 text-[0.75rem] font-bold text-brand-600"
            >
              تغيير
            </button>
          </div>
        )}

        {/* ---------- المبلغ + لوحة الأرقام ---------- */}
        <div className="space-y-3">
          <div
            className={clsx(
              'rounded-3xl border-2 p-4 text-center transition',
              overPayment
                ? 'border-danger-500 bg-danger-50 dark:bg-danger-500/10'
                : isDebt
                  ? 'border-danger-200 bg-danger-50/60 dark:border-danger-500/30 dark:bg-danger-500/10'
                  : 'border-brand-200 bg-brand-50/70 dark:border-brand-500/30 dark:bg-brand-500/10',
            )}
          >
            <p className="text-[0.75rem] font-bold text-ink-500">
              {isDebt ? 'مبلغ الدين' : 'مبلغ السداد'}
              {!isDebt && selected ? (
                <>
                  {' · '}
                  المتبقي: <Money minor={remaining} currency={currency} className="font-bold" />
                </>
              ) : null}
            </p>

            <input
              ref={amountRef}
              readOnly
              inputMode="none"
              aria-label="المبلغ"
              value={display}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full cursor-pointer bg-transparent text-center text-[2.25rem] font-black leading-tight text-ink-900 outline-none tnum dark:text-white"
            />

            <p className="text-[0.75rem] font-bold text-ink-500">{cur.name}</p>

            {raw !== '' ? (
              <button
                type="button"
                onClick={() => press('clear')}
                className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-bold text-ink-500 underline"
              >
                <X size={12} /> تفريغ المبلغ
              </button>
            ) : null}
          </div>

          {/* إضافات سريعة */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
            {QUICK_ADD_UNITS.map((units) => (
              <button
                key={units}
                type="button"
                onClick={() => addAmount(units * SCALE)}
                className="shrink-0 rounded-xl bg-ink-200/70 px-3 py-1.5 text-[0.8125rem] font-bold text-ink-700 transition active:scale-95 dark:bg-ink-800 dark:text-ink-200"
              >
                +<Money minor={units * SCALE} currency={currency} showSymbol={false} />
              </button>
            ))}
          </div>

          {/* لوحة الأرقام */}
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="لوحة الأرقام">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
              <KeyButton key={k} onClick={() => press(k)} label={k} />
            ))}
            {cur.decimals > 0 ? (
              <KeyButton onClick={() => press('.')} label="." hint="فاصلة عشرية" />
            ) : (
              <KeyButton onClick={() => press('00')} label="00" />
            )}
            <KeyButton onClick={() => press('0')} label="0" />
            <KeyButton onClick={() => press('back')} label="⌫" hint="حذف" destructive />
          </div>

          {overPayment ? (
            <p className="rounded-2xl bg-danger-50 p-2.5 text-center text-[0.75rem] font-bold text-danger-600 dark:bg-danger-500/10" role="alert">
              المبلغ أكبر من المتبقي (<Money minor={remaining} currency={currency} />)
            </p>
          ) : null}
        </div>

        {/* ---------- تفاصيل اختيارية ---------- */}
        {showMore ? (
          <div className="space-y-3">
            <Field label="التفاصيل" hint="مثال: مواد غذائية">
              <Input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={160} />
            </Field>
            <Field label="ملاحظة" hint="اختياري">
              <textarea
                className="field min-h-20 resize-none"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </Field>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="w-full rounded-2xl bg-ink-200/50 py-2.5 text-[0.8125rem] font-bold text-ink-600 dark:bg-ink-900 dark:text-ink-300"
          >
            + تفاصيل وملاحظة (اختياري)
          </button>
        )}

        <p className="rounded-2xl bg-ink-200/50 p-3 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
          {isLinked
            ? 'حساب موثّق: تُسجَّل العملية مباشرة لكنها لا تُحتسب في الرصيد حتى يؤكّدها الطرف الآخر.'
            : 'دفتر شخصي: تُسجَّل العملية وتُحتسب مباشرة. لا تحتاج موافقة أي طرف.'}
        </p>
      </div>
    </Sheet>
  )
}

function KeyButton({
  label,
  onClick,
  hint,
  destructive = false,
}: {
  label: string
  onClick: () => void
  hint?: string
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hint ?? label}
      className={clsx(
        'grid h-14 place-items-center rounded-2xl text-2xl font-extrabold transition active:scale-[0.96]',
        destructive
          ? 'bg-danger-100 text-danger-600 dark:bg-danger-500/20 dark:text-danger-100'
          : 'bg-white text-ink-800 shadow-sm dark:bg-ink-900 dark:text-ink-100',
      )}
    >
      {label === '⌫' ? <Delete size={22} /> : <span className="tnum">{label}</span>}
    </button>
  )
}
