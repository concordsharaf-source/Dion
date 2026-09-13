import { Component, useEffect, useState, type ReactNode } from 'react'
import { createHashRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { queryClient } from './queryClient'
import { BootSplash, DataSourceProvider } from './DataSourceProvider'
import { useProfile, useSession } from './hooks/useAuth'
import { rememberPendingRoute } from './pendingRoute'
import { ToastProvider, useToast } from '@/components/ui'
import { AppShell } from './layout/AppShell'
import { WelcomeScreen } from '@/features/auth/WelcomeScreen'
import { SetupScreen } from '@/features/auth/SetupScreen'
import { SignInScreen, SignUpScreen } from '@/features/auth/SignInScreen'
import { HomeScreen } from '@/features/home/HomeScreen'
import { PartiesScreen } from '@/features/parties/PartiesScreen'
import { PartyFormScreen } from '@/features/parties/PartyFormScreen'
import { PartyDetailScreen } from '@/features/parties/PartyDetailScreen'
import { EntriesScreen } from '@/features/entries/EntriesScreen'
import { NotificationsScreen } from '@/features/notifications/NotificationsScreen'
import { LinkScreen } from '@/features/linking/LinkScreen'
import { LinkScanScreen } from '@/features/linking/LinkScanScreen'
import { RelationshipDetailScreen } from '@/features/linking/RelationshipDetailScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { ProfileScreen } from '@/features/settings/ProfileScreen'
import { SecurityScreen } from '@/features/settings/SecurityScreen'
import { SyncScreen } from '@/features/settings/SyncScreen'
import { PrivacyScreen } from '@/features/settings/PrivacyScreen'
import { BackupScreen } from '@/features/settings/BackupScreen'
import { useDailyBackupRunner } from './hooks/useBackup'

/* ============================ حراسة المسارات ============================ */

/** يتطلب جلسة — وإلا يعود للبداية مع تذكّر الوجهة */
function RequireSession() {
  const session = useSession()
  const location = useLocation()

  useEffect(() => {
    if (session.data === null) rememberPendingRoute(location.pathname + location.search)
  }, [session.data, location.pathname, location.search])

  // لا نوجّه أثناء التحقق من الجلسة (أول تحميل أو إعادة جلب بعد الدخول)
  if (session.isLoading || (session.isFetching && !session.data)) return <BootSplash />
  if (!session.data) return <Navigate to="/welcome" replace />
  return <Outlet />
}

/** يتطلب ملفًا شخصيًا مكتملًا (اختيار الدور) */
function RequireProfile() {
  const profile = useProfile()
  if (profile.isLoading) return <BootSplash />
  if (!profile.data) return <Navigate to="/setup" replace />
  return <Outlet />
}

/* ============================ حارس النسخة اليومية ============================ */

/**
 * يأخذ نسخة احتياطية تلقائية للتاجر في نهاية كل يوم (وتستبدل نسخة الأمس)،
 * وعند إخفاء التطبيق، وعند حلول منتصف الليل — بلا أي تدخل من المستخدم.
 */
function BackupWatcher() {
  const toast = useToast()
  useDailyBackupRunner(() => {
    toast.show('تم أخذ نسخة احتياطية تلقائية لليوم', 'info')
  })
  return null
}

/* ============================ شريط انقطاع الاتصال ============================ */

function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false)

  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (!offline) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-gold-500 px-3 py-1.5 text-center text-[0.6875rem] font-bold text-white">
      <span className="inline-flex items-center gap-1.5">
        <WifiOff size={12} /> بلا اتصال — تابع التسجيل عاديًا، وستُزامن عملياتك تلقائيًا
      </span>
    </div>
  )
}

/* ============================ حدود الأخطاء ============================ */

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell items-center justify-center p-6 text-center">
          <p className="text-lg font-extrabold text-danger-600">حدث خطأ غير متوقع</p>
          <p className="mt-2 text-[0.8125rem] text-ink-500">بياناتك محفوظة. جرّب إعادة تحميل التطبيق.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-primary mt-5 h-11 px-6 text-[0.9375rem] font-extrabold"
          >
            إعادة التحميل
          </button>
          <p className="mt-4 max-w-xs break-words text-[0.625rem] text-ink-400" dir="ltr">
            {this.state.error.message}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

/* ============================ الشاشات المستقلة ============================ */

function NotFoundScreen() {
  return (
    <div className="app-shell items-center justify-center p-6 text-center">
      <p className="text-lg font-extrabold">الصفحة غير موجودة</p>
      <p className="mt-2 text-[0.8125rem] text-ink-500">الرابط الذي فتحته غير صحيح أو تغيّر.</p>
      <a href="#/" className="btn btn-primary mt-5 h-11 px-6 text-[0.9375rem] font-extrabold">
        العودة للرئيسية
      </a>
    </div>
  )
}

/* ============================ المسارات ============================ */

const router = createHashRouter([
  { path: '/welcome', element: <WelcomeScreen /> },
  { path: '/signin', element: <SignInScreen /> },
  { path: '/signup', element: <SignUpScreen /> },
  { path: '/setup', element: <SetupScreen /> },

  {
    element: <RequireSession />,
    children: [
      // مسح رمز الربط: بلا شريط سفلي
      { path: '/link/scan', element: <LinkScanScreen /> },
      {
        element: <RequireProfile />,
        children: [
          {
            path: '/',
            element: <AppShell />,
            children: [
              { index: true, element: <HomeScreen /> },
              { path: 'parties', element: <PartiesScreen /> },
              { path: 'parties/new', element: <PartyFormScreen /> },
              { path: 'parties/:id', element: <PartyDetailScreen /> },
              { path: 'parties/:id/edit', element: <PartyFormScreen /> },
              { path: 'entries', element: <EntriesScreen /> },
              { path: 'notifications', element: <NotificationsScreen /> },
              { path: 'link', element: <LinkScreen /> },
              { path: 'link/:id', element: <RelationshipDetailScreen /> },
              { path: 'settings', element: <SettingsScreen /> },
              { path: 'settings/profile', element: <ProfileScreen /> },
              { path: 'settings/security', element: <SecurityScreen /> },
              { path: 'settings/sync', element: <SyncScreen /> },
              { path: 'settings/privacy', element: <PrivacyScreen /> },
              { path: 'settings/backup', element: <BackupScreen /> },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundScreen /> },
])

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DataSourceProvider>
          <ToastProvider>
            <OfflineBanner />
            <BackupWatcher />
            <RouterProvider router={router} />
          </ToastProvider>
        </DataSourceProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
