import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useAuth, useIsLocalMode, useProfile, useSession } from '@/app/hooks/useAuth'
import { profileSchema, validate, sanitizeText } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { CURRENCIES } from '@/core/money'
import type { Role } from '@/core/domain'

/** الملف الشخصي: الاسم، الهاتف، ونوع الحساب */
export function ProfileScreen() {
  const profile = useProfile()
  const auth = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const local = useIsLocalMode()
  const session = useSession()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('customer')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [roleLocked, setRoleLocked] = useState(true)

  useEffect(() => {
    if (profile.data) {
      setName(profile.data.fullName)
      setPhone(profile.data.phone ?? '')
      setRole(profile.data.role)
    }
  }, [profile.data])

  async function save() {
    const parsed = validate(profileSchema, { fullName: name, role, currency: profile.data?.currency ?? 'YER' })
    if (!parsed.success) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await auth.updateProfile({
        fullName: sanitizeText(name, 60),
        phone: phone.trim() ? phone.trim() : null,
        role,
      })
      setRoleLocked(true)
      toast.show('تم حفظ التعديلات')
      navigate(-1)
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!profile.data) return <div className="skeleton m-4 h-40" />

  return (
    <div>
      <PageHeader title="الملف الشخصي" />

      <div className="space-y-4 px-4 pt-4">
        <Card className="space-y-4">
          <Field label="الاسم" required error={errors.fullName} htmlFor="pf-name">
            <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
          </Field>

          <Field label="رقم الهاتف" hint="اختياري — يظهر للطرف الآخر بعد الربط" htmlFor="pf-phone">
            <Input
              id="pf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              dir="ltr"
              placeholder="77 123 4567"
            />
          </Field>

          <Field label="نوع الحساب" hint={roleLocked ? 'اضغط «تغيير» لتعديل نوع الحساب' : 'يُحفظ مع ملفك الشخصي'}>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-2xl bg-ink-100 px-4 py-3 font-bold dark:bg-ink-900">
                {role === 'merchant' ? 'تاجر' : 'عميل'}
              </div>
              <Button variant="ghost" onClick={() => setRoleLocked((v) => !v)}>
                تغيير
              </Button>
            </div>
            {!roleLocked ? (
              <div className="mt-2 grid grid-cols-2 gap-3">
                {(['customer', 'merchant'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={
                      'rounded-2xl border-2 py-3 text-sm font-extrabold transition ' +
                      (role === r
                        ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200'
                        : 'border-ink-200 text-ink-600 dark:border-ink-800 dark:text-ink-300')
                    }
                  >
                    {r === 'merchant' ? 'أنا تاجر' : 'أنا عميل'}
                  </button>
                ))}
              </div>
            ) : null}
            {!roleLocked ? (
              <p className="mt-2 text-[0.6875rem] leading-5 text-gold-700 dark:text-gold-300">
                تغيير النوع يعيد ترتيب شاشات التطبيق (عملاء/محلات) لكنه لا يحذف أي سجل.
              </p>
            ) : null}
          </Field>

          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>

        <Card className="divide-y divide-ink-200/70 p-0 text-[0.8125rem] dark:divide-ink-800/70">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-ink-500">البريد الإلكتروني</span>
            <span className="font-semibold" dir="ltr">
              {session.data?.email ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-ink-500">العملة</span>
            <span className="font-semibold">
              {CURRENCIES[profile.data.currency]?.name ?? profile.data.currency}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-ink-500">نوع التخزين</span>
            <span className="font-semibold">{local ? 'على هذا الجهاز' : 'سحابي + محلي'}</span>
          </div>
        </Card>

        <Button block size="lg" loading={busy} onClick={() => void save()}>
          حفظ التعديلات
        </Button>
      </div>
    </div>
  )
}
