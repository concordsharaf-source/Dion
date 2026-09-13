import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Mail } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useAuth } from '@/app/hooks/useAuth'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import { normalizePhoneNumber, resetDevicePasswordSchema, emailSchema, validate } from '@/core/validation'
import { toUserMessage } from '@/core/errors'

/**
 * استعادة كلمة المرور.
 * على هذا الجهاز: التحقق من رقم الهاتف المسجّل ثم تعيين كلمة مرور جديدة.
 * في الوضع السحابي: يُرسَل رابط الاستعادة إلى البريد الإلكتروني (Supabase).
 */
export function ForgotPasswordScreen() {
  const navigate = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const kind = useDataSourceKind()

  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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

    const result = validate(resetDevicePasswordSchema, {
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
      await auth.resetDevicePassword(normalized, data.password)
      toast.show('تم تعيين كلمة المرور الجديدة — سجّل الدخول بها الآن')
      navigate('/signin', { replace: true })
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
            : 'أدخل رقم هاتفك المسجّل على هذا الجهاز ثم اختر كلمة مرور جديدة.'}
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
              <Field label="رقم الهاتف" required error={errors.phone} htmlFor="forgot-phone">
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
              <Field
                label="كلمة المرور الجديدة"
                required
                error={errors.password}
                hint="4 خانات على الأقل — أرقام أو حروف كما تريد"
                htmlFor="forgot-password"
              >
                <Input
                  id="forgot-password"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="تأكيد كلمة المرور" required error={errors.confirmPassword} htmlFor="forgot-confirm">
                <Input
                  id="forgot-confirm"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              <p className="text-[0.6875rem] leading-5 text-ink-500">
                تُحفظ كلمة المرور على هذا الجهاز فقط. لا يمكن لأحد استرجاع بياناتك من دون الوصول إليه.
              </p>
            </>
          )}
          {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
        </Card>
      )}

      <div className="mt-6 space-y-3 pb-8">
        <Button block size="lg" loading={busy} onClick={submit}>
          {kind !== 'local' ? 'أرسل رابط الاستعادة' : 'تعيين كلمة المرور'}
        </Button>
        <Link to="/signin" className="block py-2 text-center text-[0.8125rem] font-bold text-brand-600 underline">
          العودة لتسجيل الدخول
        </Link>
      </div>
    </div>
  )
}
