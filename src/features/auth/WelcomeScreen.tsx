import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, User, ChevronLeft, ShieldCheck, WifiOff, Link2 } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useDataSourceKind } from '@/app/DataSourceProvider'
import type { Role } from '@/core/domain'

/**
 * شاشة البداية: «دفتر الديون» + اختيار الدور
 * لا يُطلب الربط ولا إنشاء حساب سحابي لاستخدام الدفتر الشخصي.
 */
export function WelcomeScreen() {
  const navigate = useNavigate()
  const kind = useDataSourceKind()
  const [selected, setSelected] = useState<Role | null>(null)
  const toast = useToast()

  const continueWith = (role: Role) => {
    setSelected(role)
    navigate(kind === 'local' ? `/setup?role=${role}` : `/signup?role=${role}`)
  }

  return (
    <div className="flex min-h-[100dvh] flex-col px-5 pb-8 pt-safe">
      <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
        <img
          src="/icons/icon-192.png"
          alt="دفتر الديون"
          width={104}
          height={104}
          className="rounded-[1.75rem] shadow-float"
        />
        <h1 className="mt-5 text-[1.75rem] font-black text-brand-800 dark:text-brand-200">دفتر الديون</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-500">دفتر بسيط لإدارة الديون والسداد</p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[0.6875rem] font-bold text-ink-500">
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

        <button
          type="button"
          onClick={() => continueWith('customer')}
          className="card flex w-full items-center gap-3 p-4 text-start transition active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-white">
            <User size={24} />
          </span>
          <span className="flex-1">
            <span className="block text-base font-extrabold">أنا عميل</span>
            <span className="block text-[0.75rem] text-ink-500">سجّل ديونك لدى المحلات وتابع السداد</span>
          </span>
          <ChevronLeft size={20} className="text-ink-400" />
        </button>

        <button
          type="button"
          onClick={() => continueWith('merchant')}
          className="card flex w-full items-center gap-3 p-4 text-start transition active:scale-[0.99]"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gold-500 text-white">
            <Store size={24} />
          </span>
          <span className="flex-1">
            <span className="block text-base font-extrabold">أنا تاجر</span>
            <span className="block text-[0.75rem] text-ink-500">أضف عملاءك وسجّل الديون والسدادات</span>
          </span>
          <ChevronLeft size={20} className="text-ink-400" />
        </button>

        {kind === 'local' ? (
          <p className="px-2 pt-1 text-center text-[0.6875rem] leading-5 text-ink-500">
            تعمل النسخة الحالية بالكامل على هذا الجهاز — بدون بريد إلكتروني وبدون إنترنت.
            <br />
            لا تحتاج إلى ربط حسابك بأي طرف آخر لاستخدام التطبيق.
          </p>
        ) : null}

        <Button variant="ghost" block onClick={() => navigate('/signin')} className="mt-1">
          لديّ حساب — تسجيل الدخول
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => {
            toast.show('تطبيق الويب: أضفه إلى الشاشة الرئيسية من قائمة المتصفح «تثبيت التطبيق»', 'info')
          }}
          className="border-none"
        >
          كيف أثبّت التطبيق على الجوال؟
        </Button>
        {selected ? null : null}
      </div>
    </div>
  )
}
