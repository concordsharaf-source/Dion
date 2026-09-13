/**
 * بطاقة «تواصل مع المصمم» — أسفل شاشة الإعدادات.
 * واتساب وبريد جاهزان للمس، بتصميم التطبيق نفسه.
 */

import { Mail, MessageCircle } from 'lucide-react'
import { Card } from '@/components/ui'

/** رقم واتساب بصيغة الرابط (بلا + ولا مسافات) */
export const DESIGNER_WHATSAPP_LINK = '967770388100'
/** الرقم كما يُعرض للمستخدم */
export const DESIGNER_WHATSAPP_DISPLAY = '+967770388100'
export const DESIGNER_EMAIL = 'concordsharaf@gmail.com'

export function DesignerContactCard() {
  return (
    <Card className="space-y-3">
      <div>
        <p className="text-[0.875rem] font-extrabold">تواصل مع المصمم</p>
        <p className="mt-1 text-[0.75rem] leading-6 text-ink-600 dark:text-ink-300">
          نسعد باستقبال ملاحظاتكم واقتراحاتكم
        </p>
        <p className="text-[0.75rem] leading-6 text-ink-600 dark:text-ink-300">
          لتحسين تجربة استخدام حسابي وتطويرها باستمرار.
        </p>
      </div>

      <div className="space-y-2">
        <a
          href={`https://wa.me/${DESIGNER_WHATSAPP_LINK}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`واتساب ${DESIGNER_WHATSAPP_DISPLAY}`}
          className="flex items-center gap-3 rounded-2xl bg-ink-100 px-3 py-3 transition active:scale-[0.99] dark:bg-ink-900"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            <MessageCircle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.6875rem] text-ink-500">واتساب</span>
            <span className="block font-bold" dir="ltr">
              {DESIGNER_WHATSAPP_DISPLAY}
            </span>
          </span>
        </a>

        <a
          href={`mailto:${DESIGNER_EMAIL}`}
          aria-label={`البريد الإلكتروني ${DESIGNER_EMAIL}`}
          className="flex items-center gap-3 rounded-2xl bg-ink-100 px-3 py-3 transition active:scale-[0.99] dark:bg-ink-900"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-200">
            <Mail size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.6875rem] text-ink-500">البريد الإلكتروني</span>
            <span className="block truncate font-bold" dir="ltr">
              {DESIGNER_EMAIL}
            </span>
          </span>
        </a>
      </div>

      <p className="border-t border-ink-200/70 pt-3 text-center text-[0.6875rem] font-semibold text-ink-500 dark:border-ink-800">
        تصميم شرف غالب قحطان · الجمهورية اليمنية
      </p>
    </Card>
  )
}
