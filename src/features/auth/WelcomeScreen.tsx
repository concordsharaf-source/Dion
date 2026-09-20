import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, User, ShieldCheck, WifiOff, Link2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { DesignCredit } from '@/components/DesignCredit'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import { isSupabaseConfigured, createCloudSource } from '@/data/load'
import { enableCloudMode } from '@/core/cloudMode'
import type { Role } from '@/core/domain'

export function WelcomeScreen() {
  const navigate = useNavigate()
  const kind = useDataSourceKind()
  const toast = useToast()
  const ds = useDataSource()
  const [role, setRole] = useState<Role | null>(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const [googleUrl, setGoogleUrl] = useState('')

  const canUseGoogle = isSupabaseConfigured()

  const continueWith = (role: Role) => {
    navigate(`/setup?role=${role}`)
  }

  async function continueWithGoogle() {
    if (!canUseGoogle) {
      toast.show('التسجيل بـ Google يحتاج تفعيل الحساب السحابي - أضف مفاتيح Supabase أولاً', 'info')
      return
    }
    if (!role) {
      toast.show('اختر نوع حسابك أولاً (عميل أو تاجر) ثم اضغط متابعة بـ Google', 'info')
      return
    }
    setGoogleBusy(true)
    setGoogleError('')
    setGoogleUrl('')
    try {
      try {
        localStorage.setItem('dafatar.pendingRole', role)
      } catch {}
      // المحرّك قد يكون محلياً (قبل تفعيل السحابي) - ننشئ مصدر سحابي مؤقتاً للحصول على رابط Google
      let url: string | void = undefined
      if (ds.auth.signInWithGoogle) {
        url = await ds.auth.signInWithGoogle(role)
      } else if (isSupabaseConfigured()) {
        // وضع الجهاز لكن مفاتيح Supabase موجودة - ننشئ مصدر سحابي مؤقت
        const cloud = await createCloudSource()
        url = await cloud.auth.signInWithGoogle?.(role)
        // فعّل الوضع السحابي قبل التوجيه
        enableCloudMode()
      }
      if (url && typeof url === 'string') {
        setGoogleUrl(url)
        try {
          window.location.href = url
        } catch {
          /* سيظهر الرابط اليدوي */
        }
        setTimeout(() => setGoogleBusy(false), 2000)
        return
      }
      setGoogleBusy(false)
      if (!url) {
        setGoogleError('تعذر إنشاء رابط Google - تأكد من تفعيل Google في Supabase')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'تعذر التسجيل بـ Google'
      setGoogleError(msg)
      toast.show(msg, 'error')
      setGoogleBusy(false)
    }
  }

  const roles = [
    {
      value: 'customer' as Role,
      label: 'عميل',
      hint: 'سجّل ديونك لدى المحلات وتابع السداد',
      icon: User,
      tile: 'bg-brand-600 text-white',
      ring: 'border-brand-600',
    },
    {
      value: 'merchant' as Role,
      label: 'تاجر',
      hint: 'أضف عملاءك وسجّل الديون والسدادات',
      icon: Store,
      tile: 'bg-gold-500 text-white',
      ring: 'border-gold-500',
    },
  ]

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pb-8 pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <img src="/icons/icon-192.png" alt="دفتر الديون" width={96} height={96} className="rounded-[1.75rem] shadow-float" />
        <h1 className="mt-4 text-[1.75rem] font-black text-brand-800 dark:text-brand-200">دفتر الديون</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-500">دفتر بسيط لإدارة الديون والسداد</p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[0.6875rem] font-bold text-ink-500">
          <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            <WifiOff size={12} /> يعمل بلا إنترنت
          </span>
          <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            <ShieldCheck size={12} /> رصيد من العمليات المؤكدة
          </span>
          <span className="chip bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
            <Link2 size={12} /> ربط اختياري
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <p id="role-label" className="text-center text-[0.8125rem] font-bold text-ink-600 dark:text-ink-300">
          اختر نوع حسابك
        </p>

        <div role="radiogroup" aria-labelledby="role-label" className="grid grid-cols-2 gap-3">
          {roles.map((item) => {
            const selected = role === item.value
            return (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`أنا ${item.label}`}
                onClick={() => setRole(item.value)}
                className={`card flex flex-col items-center gap-2 border-2 p-4 text-center transition active:scale-[0.98] ${selected ? item.ring : 'border-transparent'}`}
              >
                <span className={`grid h-14 w-14 place-items-center rounded-2xl ${item.tile}`}>
                  <item.icon size={28} />
                </span>
                <span className="text-[0.9375rem] font-extrabold">أنا {item.label}</span>
                <span className="text-[0.6875rem] leading-5 text-ink-500">{item.hint}</span>
              </button>
            )
          })}
        </div>

        <Button block size="lg" disabled={!role} onClick={() => role && continueWith(role)}>
          متابعة
        </Button>

        {canUseGoogle ? (
          <>
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
              <span className="text-[0.6875rem] text-ink-400">أو</span>
              <span className="h-px flex-1 bg-ink-200 dark:bg-ink-800" />
            </div>

            <button
              type="button"
              disabled={!role || googleBusy}
              onClick={() => void continueWithGoogle()}
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
              {googleBusy ? 'جاري التحويل لـ Google...' : `متابعة بـ Google كـ ${role === 'merchant' ? 'تاجر' : role === 'customer' ? 'عميل' : '...'}`}
            </button>

            {googleUrl ? (
              <div className="rounded-xl bg-brand-50 p-3 text-center dark:bg-brand-950/30">
                <p className="text-[0.75rem] font-bold text-brand-800 dark:text-brand-200">إذا لم يتم تحويلك تلقائياً:</p>
                <a href={googleUrl} className="mt-1 block rounded-xl bg-brand-600 px-4 py-2.5 text-[0.8125rem] font-extrabold text-white">
                  اضغط هنا لفتح Google
                </a>
                <p className="mt-1 text-[0.625rem] text-ink-400">انسخ الرابط وافتحه في المتصفح إذا كنت في وضع PWA</p>
              </div>
            ) : null}

            {googleError ? (
              <p className="rounded-xl bg-danger-50 px-3 py-2 text-center text-[0.75rem] font-bold leading-5 text-danger-700 dark:bg-danger-950/40 dark:text-danger-300">
                {googleError}
              </p>
            ) : (
              <p className="px-2 text-center text-[0.6875rem] leading-5 text-ink-400">بدون كلمة مرور - يرتبط تلقائياً بحساب Gmail</p>
            )}
          </>
        ) : null}

        <p className="px-2 pt-1 text-center text-[0.6875rem] leading-5 text-ink-500">
          {kind === 'local' ? 'يعمل التطبيق بالكامل على هذا الجهاز — بلا بريد إلكتروني وبلا ربط بأي طرف آخر.' : 'دفترك يعمل على هذا الجهاز بلا بريد إلكتروني، وتضيف بريدك لاحقًا من الإعدادات للمزامنة.'}
        </p>

        <Button variant="ghost" block onClick={() => navigate('/signin')} className="mt-1">
          لديّ حساب — تسجيل الدخول
        </Button>
      </div>

      <DesignCredit className="pt-5" />
    </div>
  )
}
