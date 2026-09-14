import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck, Store, User } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { DesignCredit } from '@/components/DesignCredit'
import { useAuth } from '@/app/hooks/useAuth'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import type { DeviceAccount } from '@/data/port'
import {
  deviceSignInSchema,
  displayPhone,
  normalizePhoneNumber,
  signInSchema,
  signUpCloudSchema,
  validate,
} from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { consumePendingRoute } from '@/app/pendingRoute'
import type { Role } from '@/core/domain'

/** رابط «هل نسيت كلمة المرور؟» */
function ForgotLink() {
  return (
    <Link to="/forgot" className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline">
      هل نسيت كلمة المرور؟
    </Link>
  )
}

/**
 * تسجيل الدخول.
 * وضع الجهاز: رقم الهاتف وكلمة المرور (بيانات محفوظة على الجهاز).
 * الوضع السحابي: البريد الإلكتروني وكلمة المرور.
 */
export function SignInScreen() {
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const ds = useDataSource()
  const kind = useDataSourceKind()

  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<DeviceAccount[]>([])

  // في وضع الجهاز: الحسابات المحفوظة (أرقامها واسمها) للدخول السريع
  useEffect(() => {
    if (kind !== 'local') return
    let alive = true
    void ds.auth
      .listDeviceAccounts?.()
      .then((list) => {
        if (alive) setAccounts(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [ds, kind])

  async function enterDevice(accountId: string) {
    setBusy(true)
    try {
      await auth.signInDevice(accountId)
      toast.show('تم الدخول إلى دفترك')
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (kind === 'local') {
      const result = validate(deviceSignInSchema, { identifier, password })
      if (!result.success) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      setBusy(true)
      try {
        await auth.signInWithPasswordDevice(result.data!.identifier, result.data!.password)
        toast.show('تم تسجيل الدخول')
        navigate(consumePendingRoute(), { replace: true })
      } catch (e) {
        setErrors({ _: toUserMessage(e) })
      } finally {
        setBusy(false)
      }
      return
    }

    const result = validate(signInSchema, { email, password })
    if (!result.success) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await auth.signIn(result.data!.email, result.data!.password)
      toast.show('تم تسجيل الدخول')
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
      <div className="py-8 text-center">
        <h1 className="text-xl font-extrabold">تسجيل الدخول</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">
          {kind === 'local' ? 'أدخل رقم هاتفك وكلمة المرور' : 'أدخل بيانات حسابك للمتابعة'}
        </p>
      </div>

      <Card className="space-y-4">
        {kind === 'local' ? (
          <Field label="رقم الهاتف" required error={errors.identifier} htmlFor="identifier">
            <Input
              id="identifier"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="777 123 456"
            />
          </Field>
        ) : (
          <Field label="البريد الإلكتروني" required error={errors.email} htmlFor="email">
            <Input
              id="email"
              type="email"
              inputMode="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </Field>
        )}

        <Field
          label="كلمة المرور"
          required
          error={errors.password}
          htmlFor="password"
        >
          <Input
            id="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
      </Card>

      <div className="mt-5 space-y-3">
        <Button block size="lg" loading={busy} onClick={submit}>
          دخول
        </Button>
        <ForgotLink />
        <p className="text-center text-[0.8125rem] text-ink-500">
          ليس لديك حساب؟{' '}
          <Link to="/welcome" className="font-bold text-brand-600 underline">
            ابدأ من هنا
          </Link>
        </p>
      </div>

      {kind === 'local' && accounts.length > 0 ? (
        <Card className="mt-6 space-y-3">
          <p className="text-[0.8125rem] font-bold">الحسابات على هذا الجهاز</p>
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              disabled={busy}
              onClick={() => void enterDevice(account.id)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-ink-100 px-3 py-3 text-start transition active:scale-[0.99] disabled:opacity-60 dark:bg-ink-900"
            >
              <span className="min-w-0">
                <span className="block truncate font-bold">{account.fullName || 'بدون اسم'}</span>
                <span className="block text-[0.6875rem] text-ink-500" dir="auto">
                  {account.role === 'merchant' ? 'حساب تاجر' : 'حساب عميل'}
                  {account.phone ? ` · ${displayPhone(account.phone)}` : ''}
                </span>
              </span>
              <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                دخول سريع
              </span>
            </button>
          ))}
          <p className="text-[0.6875rem] leading-5 text-ink-500">
            الدخول السريع لهذه الحسابات بلا كتابة كلمة المرور لأنها محفوظة على هذا الجهاز وحده.
          </p>
        </Card>
      ) : null}

      <DesignCredit className="mt-auto py-6" />
    </div>
  )
}

/** إنشاء حساب (الوضع السحابي): الاسم + البريد + الهاتف + كلمة المرور وتأكيدها */
export function SignUpScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const ds = useDataSource()

  const role = ((params.get('role') as Role | null) ?? 'customer') as Role
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [awaiting, setAwaiting] = useState<string | null>(null)

  async function resend() {
    if (!awaiting || !ds.auth.resendConfirmation) return
    setBusy(true)
    try {
      await ds.auth.resendConfirmation(awaiting)
      setErrors({})
      toast.show('أرسلنا رابط التأكيد مرة أخرى', 'info')
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    const result = validate(signUpCloudSchema, {
      fullName: name,
      email,
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
      const created = await auth.signUp({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
        role,
        phone: normalized,
      })
      if (created.needsEmailConfirmation) {
        setAwaiting(data.email)
        toast.show('أرسلنا رابط تأكيد إلى بريدك الإلكتروني', 'info')
        return
      }
      await auth.createProfile({ fullName: data.fullName, role, currency: 'YER', phone: normalized })
      toast.show('تم إنشاء الحساب')
      navigate(consumePendingRoute(), { replace: true })
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  if (awaiting) {
    return (
      <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
        <div className="py-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            <MailCheck size={26} />
          </span>
          <h1 className="mt-3 text-xl font-extrabold">تحقّق من بريدك</h1>
          <p className="mt-1 flex items-center justify-center gap-2 text-[0.8125rem] text-ink-500">
            {role === 'merchant' ? <Store size={15} /> : <User size={15} />}
            الحساب: {role === 'merchant' ? 'تاجر' : 'عميل'}
          </p>
        </div>

        <Card className="space-y-3 text-center">
          <p className="text-[0.8125rem] leading-6 text-ink-600 dark:text-ink-300">
            أرسلنا رابط تأكيد إلى <span className="font-bold" dir="ltr">{awaiting}</span>. افتح الرابط من هذا
            الجهاز لتأكيد حسابك والدخول مباشرة.
          </p>
          <p className="text-[0.75rem] leading-6 text-ink-500">
            لم تجد الرسالة؟ تحقّق من مجلد «الرسائل غير المرغوبة»، أو أعد الإرسال.
          </p>
          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>

        <div className="mt-5 space-y-2">
          <Button block size="lg" loading={busy} onClick={() => void resend()}>
            إعادة إرسال رابط التأكيد
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => setAwaiting(null)}>
            تغيير البريد الإلكتروني
          </Button>
          <Link to="/signin" className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline">
            لديّ حساب — تسجيل الدخول
          </Link>
        </div>

        <DesignCredit className="mt-auto py-6" />
      </div>
    )
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

      <Card className="space-y-4">
        <Field label="الاسم" required error={errors.fullName} htmlFor="name">
          <Input
            id="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === 'merchant' ? 'متجر النور' : 'أحمد محمد'}
            autoComplete="name"
          />
        </Field>
        <Field label="البريد الإلكتروني" required error={errors.email} htmlFor="email2">
          <Input
            id="email2"
            type="email"
            dir="ltr"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </Field>
        <Field label="رقم الهاتف" required error={errors.phone} hint="للتواصل واستعادة الحساب" htmlFor="phone2">
          <Input
            id="phone2"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="777 123 456"
          />
        </Field>
        <Field
          label="كلمة المرور"
          required
          error={errors.password}
          hint="4 خانات على الأقل — أرقام أو حروف كما تريد"
          htmlFor="pass2"
        >
          <Input
            id="pass2"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="تأكيد كلمة المرور" required error={errors.confirmPassword} htmlFor="confirm2">
          <Input
            id="confirm2"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
      </Card>

      <div className="mt-5 space-y-2 pb-8">
        <Button block size="lg" loading={busy} onClick={submit}>
          إنشاء الحساب
        </Button>
        <ForgotLink />
        <Button variant="ghost" block onClick={() => navigate('/welcome')} disabled={busy}>
          رجوع
        </Button>
      </div>
    </div>
  )
}
