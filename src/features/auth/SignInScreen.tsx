import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useAuth, useProfile } from '@/app/hooks/useAuth'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import type { DeviceAccount } from '@/data/port'
import { validate, signInSchema, signUpSchema } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { consumePendingRoute } from '@/app/pendingRoute'
import type { Role } from '@/core/domain'

/** تسجيل الدخول (الوضع السحابي) */
export function SignInScreen() {
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const profile = useProfile()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const ds = useDataSource()
  const kind = useDataSourceKind()
  const [accounts, setAccounts] = useState<DeviceAccount[]>([])

  // في وضع الدفتر المحلي: نعرض الحسابات المحفوظة على الجهاز بدل بريد لا يعرفه المستخدم
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

  void profile

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pt-safe">
      <div className="py-8 text-center">
        <h1 className="text-xl font-extrabold">تسجيل الدخول</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">أدخل بيانات حسابك للمتابعة</p>
      </div>

      {kind === 'local' && accounts.length > 0 ? (
        <Card className="space-y-3">
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
                <span className="block text-[0.6875rem] text-ink-500">
                  {account.role === 'merchant' ? 'حساب تاجر' : 'حساب عميل'}
                </span>
              </span>
              <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">دخول</span>
            </button>
          ))}
          <p className="text-[0.6875rem] leading-5 text-ink-500">
            الدخول لهذه الحسابات بلا كلمة مرور لأنها محفوظة على هذا الجهاز وحده.
          </p>
        </Card>
      ) : null}

      {kind === 'local' ? null : (
        <Card className="space-y-4">
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
          <Field label="كلمة المرور" required error={errors.password} htmlFor="password">
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
      )}

      <div className="mt-6 space-y-3">
        {kind === 'local' ? null : (
          <Button block size="lg" loading={busy} onClick={submit}>
            دخول
          </Button>
        )}
        {kind === 'local' && accounts.length === 0 ? (
          <p className="text-center text-[0.8125rem] leading-6 text-ink-500">
            لا توجد حسابات على هذا الجهاز بعد — ابدأ دفترًا جديدًا من شاشة البداية.
          </p>
        ) : null}
        <p className="text-center text-[0.8125rem] text-ink-500">
          ليس لديك حساب؟{' '}
          <Link to="/welcome" className="font-bold text-brand-600 underline">
            ابدأ من هنا
          </Link>
        </p>
      </div>
    </div>
  )
}

/** إنشاء حساب (الوضع السحابي) */
export function SignUpScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()

  const role = ((params.get('role') as Role | null) ?? 'customer') as Role
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function submit() {
    const result = validate(signUpSchema, { email, password, fullName: name, role })
    if (!result.success) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const created = await auth.signUp({ email, password, fullName: name, role })
      if (created.needsEmailConfirmation) {
        toast.show('تم إنشاء الحساب — تحقّق من بريدك لتأكيد الحساب', 'info')
        navigate('/signin', { replace: true })
        return
      }
      await auth.createProfile({ fullName: name, role, currency: 'YER' })
      toast.show('تم إنشاء الحساب')
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
        <h1 className="text-xl font-extrabold">إنشاء حساب</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-500">
          {role === 'merchant' ? 'حساب تاجر' : 'حساب عميل'}
        </p>
      </div>

      <Card className="space-y-4">
        <Field label="الاسم" required error={errors.fullName} htmlFor="name">
          <Input
            id="name"
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
        <Field label="كلمة المرور" required error={errors.password} hint="8 أحرف على الأقل وتتضمن رقمًا" htmlFor="pass2">
          <Input
            id="pass2"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
      </Card>

      <div className="mt-6 space-y-3">
        <Button block size="lg" loading={busy} onClick={submit}>
          إنشاء الحساب
        </Button>
        <Button variant="ghost" block onClick={() => navigate(-1)} disabled={busy}>
          رجوع
        </Button>
      </div>
    </div>
  )
}
