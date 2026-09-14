/**
 * قسم «الحساب السحابي» في الإعدادات.
 *
 * التطبيق محلي أولًا: من لا يريد سحابةً يبقى دفتره على جهازه.
 * ومن يريد المزامنة بين الأجهزة، والعمليات المشتركة بين التاجر والعميل،
 * وإشعارات فورية تصل والتطبيق مغلق — **يضيف بريده الإلكتروني من هنا**.
 *
 * البريد اختياري تمامًا: لا يُطلب عند إنشاء الحساب، ولا يُشترط لاستخدام التطبيق.
 */

import { useState } from 'react'
import { Cloud, CloudOff, Mail } from 'lucide-react'
import { Button, Card, ConfirmDialog, Field, Input, SectionTitle } from '@/components/ui'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import { useProfile } from '@/app/hooks/useAuth'
import { createCloudSource, isSupabaseConfigured } from '@/data/load'
import { disableCloudMode, enableCloudMode } from '@/core/cloudMode'
import { linkCloudAccount, writeCloudNotice } from '@/services/cloudLink'
import { linkCloudSchema, validate } from '@/core/validation'
import { toUserMessage } from '@/core/errors'

export function CloudAccountSection() {
  const kind = useDataSourceKind()
  const ds = useDataSource()
  const profile = useProfile()
  const [confirmOff, setConfirmOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // إن لم تُضبط مفاتيح المشروع في بيئة النشر فلا شيء لعرضه
  if (!isSupabaseConfigured()) return null

  const active = kind === 'supabase'

  /**
   * تشغيل الوضع السحابي ثم إعادة تحميل واحدة ليعمل التطبيق بالمحرّك السحابي.
   * `notice` رسالة تُعرض بعد إعادة التحميل (الرسائل العابرة تضيع مع التحميل).
   */
  function switchToCloud(notice?: string): void {
    if (notice) writeCloudNotice(notice)
    enableCloudMode()
    window.setTimeout(() => window.location.reload(), 200)
  }

  function goToSignIn(): void {
    writeCloudNotice('سجّل الدخول بحسابك السحابي لمتابعة المزامنة.')
    enableCloudMode()
    window.setTimeout(() => {
      window.location.hash = '#/signin'
      window.location.reload()
    }, 200)
  }

  async function linkEmail() {
    const p = profile.data
    if (!p) {
      setErrors({ _: 'تعذّر قراءة ملفك الشخصي. أعد تحميل التطبيق ثم حاول مجددًا.' })
      return
    }
    const parsed = validate(linkCloudSchema, { email, password, confirmPassword: confirm })
    if (!parsed.success) {
      setErrors(parsed.errors)
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const cloud = await createCloudSource()
      const result = await linkCloudAccount({
        cloud,
        local: ds,
        profile: p,
        email: parsed.data!.email,
        password: parsed.data!.password,
      })

      if (result.needsConfirmation) {
        switchToCloud('أرسلنا رابط تأكيد إلى بريدك. افتحه من هذا الجهاز لتشغيل المزامنة ونقل دفترك.')
        return
      }

      const moved = result.transferred
      const summary =
        moved && moved.parties + moved.entries > 0
          ? ` ونُقل دفترك: ${moved.parties} طرفًا و${moved.entries} عملية`
          : ''
      switchToCloud(`تم ربط حسابك السحابي${summary}.`)
    } catch (e) {
      setErrors({ _: toUserMessage(e) })
      setBusy(false)
    }
  }

  function disconnect() {
    setBusy(true)
    disableCloudMode()
    setConfirmOff(false)
    window.setTimeout(() => window.location.reload(), 200)
  }

  return (
    <section>
      <SectionTitle>الحساب السحابي</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            {active ? <Cloud size={20} /> : <CloudOff size={20} />}
          </span>
          <div className="flex-1">
            <p className="text-[0.875rem] font-bold">
              {active ? 'مُفعّل — المزامنة تعمل' : 'غير مُفعّل — دفترك على هذا الجهاز'}
            </p>
            <p className="mt-1 text-[0.75rem] leading-5 text-ink-600 dark:text-ink-300">
              {active
                ? 'بيانات المستخدم موحّدة على حسابك، وتُزامَن بين أجهزتك، وتعمل العمليات المشتركة والإشعارات بين التاجر والعميل.'
                : 'دفترك يعمل كاملًا على هذا الجهاز بلا بريد ولا إنترنت. وأضف بريدك الإلكتروني متى شئت لتُزامَن بياناتك بين أجهزتك، ولتعمل العمليات المشتركة والإشعارات.'}
            </p>
          </div>
        </div>

        {active ? (
          <Button
            block
            variant="ghost"
            className="text-danger-600"
            icon={<CloudOff size={17} />}
            loading={busy}
            onClick={() => setConfirmOff(true)}
          >
            فصل الحساب السحابي
          </Button>
        ) : (
          <div className="space-y-3 border-t border-ink-200/70 pt-3 dark:border-ink-800/70">
            <p className="flex items-center gap-2 text-[0.8125rem] font-bold">
              <Mail size={16} /> أضف بريدك الإلكتروني (اختياري)
            </p>
            <p className="text-[0.6875rem] leading-5 text-ink-500">
              يُستخدم للدخول من جهاز آخر، وللمزامنة بين أجهزتك، وللإشعارات الفورية. تُنقل بيانات دفترك الحالي معه —
              بلا حذف وبلا تكرار.
            </p>
            <Field label="البريد الإلكتروني" required error={errors.email} htmlFor="cloud-email">
              <Input
                id="cloud-email"
                type="email"
                inputMode="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </Field>
            <Field
              label="كلمة مرور الحساب السحابي"
              required
              error={errors.password}
              hint="6 خانات على الأقل — هذه كلمة مرور الحساب في السحابة، ودخولك على الجهاز يبقى بكلمة مرورك الحالية"
              htmlFor="cloud-password"
            >
              <Input
                id="cloud-password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label="تأكيد كلمة المرور" required error={errors.confirmPassword} htmlFor="cloud-confirm">
              <Input
                id="cloud-confirm"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            {errors._ ? <p className="text-[0.8125rem] font-bold text-danger-600">{errors._}</p> : null}
            <Button block icon={<Cloud size={17} />} loading={busy} onClick={() => void linkEmail()}>
              أضف البريد وشغّل المزامنة
            </Button>
            <Button block variant="ghost" disabled={busy} onClick={goToSignIn}>
              لديّ حساب سحابي — تسجيل الدخول
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOff}
        title="فصل الحساب السحابي"
        message="سيتوقف التطبيق عن المزامنة وتعود للعمل على هذا الجهاز وحده. دفترك المحلي لا يُحذف، وبياناتك السحابية تبقى في حسابك."
        confirmLabel="فصل"
        tone="danger"
        loading={busy}
        onCancel={() => setConfirmOff(false)}
        onConfirm={disconnect}
      />
    </section>
  )
}
