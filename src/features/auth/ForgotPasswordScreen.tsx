import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Mail } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { DesignCredit } from '@/components/DesignCredit'
import { useAuth } from '@/app/hooks/useAuth'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { deviceSignInSchema, normalizePhoneNumber, emailSchema, validate } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { consumePendingRoute } from '@/app/pendingRoute'

/**
 * «هل نسيت كلمة المرور؟»
 *
 * وضع الجهاز: لا توجد كلمة مرور أصلًا — الرقم وحده يفتح الحساب (وإن كان الرقم جديدًا
 * نبدأ حسابًا جديدًا مباشرة). الوضع السحابي: يُرسَل رابط استعادة إلى البريد.
 */
export function ForgotPasswordScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const kind = useDataSourceKind()

  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit() {
    if (kind !== 'local') {
      const result = validate(emailSchema, email)
      if (!result.success) {
        setErrors({ email: result.firstError ?? 'البريد الإلكتروني غير صحيح' })
        return
      }
      setErrors({})
      setBusy(true)
      try {
        await auth.resetPassword(result.data!)
        setSent(true)
        toast.show('أرسلنا رابط الاستعادة إلى بريدك الإلكتروني', 'info')
      } catch (e) {
        setErrors({ _: toUserMessage(e) })
      } finally {
        setBusy(false)
      }
      return
    }

    const result = validate(deviceSignInSchema, { identifier: phone })
    if (!result.success) {
      setErrors({ phone: result.errors.identifier ?? 'رقم الهاتف غير صحيح' })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const normalized = normalizePhoneNumber(result.data!.identifier) ?? result.data!.identifier
      await auth.openDeviceAccount(normalized)
      toast.show('تم فتح دفترك — مرحبًا بعودتك')
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
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
          {kind !== 'local' ? <Mail size={26} /> : <KeyRound size={26} />}
        </span>
        <h1 className="mt-3 text-xl font-extrabold">هل نسيت كلمة المرور؟</h1>
        <p className="mt-1 text-[0.8125rem] leading-6 text-ink-500">
          {kind !== 'local'
            ? 'أدخل بريدك وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.'
            : 'في حساب هذا الجهاز لا توجد كلمة مرور — أدخل رقم هاتفك لفتح دفترك مباشرة.'}
        </p>
      </div>

      {sent && kind !== 'local' ? (
        <Card className="space-y-3 text-center">
          <p className="text-[0.875rem] font-bold text-brand-700 dark:text-brand-200">تم الإرسال</p>
          <p className="text-[0.8125rem] leading-6 text-ink-500">
            افتح الرسالة في بريدك واضغط الرابط لتعيين كلمة مرور جديدة. إن لم تجد الرسالة، تحقّق من مجلد
            الرسائل غير المرغوبة.
          </p>
        </Card>
      ) : (
        <Card className="space-y-4">
          {kind !== 'local' ? (
            <Field label="البريد الإلكتروني" required error={errors.email} htmlFor="forgot-email">
              <Input
                id="forgot-email"
                type="email"
                inputMode="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </Field>
          ) : (
            <>
              <Field
                label="رقم الهاتف"
                required
                error={errors.phone}
                hint="نفس الرقم المسجّل على هذا الجهاز"
                htmlFor="forgot-phone"
              >
                <Input
                  id="forgot-phone"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="777 123 456"
                />
              </Field>
              <p className="text-[0.6875rem] leading-5 text-ink-500">
                بياناتك محفوظة على هذا الجهاز، وفتح الحساب بالرقم لا يحذف شيئًا. وإن أدخلت رقمًا جديدًا
                ستحتاج إلى إنشاء حساب به من شاشة البداية.
              </p>
            </>
          )}
          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>
      )}

      <div className="mt-6 space-y-2">
        <Button block size="lg" loading={busy} onClick={submit}>
          {kind !== 'local' ? 'أرسل رابط الاستعادة' : 'افتح دفتري'}
        </Button>
        <Link to="/signin" className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline">
          العودة لتسجيل الدخول
        </Link>
      </div>

      <DesignCredit className="mt-auto py-6" />
    </div>
  )
}
