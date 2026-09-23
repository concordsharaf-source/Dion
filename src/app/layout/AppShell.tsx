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

  // العودة لأعلى الصفحة عند تغيير المسار — بحرس: بعض المحركات/البيئات لا
  // تنفّذ Element.scrollTo (jsdom في الاختبارات مثلًا)، فنسقط إلى scrollTop.
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.app-scroll')
    if (!scroller) return
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: 0, behavior: 'auto' })
    else scroller.scrollTop = 0
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
