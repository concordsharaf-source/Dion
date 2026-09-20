import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { DesignCredit } from '@/components/DesignCredit'
import { useAuth } from '@/app/hooks/useAuth'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import type { DeviceAccount } from '@/data/port'
import { deviceSignInSchema, displayPhone, signInSchema, validate } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { consumePendingRoute } from '@/app/pendingRoute'
import { disableCloudMode, enableCloudMode } from '@/core/cloudMode'
import { isSupabaseConfigured } from '@/data/load'

/** رابط «هل نسيت كلمة المرور؟» */
function ForgotLink() {
  return (
    <Link to="/forgot" className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline">
      هل نسيت كلمة المرور؟
    </Link>
  )
}

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
  const [googleBusy, setGoogleBusy] = useState(false)
  const [accounts, setAccounts] = useState<DeviceAccount[]>([])

  const canSwitchMode = isSupabaseConfigured()
  const canUseGoogle = isSupabaseConfigured()

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

  function switchMode(): void {
    if (kind === 'local') enableCloudMode()
    else disableCloudMode()
    window.setTimeout(() => {
      window.location.hash = '#/signin'
      window.location.reload()
    }, 200)
  }

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

  async function handleGoogleSignIn() {
    if (!canUseGoogle) return
    setGoogleBusy(true)
    try {
      await ds.auth.signInWithGoogle?.()
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'تعذر تسجيل الدخول بـ Google', 'error')
      setGoogleBusy(false)
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

      <div className="mt-5 space-y-3">
        <Button block size="lg" loading={busy} onClick={submit}>
          دخول
        </Button>

        {canUseGoogle && kind !== 'local' ? (
          <>
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
              <span className="text-[0.6875rem] text-ink-400">أو</span>
              <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
            </div>
            <button
              type="button"
              disabled={googleBusy || busy}
              onClick={() => void handleGoogleSignIn()}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3.5 text-[0.9375rem] font-bold text-ink-800 shadow-sm transition active:scale-[0.98] disabled:opacity-50 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100"
            >
              <span className="grid h-6 w-6 place-items-center">
                <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              </span>
              {googleBusy ? 'جاري التحويل...' : 'المتابعة باستخدام Google'}
            </button>
          </>
        ) : null}

        <ForgotLink />
        <p className="text-center text-[0.8125rem] text-ink-500">
          ليس لديك حساب؟{' '}
          <Link to="/welcome" className="font-bold text-brand-600 underline">
            ابدأ من هنا
          </Link>
        </p>
        {canSwitchMode ? (
          <button
            type="button"
            disabled={busy}
            onClick={switchMode}
            className="block w-full px-2 text-center text-[0.6875rem] font-bold text-brand-600 underline disabled:opacity-60"
          >
            {kind === 'local' ? 'لديّ حساب سحابي (بريد إلكتروني) — الدخول به' : 'الدخول إلى دفتر على هذا الجهاز'}
          </button>
        ) : null}
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
              <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">دخول سريع</span>
            </button>
          ))}
          <p className="text-[0.6875rem] leading-5 text-ink-500">الدخول السريع لهذه الحسابات بلا كتابة كلمة المرور لأنها محفوظة على هذا الجهاز وحده.</p>
        </Card>
      ) : null}

      <DesignCredit className="mt-auto py-6" />
    </div>
  )
}
