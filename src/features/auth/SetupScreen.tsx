import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Store, User } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useAuth } from '@/app/hooks/useAuth'
import { CURRENCIES, DEFAULT_CURRENCY } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import { normalizePhoneNumber, signUpDeviceSchema, validate } from '@/core/validation'
import type { Role } from '@/core/domain'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { consumePendingRoute } from '@/app/pendingRoute'

/**
 * إنشاء حساب على هذا الجهاز: الاسم + رقم الهاتف + كلمة المرور وتأكيدها.
 * النوع (عميل/تاجر) يأتي من شاشة البداية — لا تُعاد أزرار النوع هنا.
 * تُحفظ بيانات الدخول وبيانات المستخدم، فيعود إليها بعد تسجيل الخروج.
 */
export function SetupScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const kind = useDataSourceKind()
  const auth = useAuth()

  const role = ((params.get('role') as Role | null) ?? 'customer') as Role
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function submit() {
    const result = validate(signUpDeviceSchema, {
      fullName: name,
      phone,
      password,
      confirmPassword: confirm,
    })
    if (!result.success) {
      setErrors(result.errors)
      return
    }
    const data = result.data!
    setErrors({})
    setBusy(true)
    try {
      const normalized = normalizePhoneNumber(data.phone) ?? data.phone
      if (kind === 'local') {
        await auth.signUpOnDevice({ fullName: data.fullName, phone: normalized, password: data.password, role })
        await auth.updateProfile({ currency })
        toast.show('تم إنشاء الحساب — دفترك جاهز')
      } else {
        await auth.createProfile({ fullName: data.fullName, role, currency, phone: normalized })
        toast.show('تم إنشاء الدفتر بنجاح')
      }
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
      <div className="py-6 text-center">
        <h1 className="text-xl font-extrabold">إنشاء حساب جديد</h1>
        <p className="mt-1 flex items-center justify-center gap-2 text-[0.8125rem] text-ink-500">
          {role === 'merchant' ? <Store size={15} /> : <User size={15} />}
          الحساب: {role === 'merchant' ? 'تاجر' : 'عميل'}
        </p>
      </div>

      <div className="space-y-4">
        <Card className="space-y-4">
          <Field label="الاسم" required error={errors.fullName} htmlFor="fullname">
            <Input
              id="fullname"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === 'merchant' ? 'مثال: متجر النور' : 'مثال: أحمد محمد'}
              maxLength={60}
              autoComplete="name"
            />
          </Field>

          <Field
            label="رقم الهاتف"
            required
            error={errors.phone}
            hint="يُستخدم لتسجيل الدخول واستعادة كلمة المرور"
            htmlFor="phone"
          >
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="777 123 456"
              autoComplete="tel"
            />
          </Field>

          <Field
            label="كلمة المرور"
            required
            error={errors.password}
            hint="4 خانات على الأقل — أرقام أو حروف كما تريد"
            htmlFor="password"
          >
            <Input
              id="password"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Field label="تأكيد كلمة المرور" required error={errors.confirmPassword} htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              dir="ltr"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Field label="العملة" hint="يمكن تغييرها لاحقًا من الإعدادات">
            <select className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </Field>

          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>

        <p className="px-1 text-[0.75rem] leading-5 text-ink-500">
          {kind === 'local'
            ? 'يُحفظ حسابك ودفترك على هذا الجهاز. لا تحتاج بريدًا إلكترونيًا ولا إنترنت، وتستطيع الدخول مرة أخرى بنفس الرقم وكلمة المرور.'
            : 'سيُنشأ ملفك الشخصي في حسابك السحابي وتبدأ التسجيل فورًا.'}
        </p>
      </div>

      <div className="mt-auto space-y-2 pb-8 pt-6">
        <Button block size="lg" loading={busy} onClick={submit}>
          ابدأ الآن
        </Button>
        <Link
          to="/forgot"
          className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline"
        >
          هل نسيت كلمة المرور؟
        </Link>
        <Button variant="ghost" block onClick={() => navigate('/welcome')} disabled={busy}>
          رجوع
        </Button>
      </div>
    </div>
  )
}
