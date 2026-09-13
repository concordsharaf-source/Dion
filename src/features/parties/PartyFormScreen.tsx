import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button, Card, Field, Input } from '@/components/ui'
import { useArchiveParty, useCreateParty, useParty, useUpdateParty } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { partySchema, validate, checkAmountInput } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { ConfirmDialog } from '@/components/ui'

/** إضافة / تعديل طرف (محل أو عميل) */
export function PartyFormScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const profile = useProfile()
  const isMerchant = profile.data?.role === 'merchant'
  const label = isMerchant ? 'عميل' : 'محل'

  const existing = useParty(id)
  const createParty = useCreateParty()
  const updateParty = useUpdateParty()
  const archiveParty = useArchiveParty()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [opening, setOpening] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name)
      setPhone(existing.data.phone ?? '')
      setAddress(existing.data.address ?? '')
      setNote(existing.data.note ?? '')
    }
  }, [existing.data])

  const isEdit = Boolean(id)
  const busy = createParty.isPending || updateParty.isPending

  async function submit() {
    const parsed = validate(partySchema, {
      name,
      phone: phone || null,
      address: address || null,
      note: note || null,
      openingAmount: opening || 0,
    })
    if (!parsed.success) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    try {
      if (isEdit && id) {
        await updateParty.mutateAsync({
          id,
          patch: { name: parsed.data!.name, phone: parsed.data!.phone, address: parsed.data!.address, note: parsed.data!.note },
        })
        navigate(-1)
      } else {
        const created = await createParty.mutateAsync({
          kind: isMerchant ? 'customer' : 'shop',
          name: parsed.data!.name,
          phone: parsed.data!.phone,
          address: parsed.data!.address,
          note: parsed.data!.note,
          openingAmountMinor: parsed.data!.openingAmount,
        })
        // الانتقال إلى صفحة الطرف الجديد ليسجّل العملية مباشرة
        navigate(`/parties/${created.id}`, { replace: true })
      }
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    }
  }

  const openingCheck = opening ? checkAmountInput(opening) : null

  return (
    <div>
      <PageHeader title={isEdit ? `تعديل ${label}` : `إضافة ${label}`} />

      <div className="space-y-4 px-4 pt-4">
        <Card className="space-y-4">
          <Field label="الاسم" required error={errors.name} htmlFor="pname">
            <Input
              id="pname"
              autoFocus={!isEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isMerchant ? 'أحمد محمد' : 'بقالة النور'}
              maxLength={80}
            />
          </Field>

          <Field label="رقم الهاتف" error={errors.phone} hint="اختياري — يسهّل البحث" htmlFor="pphone">
            <Input
              id="pphone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              dir="ltr"
              placeholder="77 123 4567"
            />
          </Field>

          <Field label="العنوان" hint="اختياري" htmlFor="paddress">
            <Input id="paddress" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={160} />
          </Field>

          <Field label="ملاحظات" hint="اختياري" htmlFor="pnote">
            <textarea
              id="pnote"
              className="field min-h-20 resize-none"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </Field>

          {!isEdit ? (
            <Field
              label="رصيد افتتاحي"
              hint={
                openingCheck && !openingCheck.ok
                  ? openingCheck.message
                  : isMerchant
                    ? 'اختياري — مبلغ سابق على العميل قبل استخدام التطبيق'
                    : 'اختياري — مبلغ سابق عليك لهذا المحل'
              }
              htmlFor="popen"
            >
              <Input
                id="popen"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                placeholder="0"
                className="tnum"
              />
            </Field>
          ) : null}

          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>

        {!isEdit ? (
          <p className="px-1 text-[0.75rem] leading-5 text-ink-500">
            {isMerchant
              ? 'لا يلزم أن يكون العميل مستخدمًا للتطبيق. الدفتر يعمل بالكامل من طرفك.'
              : 'لا يلزم أن يكون المحل مستخدمًا للتطبيق. الدفتر يعمل بالكامل من طرفك.'}
          </p>
        ) : null}

        {isEdit && existing.data?.linkStatus === 'verified' ? (
          <p className="rounded-2xl bg-brand-50 p-3 text-[0.75rem] leading-5 text-brand-800 dark:bg-brand-900/25 dark:text-brand-200">
            هذا {label} مرتبط بحساب موثّق: أي عملية جديدة بينكما تحتاج تأكيد الطرف الآخر.
          </p>
        ) : null}

        <Button block size="lg" loading={busy} onClick={submit}>
          {isEdit ? 'حفظ التعديلات' : `إضافة ${label}`}
        </Button>

        {isEdit ? (
          <Button block variant="ghost" className="text-danger-600" onClick={() => setConfirmArchive(true)}>
            {existing.data?.archivedAt ? `إلغاء أرشفة ${label}` : `أرشفة ${label}`}
          </Button>
        ) : null}

        {isEdit && existing.data ? (
          <div className="pb-6 text-center text-[0.6875rem] text-ink-400">
            أنشئ في {new Date(existing.data.createdAt).toLocaleDateString('ar-EG')}
          </div>
        ) : (
          <div className="pb-6" />
        )}
      </div>

      <ConfirmDialog
        open={confirmArchive}
        title={existing.data?.archivedAt ? 'إلغاء الأرشفة' : 'أرشفة'}
        message={
          existing.data?.archivedAt
            ? 'سيعود السجل للظهور في القائمة الأساسية.'
            : 'لن يُحذف أي سجل مالي. سيُخفى الطرف من القائمة الأساسية ويمكن استرجاعه في أي وقت.'
        }
        confirmLabel={existing.data?.archivedAt ? 'إلغاء الأرشفة' : 'أرشفة'}
        tone={existing.data?.archivedAt ? 'primary' : 'danger'}
        loading={archiveParty.isPending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          if (!id) return
          void archiveParty
            .mutateAsync({ id, archive: !existing.data?.archivedAt })
            .then(() => {
              setConfirmArchive(false)
              navigate(-1)
            })
            .catch((e) => setErrors({ _: toUserMessage(e) }))
        }}
      >
      </ConfirmDialog>
    </div>
  )
}
