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

/**
 * تسجيل الدخول.
 * وضع الجهاز: رقم الهاتف وكلمة المرور (بيانات محفوظة على الجهاز).
 * الوضع السحابي: البريد الإلكتروني وكلمة المرور — لمن أضاف بريده من الإعدادات.
 *
 * ومن لا بريد له يبدأ دفتره على جهازه من «ابدأ من هنا» — بلا بريد إلكتروني.
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

  // تبديل وضع الدخول متاح فقط حين تكون مفاتيح المشروع مضبوطة في النشر
  const canSwitchMode = isSupabaseConfigured()

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

  /**
   * تبديل وضع الدخول: حساب سحابي (بريد) ⇄ دفتر على هذا الجهاز.
   * يحتاج إعادة تحميل واحدة ليُحمَّل المحرّك الآخر.
   */
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
