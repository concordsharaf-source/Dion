import { useState } from 'react'
import { KeyRound, Lock, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button, Card, ConfirmDialog, Field, Input, SectionTitle, useToast } from '@/components/ui'
import { useAuth, useIsLocalMode, useProfile, useSession } from '@/app/hooks/useAuth'
import { useDataSource } from '@/app/DataSourceProvider'
import { validate, passwordSchema } from '@/core/validation'
import { toUserMessage } from '@/core/errors'
import { formatDateTimeAr } from '@/core/datetime'
import { useNavigate } from 'react-router-dom'
import { AppLockSection } from './AppLockSection'

export function SecurityScreen() {
  const ds = useDataSource()
  const local = useIsLocalMode()
  const profile = useProfile()
  const session = useSession()
  const auth = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)

  const canChangePassword = Boolean(ds.auth.changePassword) && !local

  async function changePassword() {
    const parsed = validate(passwordSchema, next)
    if (!parsed.success) {
      setErrors({ next: parsed.errors._ ?? 'كلمة المرور غير صحيحة' })
      return
    }
    if (next !== confirm) {
      setErrors({ confirm: 'كلمتا المرور غير متطابقتين' })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await ds.auth.changePassword?.(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.show('تم تغيير كلمة المرور')
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-6">
      <PageHeader title="الأمان" />

      <div className="space-y-4 px-4 pt-4">
        <Card className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            <ShieldCheck size={22} />
          </span>
          <div className="text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
            {local ? (
              <>
                في وضع الجهاز: بياناتك مخزّنة محليًا على هذا الجهاز فقط، ومحمية بجلسة مربوطة بالمتصفح. لا يوجد خادم
                يراها، ولا يمكن لأي شخص آخر الوصول إليها من جهاز آخر.
              </>
            ) : (
              <>
                حسابك محمي بتسجيل دخول آمن، وكل جدول في قاعدة البيانات محمي بسياسات وصول صارمة (RLS): لا يمكن لأي
                مستخدم قراءة أو تعديل بيانات غيره، ولا تأكيد عملية نيابة عن الطرف الآخر.
              </>
            )}
          </div>
        </Card>

        <AppLockSection userName={profile.data?.fullName ?? null} />

        <section>
          <SectionTitle>الجلسة الحالية</SectionTitle>
          <Card className="divide-y divide-ink-200/70 p-0 text-[0.8125rem] dark:divide-ink-800/70">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-2 text-ink-500">
                <Smartphone size={15} /> الجهاز
              </span>
              <span className="font-semibold">هذا المتصفح</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-ink-500">بدأت في</span>
              <span className="font-semibold">
                {session.data?.createdAt ? formatDateTimeAr(session.data.createdAt) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-ink-500">المعرّف</span>
              <span className="font-mono text-[0.75rem] font-semibold" dir="ltr">
                {profile.data?.id.slice(0, 8) ?? '—'}
              </span>
            </div>
          </Card>
        </section>

        {canChangePassword ? (
          <section>
            <SectionTitle>تغيير كلمة المرور</SectionTitle>
            <Card className="space-y-4">
              <Field label="كلمة المرور الحالية" required htmlFor="cur-pass">
                <Input
                  id="cur-pass"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="كلمة المرور الجديدة" required error={errors.next} htmlFor="new-pass" hint="8 أحرف على الأقل وتتضمن رقمًا">
                <Input
                  id="new-pass"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </Field>
              <Field label="تأكيد كلمة المرور" required error={errors.confirm} htmlFor="conf-pass">
                <Input
                  id="conf-pass"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
              <Button block loading={busy} icon={<KeyRound size={17} />} onClick={() => void changePassword()}>
                تغيير كلمة المرور
              </Button>
            </Card>
          </section>
        ) : (
          <section>
            <SectionTitle>حماية الجهاز</SectionTitle>
            <Card className="space-y-2 text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
              <p className="flex items-center gap-2 font-bold text-ink-800 dark:text-ink-100">
                <Lock size={16} /> نصائح لحماية دفترك
              </p>
              <ul className="list-inside list-disc space-y-1 ps-1">
                <li>لا تشارك جهازك مع آخرين — الوصول إلى المتصفح يعني الوصول إلى الدفتر.</li>
                <li>ثبّت التطبيق على شاشة جهازك الرئيسية ليعمل كتطبيق مستقل.</li>
                <li>نزّل نسخة احتياطية من الإعدادات ← البيانات بشكل دوري.</li>
                <li>سجّل الخروج عند استخدام جهاز مشترك.</li>
              </ul>
            </Card>
          </section>
        )}

        <Button block variant="ghost" className="text-danger-600" icon={<LogOut size={17} />} onClick={() => setConfirmOut(true)}>
          تسجيل الخروج
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOut}
        title="تسجيل الخروج"
        message="سيتم إنهاء الجلسة الحالية. بياناتك لا تُحذف."
        confirmLabel="خروج"
        tone="danger"
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => {
          void auth
            .signOut()
            .then(() => navigate('/welcome', { replace: true }))
            .catch((e) => toast.show(toUserMessage(e), 'error'))
        }}
      />
    </div>
  )
}
