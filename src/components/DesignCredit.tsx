/**
 * حقوق المصمم — سطر خفيف أسفل صفحات التطبيق.
 * التفاصيل الكاملة (واتساب + بريد) في بطاقة «تواصل مع المصمم» داخل الإعدادات.
 */

import { DESIGNER_WHATSAPP_DISPLAY, DESIGNER_WHATSAPP_LINK } from '@/features/settings/DesignerContactCard'

export function DesignCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-[0.6875rem] leading-6 text-ink-400 ${className}`.trim()}>
      تصميم وتطوير:{' '}
      <span className="font-bold text-ink-500">شرف غالب قحطان</span> ·{' '}
      <a href={`https://wa.me/${DESIGNER_WHATSAPP_LINK}`} target="_blank" rel="noreferrer" className="underline">
        {DESIGNER_WHATSAPP_DISPLAY}
      </a>{' '}
      · جميع الحقوق محفوظة
    </p>
  )
}
