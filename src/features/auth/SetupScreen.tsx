import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Store, User } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { DesignCredit } from '@/components/DesignCredit'
import { useAuth, useSession } from '@/app/hooks/useAuth'
import { CURRENCIES, DEFAULT_CURRENCY } from '@/core/money'
import { toUserMessage } from '@/core/errors'
import { normalizePhoneNumber, signUpDeviceSchema, validate } from '@/core/validation'
import type { Role } from '@/core/domain'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { consumePendingRoute } from '@/app/pendingRoute'
import { disableCloudMode } from '@/core/cloudMode'

/**
 * إنشاء الحساب — الاسم + رقم الهاتف + كلمة المرور وتأكيدها.
 * النوع (عميل/تاجر) يأتي من شاشة البداية — لا تُعاد أزرار النوع هنا.
 *
 * **لا يُطلب بريد إلكتروني إطلاقًا.** الحساب يُنشأ على هذا الجهاز ويعمل
 * بلا إنترنت، ومن أراد المزامنة يضيف بريده لاحقًا من الإعدادات.
 *
 * وفي الوضع السحابي مع جلسة قائمة (أول دخول بعد تأكيد البريد) تستعمل
 * الشاشة نفسها لإكمال الملف الشخصي على الحساب السحابي.
 */
export function SetupScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const kind = useDataSourceKind()
  const session = useSession()
  const auth = useAuth()

  const role = ((params.get('role') as Role | null) ?? 'customer') as Role
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const cloudProfileOnly = kind !== 'local' && Boolean(session.data)

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

      // إكمال ملف شخصي على حساب سحابي قائم (بعد تأكيد البريد)
      if (cloudProfileOnly) {
        await auth.createProfile({ fullName: data.fullName, role, currency, phone: normalized })
        toast.show('تم إنشاء الدفتر بنجاح')
        navigate(consumePendingRoute(), { replace: true })
        return
      }

      // حساب الجهاز: المحرّك الحالي محلي، أو سحابي بلا جلسة ⇒ نُنشئ محليًا ونعود للوضع المحلي
      if (kind === 'local') {
        await auth.signUpOnDevice({ fullName: data.fullName, phone: normalized, password: data.password, role })
        await auth.updateProfile({ currency })
      } else {
        const { LocalDataSource } = await import('@/data/local/adapter')
        const local = new LocalDataSource()
        await local.auth.signUpDevice!({
          fullName: data.fullName,
          phone: normalized,
          password: data.password,
          role,
        })
        await local.auth.updateProfile({ currency })
        disableCloudMode()
        window.location.hash = '#/'
        window.location.reload()
        return
      }

      toast.show('تم إنشاء الحساب — دفترك جاهز')
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
      <div className="py-6 text-center">
        <h1 className="text-xl font-extrabold">
          {cloudProfileOnly ? 'أكمل بياناتك' : 'إنشاء حساب جديد'}
        </h1>
        <p className="mt-1 flex items-center justify-center gap-2 text-[0.8125rem] text-ink-500">
          {role === 'merchant' ? <Store size={15} /> : <User size={15} />}
          الحساب: {role === 'merchant' ? 'تاجر' : 'عميل'}
        </p>
      </div>

      <div className="space-y-4">
        {kind !== 'local' && !cloudProfileOnly ? (
          <div className="rounded-2xl bg-gold-100 p-3.5 text-[0.75rem] leading-5 text-gold-800 dark:bg-gold-900/30 dark:text-gold-200">
            التطبيق الآن في الوضع السحابي بلا حساب مسجّل. سيُنشأ دفترك على هذا الجهاز (بلا بريد إلكتروني)، ويمكنك
            إضافة بريدك لاحقًا من الإعدادات لمزامنته.
          </div>
        ) : null}

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
          {cloudProfileOnly
            ? 'أكمل اسمك وعملتك ليبدأ دفترك على حسابك السحابي.'
            : 'يُحفظ حسابك ودفترك على هذا الجهاز، ولا تحتاج بريدًا إلكترونيًا ولا إنترنت. وتستطيع الدخول لاحقًا بنفس الرقم وكلمة المرور، وإضافة بريدك من الإعدادات متى أردت المزامنة بين أجهزتك.'}
        </p>
      </div>

      <div className="mt-auto space-y-2 pb-8 pt-6">
        <Button block size="lg" loading={busy} onClick={submit}>
          {cloudProfileOnly ? 'حفظ ومتابعة' : 'ابدأ الآن'}
        </Button>
        <Link
          to="/forgot"
          className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline"
        >
          هل نسيت كلمة المرور؟
        </Link>
        <Button variant="ghost" block disabled={busy} onClick={() => navigate('/welcome')}>
          رجوع
        </Button>
      </div>

      <DesignCredit className="pb-6" />
    </div>
  )
}
