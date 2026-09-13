import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, Timer } from 'lucide-react'
import type { DataSource } from '@/data/port'
import { loadDataSource, dataSourceKind } from '@/data/load'
import { queryClient, qk } from './queryClient'

interface Ctx {
  ds: DataSource
}

const DataSourceContext = createContext<Ctx | null>(null)

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<DataSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadDataSource()
      .then((source) => {
        if (alive) setDs(source)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'تعذّر تشغيل طبقة البيانات')
      })
    return () => {
      alive = false
    }
  }, [])

  // الجسر اللحظي: أي حدث من طبقة البيانات يُبطل الاستعلامات المتأثرة
  useEffect(() => {
    if (!ds) return
    const unsubscribe = ds.subscribe((event) => {
      switch (event.table) {
        case 'entries':
          void queryClient.invalidateQueries({ queryKey: ['entries'] })
          void queryClient.invalidateQueries({ queryKey: ['party-entries'] })
          void queryClient.invalidateQueries({ queryKey: ['parties'] })
          break
        case 'parties':
          void queryClient.invalidateQueries({ queryKey: ['parties'] })
          void queryClient.invalidateQueries({ queryKey: ['party'] })
          break
        case 'notifications':
          void queryClient.invalidateQueries({ queryKey: qk.unread })
          void queryClient.invalidateQueries({ queryKey: ['notifications'] })
          break
        case 'link_requests':
          void queryClient.invalidateQueries({ queryKey: qk.linkRequests })
          break
        case 'relationships':
        case 'balance_proposals':
          void queryClient.invalidateQueries({ queryKey: qk.relationships })
          void queryClient.invalidateQueries({ queryKey: qk.proposals })
          void queryClient.invalidateQueries({ queryKey: ['parties'] })
          void queryClient.invalidateQueries({ queryKey: ['entries'] })
          break
        case 'profile':
          void queryClient.invalidateQueries({ queryKey: qk.profile })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [ds])

  const value = useMemo(() => (ds ? { ds } : null), [ds])

  if (error) {
    return (
      <div className="app-shell items-center justify-center p-6 text-center">
        <p className="font-bold text-danger-600">تعذّر بدء التطبيق</p>
        <p className="mt-2 text-sm leading-6 text-ink-500">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn btn-primary mt-5 inline-flex h-11 items-center gap-2 px-6 text-[0.9375rem] font-extrabold"
        >
          <RefreshCw size={17} /> إعادة المحاولة
        </button>
      </div>
    )
  }

  if (!value) return <BootSplash />

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>
}

export function useDataSource(): DataSource {
  const ctx = useContext(DataSourceContext)
  if (!ctx) throw new Error('useDataSource خارج المزوّد')
  return ctx.ds
}

export function useDataSourceKind(): 'local' | 'supabase' {
  return dataSourceKind()
}

/** بعد هذه المدة نعرض للمستخدم مخرجًا بدل شاشة بداية بلا نهاية */
export const SPLASH_TIMEOUT_MS = 6_000

/** هل تأخّر الإقلاع بما يستوجب إظهار مخرج للمستخدم؟ (دالة نقية للاختبار) */
export function isBootStuck(elapsedMs: number, timeoutMs: number = SPLASH_TIMEOUT_MS): boolean {
  return elapsedMs >= timeoutMs
}

/**
 * شاشة بداية (Splash) بألوان التطبيق — تُعرض بلا أي وميض أبيض.
 * لا تبقى بلا نهاية: بعد مدة قصيرة تظهر رسالة وإعادة محاولة.
 */
export function BootSplash() {
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setStuck(true), SPLASH_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="app-shell">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <img src="/icons/icon-192.png" alt="" width={88} height={88} className="rounded-3xl shadow-float" />
        <h1 className="text-2xl font-extrabold text-brand-700 dark:text-brand-300">دفتر الديون</h1>
        <p className="text-sm text-ink-500">دفتر بسيط لإدارة الديون والسداد</p>

        {stuck ? (
          <div className="mt-4 space-y-3">
            <p className="flex items-center justify-center gap-2 text-[0.8125rem] font-bold text-ink-600 dark:text-ink-300">
              <Timer size={16} /> يستغرق التطبيق وقتًا أطول من المعتاد
            </p>
            <p className="max-w-xs text-[0.75rem] leading-6 text-ink-500">
              إن كان التطبيق مفتوحًا في تبويب آخر، فأغلقه ثم اضغط إعادة المحاولة.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn btn-primary inline-flex h-11 items-center gap-2 px-6 text-[0.9375rem] font-extrabold"
            >
              <RefreshCw size={17} /> إعادة المحاولة
            </button>
          </div>
        ) : (
          <div className="mt-4 h-1 w-40 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-500" />
          </div>
        )}
      </div>
    </div>
  )
}
