import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { ExitGuard } from './ExitGuard'
import { useEffect } from 'react'

/**
 * هيكل التطبيق: عمود بعرض الهاتف، شريط علوي لكل شاشة، وتنقل سفلي ثابت
 * يعالج شريط الحالة ومساحة الأمان أسفل الشاشة.
 */
export function AppShell() {
  const location = useLocation()

  // العودة لأعلى الصفحة عند تغيير المسار
  useEffect(() => {
    document.querySelector<HTMLElement>('.app-scroll')?.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className="app-shell app-shell-main">
      <main className="app-scroll">
        <Outlet />
      </main>
      <BottomNav />
      {/* حارس الخروج: الرجوع من الرئيسية لا يُخرج إلا بتأكيد */}
      <ExitGuard />
    </div>
  )
}
