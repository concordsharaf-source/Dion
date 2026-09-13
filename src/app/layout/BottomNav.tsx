import { NavLink } from 'react-router-dom'
import { Bell, Home, LayoutList, Settings, Users } from 'lucide-react'
import clsx from 'clsx'
import { useProfile } from '@/app/hooks/useAuth'
import { useAwaitingCount, useUnreadCount } from '@/app/hooks/useData'

/**
 * التنقل السفلي — خمس تابات كبيرة كما في تطبيقات أندرويد.
 * العميل: الرئيسية · الديون · العمليات · الإشعارات · الإعدادات
 * التاجر: الرئيسية · العملاء · العمليات · الإشعارات · الإعدادات
 */
export function BottomNav() {
  const profile = useProfile()
  const unread = useUnreadCount()
  const awaiting = useAwaitingCount()
  const role = profile.data?.role ?? 'customer'

  const tabs = [
    { to: '/', label: 'الرئيسية', icon: Home, badge: 0 },
    {
      to: '/parties',
      label: role === 'merchant' ? 'العملاء' : 'الديون',
      icon: Users,
      badge: 0,
    },
    { to: '/entries', label: 'العمليات', icon: LayoutList, badge: awaiting.data ?? 0 },
    { to: '/notifications', label: 'الإشعارات', icon: Bell, badge: unread.data ?? 0 },
    { to: '/settings', label: 'الإعدادات', icon: Settings, badge: 0 },
  ]

  return (
    <nav className="app-nav pb-safe" aria-label="التنقل الرئيسي">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')}
        >
          <span className="relative">
            <tab.icon size={22} strokeWidth={2.2} />
            {tab.badge > 0 ? (
              <span className="absolute -end-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[0.625rem] font-bold text-white">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
          </span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
