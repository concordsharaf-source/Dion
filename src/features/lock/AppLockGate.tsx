/**
 * حارس القفل: يمنع رؤية أي شاشة داخل التطبيق قبل الفتح.
 *   · يُقفل عند كل تشغيل (الفتح مرة واحدة لكل جلسة تطبيق)
 *   · يُقفل عند العودة للتطبيق بعد غياب أطول من مدة السماح
 *   · لا يفعل شيئًا إن لم يكن القفل مفعّلًا (التطبيق يعمل كالمعتاد)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LockScreen } from './LockScreen'
import { clearHidden, isLockEnabled, markHidden, shouldRelock } from '@/core/appLock'
import { useProfile } from '@/app/hooks/useAuth'

export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => isLockEnabled())
  const profile = useProfile()

  const unlock = useCallback(() => {
    clearHidden()
    setLocked(false)
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (isLockEnabled()) markHidden()
        return
      }
      if (isLockEnabled() && shouldRelock()) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', () => {
      if (isLockEnabled()) markHidden()
    })
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // إذا أُلغي القفل من الإعدادات فلا نُبقي الشاشة مقفلة
  useEffect(() => {
    if (locked && !isLockEnabled()) setLocked(false)
  }, [locked])

  if (!locked) return <>{children}</>

  return <LockScreen onUnlocked={unlock} userName={profile.data?.fullName ?? null} />
}
