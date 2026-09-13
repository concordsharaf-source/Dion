/**
 * صف تفعيل الإشعارات الفورية (تصل والتطبيق مغلق).
 * في الوضع المحلي تظهر الحالة مع سبب واضح (الإرسال يحتاج حسابًا سحابيًا).
 */

import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import clsx from 'clsx'
import { useDataSource, useDataSourceKind } from '@/app/DataSourceProvider'
import { useToast } from '@/components/ui'
import { disablePush, enablePush, pushSupported } from '@/services/push'

export function PushToggle() {
  const ds = useDataSource()
  const kind = useDataSourceKind()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  const supported = pushSupported()

  // الحالة الفعلية تُقرأ من اشتراك المتصفح المحفوظ
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!supported) return
        const registration = await navigator.serviceWorker.ready
        const existing = await registration.pushManager.getSubscription()
        if (alive) setEnabled(Boolean(existing))
      } catch {
        /* لا اشتراك */
      }
    })()
    return () => {
      alive = false
    }
  }, [supported])

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      if (enabled) {
        const ok = await disablePush(ds.push)
        if (ok) {
          setEnabled(false)
          toast.show('أُوقفت الإشعارات الفورية', 'info')
        } else {
          toast.show('تعذّر إيقاف الإشعارات على هذا الجهاز', 'error')
        }
      } else {
        const result = await enablePush(ds.push)
        if (result.ok) {
          setEnabled(true)
          toast.show('تم تفعيل الإشعارات — ستصلك حتى والتطبيق مغلق')
        } else {
          toast.show(result.message, result.reason === 'denied' ? 'error' : 'info')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const hint = !supported
    ? 'هذا المتصفح لا يدعم الإشعارات الفورية'
    : kind === 'local'
      ? 'تحتاج حسابًا سحابيًا مربوطًا — الإشعارات تُرسل من الخادم'
      : enabled
        ? 'تصل الإشعارات والتطبيق مغلق (دين، سداد، تأكيد، ربط)'
        : 'فعّلها لتصلك العمليات فور تسجيلها'

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-200/70 text-ink-600 dark:bg-ink-800 dark:text-ink-300">
        <BellRing size={18} />
      </span>
      <span className="flex-1">
        <span className="block font-bold">إشعارات فورية</span>
        <span className="block text-[0.6875rem] leading-5 text-ink-500">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="إشعارات فورية"
        disabled={busy || !supported}
        onClick={() => void toggle()}
        className={clsx(
          'relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50',
          enabled ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-700',
        )}
      >
        <span className={clsx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', enabled ? 'start-1' : 'start-6')} />
      </button>
    </div>
  )
}
