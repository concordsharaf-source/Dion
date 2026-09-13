import { NavLink } from 'react-router-dom'
import { Bell, Home, ListOrdered, Settings, Store, Users } from 'lucide-react'
import clsx from 'clsx'
import { useProfile } from '../hooks/useAuth'
import { useAwaitingCount, useUnreadCount } from '../hooks/useData'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  badge?: number
}

export function BottomNav() {
  const profile = useProfile()
  const unread = useUnreadCount()
  const awaiting = useAwaitingCount()

  const isMerchant = profile.data?.role === 'merchant'
  const partiesLabel = isMerchant ? 'العملاء' : 'المحلات'
  const PartiesIcon = isMerchant ? Users : Store

  const items: NavItem[] = [
    { to: '/', label: 'الرئيسية', icon: Home },
    { to: '/parties', label: partiesLabel, icon: PartiesIcon },
    { to: '/entries', label: 'العمليات', icon: ListOrdered, badge: awaiting.data ?? 0 },
    { to: '/notifications', label: 'الإشعارات', icon: Bell, badge: unread.data ?? 0 },
    { to: '/settings', label: 'الإعدادات', icon: Settings },
  ]

  return (
    <nav
      className={clsx(
        'fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[30rem]',
        'border-t border-ink-200/80 bg-ink-50/95 backdrop-blur-xl',
        'dark:border-ink-800 dark:bg-ink-950/95',
      )}
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      aria-label="التنقل الرئيسي"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'relative flex min-h-[3.75rem] flex-col items-center justify-center gap-1 text-[0.6875rem] font-bold transition',
                  isActive ? 'text-brand-600 dark:text-brand-300' : 'text-ink-500 dark:text-ink-400',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <item.icon size={22} strokeWidth={isActive ? 2.4 : 1.9} />
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute -end-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger-500 px-1 text-[0.625rem] font-extrabold text-white">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span>{item.label}</span>
                  {isActive ? <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-300" /> : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
