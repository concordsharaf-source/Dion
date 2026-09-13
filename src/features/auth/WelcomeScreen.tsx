import { useNavigate } from 'react-router-dom'
import { Store, User, ShieldCheck, WifiOff, Link2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import type { Role } from '@/core/domain'

/**
 * شاشة البداية: «دفتر الديون» + تحديد نوع الحساب (عميل / تاجر).
 * النوع يُحدَّد هنا مرة واحدة، فلا تُعاد أزرار «عميل/تاجر» في الصفحة التالية.
 * لا يُطلب الربط ولا إنشاء حساب سحابي لاستخدام الدفتر الشخصي.
 */
export function WelcomeScreen() {
  const navigate = useNavigate()
  const kind = useDataSourceKind()
  const toast = useToast()

  const continueWith = (role: Role) => {
    navigate(kind === 'local' ? `/setup?role=${role}` : `/signup?role=${role}`)
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
        <img
          src="/icons/icon-192.png"
          alt="دفتر الديون"
          width={96}
          height={96}
          className="rounded-[1.75rem] shadow-float"
        />
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
        <p className="text-center text-[0.8125rem] font-bold text-ink-600 dark:text-ink-300">اختر نوع حسابك</p>

        <div className="grid grid-cols-2 gap-3">
          {roles.map((role) => (
            <button
              key={role.value}
              type="button"
              aria-label={`أنا ${role.label}`}
              onClick={() => continueWith(role.value)}
              className={`card flex flex-col items-center gap-2 border-2 border-transparent p-4 text-center transition active:scale-[0.98] ${role.ring}`}
            >
              <span className={`grid h-14 w-14 place-items-center rounded-2xl ${role.tile}`}>
                <role.icon size={28} />
              </span>
              <span className="text-[0.9375rem] font-extrabold">أنا {role.label}</span>
              <span className="text-[0.6875rem] leading-5 text-ink-500">{role.hint}</span>
            </button>
          ))}
        </div>

        {kind === 'local' ? (
          <p className="px-2 pt-1 text-center text-[0.6875rem] leading-5 text-ink-500">
            تعمل النسخة الحالية بالكامل على هذا الجهاز — ولا تحتاج ربطًا بأي طرف آخر لاستخدام التطبيق.
          </p>
        ) : null}

        <Button variant="ghost" block onClick={() => navigate('/signin')} className="mt-1">
          لديّ حساب — تسجيل الدخول
        </Button>
        <button
          type="button"
          onClick={() => {
            toast.show('تطبيق الويب: أضفه إلى الشاشة الرئيسية من قائمة المتصفح «تثبيت التطبيق»', 'info')
          }}
          className="block w-full px-2 text-center text-[0.6875rem] text-ink-400 underline"
        >
          كيف أثبّت التطبيق على الجوال؟
        </button>
      </div>
    </div>
  )
}
