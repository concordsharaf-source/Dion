/**
 * حارس القفل: يمنع رؤية أي شاشة داخل التطبيق قبل الفتح.
 *   · يُقفل عند كل تشغيل (الفتح مرة واحدة لكل جلسة تطبيق)
 *   · يُقفل عند العودة للتطبيق بعد غياب أطول من مدة السماح
 *   · لا يفعل شيئًا إن لم يكن القفل مفعّلًا (التطبيق يعمل كالمعتاد)
 *
 * البصمة تُطلب **مرة واحدة عند الدخول فقط**: كل قفل جديد يولّد «حلقة قفل»
 * (lockEpisode) تُعيد تركيب شاشة القفل فتُطالب الجهاز مرة واحدة، ولا يوجد أي
 * تذكير تلقائي أثناء الاستخدام. كما نتجاهل إخفاء الصفحة الذي تسببه نافذة
 * البصمة نفسها حتى لا نحسبه غيابًا ونُعيد المطالبة.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { LockScreen } from './LockScreen'
import { clearHidden, isLockEnabled, markHidden, shouldRelock } from '@/core/appLock'
import { useProfile } from '@/app/hooks/useAuth'

export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => isLockEnabled())
  const [lockEpisode, setLockEpisode] = useState(0)
  const profile = useProfile()
  /** هل نافذة البصمة مفتوحة الآن؟ (يُبلّغها LockScreen) */
  const promptActiveRef = useRef(false)

  const lock = useCallback(() => {
    setLockEpisode((n) => n + 1)
    setLocked(true)
  }, [])

  const unlock = useCallback(() => {
    clearHidden()
    setLocked(false)
  }, [])

  const handlePromptActiveChange = useCallback((active: boolean) => {
    promptActiveRef.current = active
  }, [])

  useEffect(() => {
    const onHide = () => {
      // غياب تسببت به نافذة البصمة نفسها ← لا يُحتسب (وإلا طالبناك من جديد عند الرجوع)
      if (promptActiveRef.current) return
      if (isLockEnabled()) markHidden()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        onHide()
        return
      }
      if (isLockEnabled() && shouldRelock()) lock()
    }
    const onPageHide = () => onHide()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [lock])

  // إذا أُلغي القفل من الإعدادات فلا نُبقي الشاشة مقفلة
  useEffect(() => {
    if (locked && !isLockEnabled()) setLocked(false)
  }, [locked])

  if (!locked) return <>{children}</>

  return (
    <LockScreen
      key={lockEpisode}
      onUnlocked={unlock}
      onPromptActiveChange={handlePromptActiveChange}
      userName={profile.data?.fullName ?? null}
    />
  )
}
