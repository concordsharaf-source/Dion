import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import clsx from 'clsx'
import { Button, Field, Input, Sheet, useToast, Money } from '@/components/ui'
import { useCreateEntry, useParties } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { checkAmountInput, sanitizeText, sanitizeMultiline } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { uuid } from '@/core/id'
import type { EntryType, Party } from '@/core/domain'

const QUICK = [1_000, 5_000, 10_000, 25_000, 50_000]

export function EntryFormSheet({
  open,
  onClose,
  defaultPartyId,
  defaultType = 'debt',
  onSaved,
}: {
  open: boolean
  onClose: () => void
  defaultPartyId?: string
  defaultType?: EntryType
  onSaved?: () => void
}) {
  const profile = useProfile()
  const partiesQuery = useParties({ includeArchived: false, limit: 300 })
  const createEntry = useCreateEntry()
  const toast = useToast()

  const [type, setType] = useState<EntryType>(defaultType)
  const [partyId, setPartyId] = useState(defaultPartyId ?? '')
  const [amount, setAmount] = useState('')
  const [details, setDetails] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setType(defaultType)
      setPartyId(defaultPartyId ?? '')
      setAmount('')
      setDetails('')
      setNote('')
      setSearch('')
      setError('')
    }
  }, [open, defaultPartyId, defaultType])

  const parties = partiesQuery.data?.items ?? []
  const selected = useMemo(() => parties.find((p) => p.id === partyId) ?? null, [parties, partyId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return parties.slice(0, 60)
    return parties.filter((p) => p.name.toLowerCase().includes(q) || (p.phone ?? '').includes(q)).slice(0, 60)
  }, [parties, search])

  const isLinked = selected?.linkStatus === 'verified'
  const isCustomer = profile.data?.role === 'customer'
  const partyLabel = isCustomer ? 'المحل' : 'العميل'

  async function submit() {
    setError('')
    if (!partyId) {
      setError(`اختر ${partyLabel}`)
      return
    }
    const amountCheck = checkAmountInput(amount)
    if (!amountCheck.ok) {
      setError(amountCheck.message)
      return
    }

    try {
      await createEntry.mutateAsync({
        partyId,
        entryType: type,
        amountMinor: amountCheck.minor,
        currency: profile.data?.currency ?? 'YER',
        details: sanitizeText(details, 160) || null,
        note: sanitizeMultiline(note, 500) || null,
        clientRef: uuid(),
      })
      toast.show(isLinked ? 'تم التسجيل — بانتظار تأكيد الطرف الآخر' : 'تم التسجيل في دفترك')
      onSaved?.()
      onClose()
    } catch (e) {
      setError(toUserMessage(e))
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={type === 'debt' ? 'تسجيل دين' : 'تسجيل سداد'}
      size="tall"
      footer={
        <div className="space-y-2">
          {error ? (
            <p className="text-center text-[0.8125rem] font-bold text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button block size="lg" loading={createEntry.isPending} onClick={submit}>
            {type === 'debt' ? 'تسجيل الدين' : 'تسجيل السداد'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        {/* نوع العملية */}
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-ink-200/60 p-1 dark:bg-ink-900" role="radiogroup">
          {(
            [
              { value: 'debt', label: 'دين', tone: 'text-danger-600' },
              { value: 'payment', label: 'سداد', tone: 'text-brand-700' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={type === opt.value}
              onClick={() => setType(opt.value)}
              className={clsx(
                'rounded-xl py-2.5 text-sm font-extrabold transition',
                type === opt.value ? clsx('bg-white shadow-sm dark:bg-ink-800', opt.tone) : 'text-ink-500',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* الطرف */}
        {defaultPartyId && selected ? (
          <div className="card flex items-center justify-between p-3">
            <span className="text-[0.75rem] text-ink-500">{partyLabel}</span>
            <span className="font-extrabold">{selected.name}</span>
          </div>
        ) : (
          <Field label={partyLabel} required>
            <div className="space-y-2">
              {parties.length > 6 ? (
                <div className="relative">
                  <Search size={18} className="absolute end-3 top-1/2 -translate-y-1/2 text-ink-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`ابحث عن ${partyLabel}...`}
                    className="pe-10"
                  />
                </div>
              ) : null}
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="py-3 text-center text-[0.8125rem] text-ink-500">
                    لا يوجد {partyLabel} بهذا الاسم. أضفه أولًا من قسم {isCustomer ? 'المحلات' : 'العملاء'}.
                  </p>
                ) : (
                  filtered.map((p) => (
                    <PartyOption key={p.id} party={p} selected={p.id === partyId} onSelect={() => setPartyId(p.id)} />
                  ))
                )}
              </div>
            </div>
          </Field>
        )}

        {/* المبلغ */}
        <Field label="المبلغ" required>
          <div className="relative">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              placeholder="0"
              className="field h-16 text-center text-3xl font-black tnum"
              aria-label="المبلغ"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                className="rounded-xl bg-ink-200/70 px-3 py-1.5 text-[0.8125rem] font-bold text-ink-700 transition active:scale-95 dark:bg-ink-800 dark:text-ink-200"
              >
                <Money minor={v * 100} currency={profile.data?.currency} showSymbol={false} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="التفاصيل" hint="اختياري — مثال: مواد غذائية">
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

        <p className="rounded-2xl bg-ink-200/50 p-3 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
          {isLinked
            ? 'حساب موثّق: تُسجَّل العملية مباشرة لكنها لا تُحتسب في الرصيد حتى يؤكّدها الطرف الآخر.'
            : 'دفتر شخصي: تُسجَّل العملية وتُحتسب مباشرة. لا تحتاج موافقة أي طرف.'}
        </p>
      </div>
    </Sheet>
  )
}

function PartyOption({ party, selected, onSelect }: { party: Party; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-3 py-2.5 text-start transition',
        selected
          ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30'
          : 'border-transparent bg-white dark:bg-ink-900',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{party.name}</span>
        {party.phone ? (
          <span className="block text-[0.6875rem] text-ink-500" dir="ltr">
            {party.phone}
          </span>
        ) : null}
      </span>
      {party.linkStatus === 'verified' ? <span className="chip bg-brand-100 text-brand-800">موثّق</span> : null}
    </button>
  )
}
