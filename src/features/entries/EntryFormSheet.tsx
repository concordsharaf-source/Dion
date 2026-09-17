import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronLeft, Delete, Search } from 'lucide-react'
import clsx from 'clsx'
import { Button, Field, Input, Money, Sheet, Skeletons, useToast } from '@/components/ui'
import { useCreateEntry, useFilteredParties } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { sanitizeMultiline, sanitizeText } from '@/core/validation'
import { displayPhone } from '@/core/validation'
import { getCurrency, readAmount, SCALE } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import { uuid } from '@/core/id'
import type { EntryType, Party } from '@/core/domain'

/**
 * نافذة تسجيل عملية مالية — **نافذة مستقلة لكل نوع**:
 *   · زر «دين»   يفتح نافذة الدين وحدها
 *   · زر «سداد» يفتح نافذة السداد وحدها
 *
 * خطوات التسجيل (بلا خطوات زائدة):
 *   1) قائمة الأطراف تظهر أولًا (عملاء التاجر / محلات العميل) — إن كان هناك أكثر من طرف.
 *   2) بعد الاختيار تُفتح خانة المبلغ + التفاصيل ولوحة الأرقام، والمؤشر على المبلغ.
 *
 * استثناء مقصود: إن كان هناك **طرف واحد فقط** (محل واحد عند العميل، أو عميل واحد
 * عند التاجر) أو كان الطرف محدَّدًا مسبقًا (فتح النافذة من صفحة الطرف) ⇒ ندخل
 * إلى المبلغ مباشرة بلا قائمة.
 *
 * بلا عنوان في رأس النافذة وبلا شرح في الأسفل — لتوفير مساحة الشاشة للوحة الأرقام.
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
  /** loading: ننتظر الأطراف · pick: قائمة الأطراف · amount: المبلغ */
  const [mode, setMode] = useState<'loading' | 'pick' | 'amount'>(defaultPartyId ? 'amount' : 'loading')
  /** هل حُسمت الخطوة الأولى (لمنع إعادة الحسم مع كل تحديث للبيانات)؟ */
  const decidedRef = useRef(false)
  const [search, setSearch] = useState('')
  const [raw, setRaw] = useState('')
  const [details, setDetails] = useState('')
  const [note, setNote] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [error, setError] = useState('')

  const amountRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  /* ----- إعادة الضبط + التركيز على المبلغ عند كل فتح ----- */
  useEffect(() => {
    if (!open) return
    decidedRef.current = Boolean(defaultPartyId)
    setPartyId(defaultPartyId ?? '')
    setMode(defaultPartyId ? 'amount' : 'loading')
    setSearch('')
    setRaw('')
    setDetails('')
    setNote('')
    setShowMore(false)
    setError('')
    // نُبقي بداية النافذة أعلى الشاشة حتى تكون خانة المبلغ ولوحة الأرقام ظاهرتين
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    const timer = window.setTimeout(() => amountRef.current?.focus(), 240)
    return () => window.clearTimeout(timer)
  }, [open, defaultPartyId, type])

  /* ----- حسم الخطوة الأولى: قائمة الأطراف أم المبلغ مباشرة ----- */
  useEffect(() => {
    if (!open || decidedRef.current) return
    if (partiesQuery.isLoading) return
    const list = partiesQuery.all
    decidedRef.current = true
    // طرف واحد فقط ⇒ لا داعي لقائمة (كحالة العميل مع محل واحد)
    if (list.length === 1) {
      setPartyId(list[0]!.party.id)
      setMode('amount')
      return
    }
    setMode('pick')
  }, [open, partiesQuery.isLoading, partiesQuery.all])

  // بعد حسم الطرف الواحد: التركيز على المبلغ
  useEffect(() => {
    if (open && mode === 'amount' && partyId) {
      const timer = window.setTimeout(() => amountRef.current?.focus(), 200)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [open, mode, partyId])

  const all = partiesQuery.all
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = all.map((s) => s.party)
    if (!q) return list.slice(0, 80)
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)).slice(0, 80)
  }, [all, search])

  const selected: Party | null = useMemo(() => all.find((s) => s.party.id === partyId)?.party ?? null, [all, partyId])
  const summary = useMemo(() => all.find((s) => s.party.id === partyId) ?? null, [all, partyId])

  const isLinked = selected?.linkStatus === 'verified'
  const isCustomer = profile.data?.role === 'customer'
  const partyLabel = isCustomer ? 'المحل' : 'العميل'

  /* ----- المبلغ ----- */
  const parsed = raw === '' ? null : readAmount(raw)
  const minor = parsed && parsed.ok ? parsed.minor : 0
  const display = minor > 0 ? new Intl.NumberFormat('en-US', { maximumFractionDigits: cur.decimals }).format(minor / 100) : '0'

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
        if (prev.includes('.') && prev.split('.')[1]!.length >= cur.decimals) return prev
        if (prev.replace(/[^\d]/g, '').length >= 12) return prev
        if (prev === '0') return key === '0' || key === '00' ? prev : key
        return prev + key
      })
    },
    [cur.decimals],
  )

  const addAmount = useCallback((increment: number) => {
    setError('')
    setRaw((prev) => {
      const base = readAmount(prev)
      const current = base.ok ? base.minor : 0
      const next = current + increment
      if (next <= 0) return ''
      return String(next / 100)
    })
  }, [])

  /* ----- لوحة المفاتيح على سطح المكتب ----- */
  useEffect(() => {
    if (!open || mode !== 'amount') return
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
  }, [open, mode, press])

  async function submit() {
    setError('')
    if (!partyId) {
      setError(`اختر ${partyLabel} أولًا`)
      setMode('pick')
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
  const sheetFooter = (
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
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="tall"
      compact
      footer={mode === 'amount' ? sheetFooter : undefined}
      contentRef={scrollRef}
    >
      {mode === 'loading' ? (
        <div className="space-y-3 pb-2 pt-2">
          <p className="text-center text-[0.8125rem] font-bold text-ink-500">
            {isCustomer ? 'جارٍ تحضير محلاتك…' : 'جارٍ تحضير عملائك…'}
          </p>
          <Skeletons count={4} height={56} />
        </div>
      ) : mode === 'pick' ? (
        /* ---------- اختيار الطرف (يُفتح عند الطلب فقط) ---------- */
        <div className="space-y-3 pb-2">
          <div className="flex items-center justify-between">
            <p className="font-extrabold">{`اختر ${partyLabel}`}</p>
            {partyId ? (
              <button
                type="button"
                onClick={() => setMode('amount')}
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1 text-[0.8125rem] font-bold text-brand-600"
              >
                <ChevronLeft size={16} className="rotate-180" /> رجوع إلى المبلغ
              </button>
            ) : null}
          </div>

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

          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] leading-6 text-ink-500">
                لا يوجد {partyLabel} بعد.
                <br />
                أضفه من قسم {isCustomer ? 'المحلات' : 'العملاء'} ثم عُد إلى هنا.
              </p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPartyId(p.id)
                    setMode('amount')
                    setError('')
                    window.setTimeout(() => amountRef.current?.focus(), 60)
                  }}
                  aria-pressed={p.id === partyId}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-3 py-3 text-start transition active:scale-[0.99]',
                    p.id === partyId
                      ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30'
                      : 'border-transparent bg-white dark:bg-ink-900',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{p.name}</span>
                    <span className="block text-[0.6875rem] text-ink-500">
                      {p.phone ? <span dir="ltr">{displayPhone(p.phone)}</span> : 'بلا رقم'}
                    </span>
                  </span>
                  {p.linkStatus === 'verified' ? (
                    <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">موثّق</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        /* ---------- المبلغ + لوحة الأرقام: الواجهة الأولى دائمًا ---------- */
        <div className="space-y-3 pb-2">
          <button
            type="button"
            onClick={() => setMode('pick')}
            aria-label={selected ? `الطرف: ${selected.name}` : `اختر ${partyLabel}`}
            className={clsx(
              'flex w-full items-center justify-between gap-2 rounded-2xl border-2 p-2.5 text-start transition active:scale-[0.99]',
              selected
                ? 'border-transparent bg-white dark:bg-ink-900'
                : 'border-dashed border-danger-300 bg-danger-50/60 dark:border-danger-500/40 dark:bg-danger-500/10',
            )}
          >
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
                <span className="block truncate text-[0.9375rem] font-extrabold">
                  {selected?.name ?? `اختر ${partyLabel}`}
                </span>
                <span className="block truncate text-[0.6875rem] text-ink-500">
                  {selected
                    ? isLinked
                      ? 'بتأكيد الطرف الآخر'
                      : isDebt
                        ? 'دين لصالحه — يُحتسب مباشرة'
                        : 'سداد له — يُحتسب مباشرة'
                    : 'اضغط للاختيار'}
                </span>
              </span>
            </span>
            <span className="shrink-0 rounded-xl px-2 py-1 text-[0.75rem] font-bold text-brand-600">
              {selected ? 'تغيير' : 'اختيار'}
            </span>
          </button>

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

          </div>

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
            <p
              className="rounded-2xl bg-danger-50 p-2.5 text-center text-[0.75rem] font-bold text-danger-600 dark:bg-danger-500/10"
              role="alert"
            >
              المبلغ أكبر من المتبقي (<Money minor={remaining} currency={currency} />)
            </p>
          ) : null}

          {!partyId ? (
            <p className="text-center text-[0.75rem] font-bold text-ink-500">
              {`لم تختر ${partyLabel} بعد — اضغط الصف الأعلى للاختيار`}
            </p>
          ) : null}

          {showMore ? (
            <div className="space-y-3 pt-1">
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

          {isLinked ? (
            <p className="rounded-2xl bg-brand-50 p-3 text-[0.75rem] leading-5 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200">
              حساب موثّق: تُسجَّل العملية مباشرة، لكنها لا تُحتسب في الرصيد حتى يؤكّدها الطرف الآخر.
            </p>
          ) : null}
        </div>
      )}
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
