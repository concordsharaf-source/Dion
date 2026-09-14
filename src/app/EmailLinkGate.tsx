import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, MailCheck, ShieldAlert } from 'lucide-react'
import { Button, Card, Field, Input, useToast } from '@/components/ui'
import { useDataSource } from '@/app/DataSourceProvider'
import {
  authFragmentType,
  emailLinkSuccessMessage,
  hasAuthFragment,
  parseEmailLink,
  stripEmailLinkParams,
  type EmailLink,
} from '@/core/emailLink'
import { toUserMessage } from '@/core/errors'
import { queryClient } from '@/app/queryClient'

/**
 * بوابة روابط البريد: تتحقق من الرابط قبل تشغيل التطبيق.
 *
 * الرابط يصل بصيغة `?token_hash=…&type=…` (قبل الهاش) فلا يتعارض مع التوجيه بالهاش،
 * ثم يُنظَّف العنوان ويُفتح التطبيق بجلسة صحيحة — بلا إعادة كتابة الاسم أو الهاتف.
 */
export function EmailLinkGate({ children }: { children: ReactNode }) {
  const ds = useDataSource()
  const toast = useToast()
  const [link] = useState<EmailLink | null>(() =>
    typeof window === 'undefined' ? null : parseEmailLink(window.location.search),
  )
  const [fragment] = useState<string | null>(() =>
    typeof window !== 'undefined' && hasAuthFragment(window.location.hash) ? window.location.hash : null,
  )
  const [state, setState] = useState<'idle' | 'working' | 'failed' | 'blocked'>(
    link || fragment ? 'working' : 'idle',
  )
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const started = useRef(false)

  // صيغة Supabase الافتراضية: الرمز في الهاش يستهلكه العميل تلقائيًا، فننظّف العنوان فقط
  useEffect(() => {
    if (!fragment || link) return
    const timer = window.setTimeout(() => {
      const type = authFragmentType(fragment)
      window.location.hash = '#/'
      toast.show(
        type === 'recovery' ? emailLinkSuccessMessage('recovery') : 'تم تأكيد بريدك — دفترك جاهز الآن.',
        'ok',
      )
      setState('idle')
    }, 250)
    return () => window.clearTimeout(timer)
  }, [fragment, link, toast])

  useEffect(() => {
    if (!link || started.current) return
    started.current = true
    let alive = true
    void (async () => {
      if (!ds.auth.verifyEmailLink) {
        if (alive) setState('blocked')
        return
      }
      try {
        await ds.auth.verifyEmailLink({ tokenHash: link.tokenHash, type: link.type })
        if (!alive) return
        cleanUrl()
        await queryClient.invalidateQueries()
        setState('idle')
        toast.show(emailLinkSuccessMessage(link.type), 'ok')
        window.location.hash = `#${link.nextRoute}`
      } catch (e) {
        if (!alive) return
        cleanUrl()
        setError(toUserMessage(e))
        setState('failed')
      }
    })()
    return () => {
      alive = false
    }
  }, [ds, link, toast])

  async function resend() {
    if (!ds.auth.resendConfirmation) return
    const value = email.trim()
    if (!value) {
      setError('اكتب بريدك الإلكتروني أولًا.')
      return
    }
    setSending(true)
    try {
      await ds.auth.resendConfirmation(value)
      setError('')
      toast.show('أرسلنا رابط تأكيد جديد إلى بريدك', 'info')
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setSending(false)
    }
  }

  if (state === 'idle') return <>{children}</>

  return (
    <div className="app-shell justify-center px-5 py-10">
      <Card className="space-y-4 text-center">
        <div className="flex justify-center">
          {state === 'working' ? (
            <MailCheck size={38} className="text-brand-600" />
          ) : state === 'failed' ? (
            <ShieldAlert size={38} className="text-danger-600" />
          ) : (
            <CheckCircle2 size={38} className="text-brand-600" />
          )}
        </div>

        {state === 'working' ? (
          <>
            <p className="text-base font-extrabold">جارٍ تأكيد بريدك…</p>
            <p className="text-[0.8125rem] leading-6 text-ink-500">لحظات فقط، لا تغلق الصفحة.</p>
          </>
        ) : null}

        {state === 'blocked' ? (
          <>
            <p className="text-base font-extrabold">افتح الرابط من نفس جهازك</p>
            <p className="text-[0.8125rem] leading-6 text-ink-500">
              هذا الرابط يخصّ حسابًا سحابيًا، والتطبيق الآن في وضع الدفتر المحلي (بلا حساب سحابي).
              شغّل «الحساب السحابي» من الإعدادات في نفس المتصفح الذي سجّلت منه، ثم افتح الرابط مرة أخرى.
            </p>
            <Button block onClick={goToSignIn}>
              متابعة إلى التطبيق
            </Button>
          </>
        ) : null}

        {state === 'failed' ? (
          <>
            <p className="text-base font-extrabold">تعذّر تأكيد الرابط</p>
            <p className="text-[0.8125rem] leading-6 text-ink-500">
              {error || 'انتهت صلاحية الرابط أو استُخدم من قبل.'} يمكنك طلب رابط جديد.
            </p>
            <Field label="بريدك الإلكتروني" htmlFor="link-email">
              <Input
                id="link-email"
                type="email"
                inputMode="email"
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </Field>
            <Button block loading={sending} onClick={() => void resend()}>
              أرسل رابط تأكيد جديد
            </Button>
            <Button variant="ghost" block onClick={goToSignIn}>
              متابعة إلى شاشة الدخول
            </Button>
          </>
        ) : null}
      </Card>
    </div>
  )
}

/** حذف رمز الرابط من العنوان حتى لا يُستهلك مرة أخرى */
function cleanUrl() {
  const url = `${window.location.pathname}${stripEmailLinkParams(window.location.search)}${window.location.hash}`
  window.history.replaceState(null, '', url)
}

function goToSignIn() {
  cleanUrl()
  window.location.hash = '#/signin'
}
