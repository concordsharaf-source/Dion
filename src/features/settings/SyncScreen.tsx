import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Cloud, HardDrive, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react'
import clsx from 'clsx'
import { Card, EmptyState, Money, SectionTitle, Skeletons } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { Button, useToast } from '@/components/ui'
import { useDataSource } from '@/app/DataSourceProvider'
import { useEntries, useSyncState } from '@/app/hooks/useData'
import { useProfile } from '@/app/hooks/useAuth'
import { formatDateTimeAr, formatRelativeAr } from '@/core/datetime'
import { queryClient } from '@/app/queryClient'
import { toUserMessage } from '@/core/errors'

/**
 * حالة المزامنة: تُظهر بوضوح ما هو مُرسل وما ينتظر الاتصال.
 * العمليات غير المُرسلة تظهر «بانتظار الاتصال والمزامنة» ولا تُعدّ مؤكدة في حساب الطرف الآخر.
 */
export function SyncScreen() {
  const ds = useDataSource()
  const sync = useSyncState()
  const entries = useEntries({ status: 'all', limit: 500 })
  const profile = useProfile()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const pending = (entries.data?.items ?? []).filter((e) => e.pendingSync)
  const local = ds.kind === 'local'
  const currency = profile.data?.currency ?? 'YER'

  async function syncNow() {
    setBusy(true)
    try {
      const result = await ds.sync.sync()
      await queryClient.invalidateQueries()
      toast.show(
        result.failed > 0
          ? `تمت المزامنة مع ${result.failed} عملية أخفقت — ستعاد المحاولة`
          : 'تمت المزامنة',
        result.failed > 0 ? 'error' : 'ok',
      )
    } catch (e) {
      toast.show(toUserMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-6">
      <PageHeader title="حالة المزامنة" />

      <div className="space-y-4 px-4 pt-4">
        <Card className={clsx(local ? 'border-none bg-ink-800 text-white' : 'border-none bg-gradient-to-bl from-brand-600 to-brand-800 text-white')}>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
              {local ? <HardDrive size={22} /> : sync.data?.online === false ? <WifiOff size={22} /> : <Cloud size={22} />}
            </span>
            <div className="flex-1">
              <p className="font-extrabold">{local ? 'وضع الجهاز (بلا خادم)' : sync.data?.online === false ? 'بلا اتصال' : 'متصل'}</p>
              <p className="text-[0.75rem] text-white/80">
                {local
                  ? 'كل بياناتك محفوظة على هذا الجهاز — لا تحتاج إنترنت'
                  : sync.data?.syncing
                    ? 'جارٍ المزامنة الآن...'
                    : sync.data?.lastSyncedAt
                      ? `آخر مزامنة: ${formatRelativeAr(sync.data.lastSyncedAt)}`
                      : 'لم تحدث مزامنة بعد'}
              </p>
            </div>
          </div>

          {!local ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/12 p-3">
                <p className="text-[0.6875rem] text-white/75">بانتظار الإرسال</p>
                <p className="mt-0.5 text-lg font-extrabold tnum">{sync.data?.pendingCount ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-white/12 p-3">
                <p className="text-[0.6875rem] text-white/75">آخر خطأ</p>
                <p className="mt-0.5 truncate text-[0.75rem] font-bold">{sync.data?.lastError ?? 'لا يوجد'}</p>
              </div>
            </div>
          ) : null}

          {!local ? (
            <Button block variant="soft" className="mt-4" loading={busy} icon={<RefreshCw size={16} />} onClick={() => void syncNow()}>
              مزامنة الآن
            </Button>
          ) : null}
        </Card>

        {!local ? (
          <div className="flex items-start gap-2.5 rounded-2xl bg-ink-200/50 p-3.5 text-[0.75rem] leading-5 text-ink-600 dark:bg-ink-900 dark:text-ink-300">
            <ShieldCheck size={17} className="mt-0.5 shrink-0" />
            <span>
              العملية المكتوبة بلا اتصال تبقى «بانتظار الاتصال والمزامنة» ولا تظهر للطرف الآخر ولا تُحتسب في رصيده حتى
              تُرسل بنجاح. لا إرسال مزدوج: لكل عملية معرّف من الجهاز يمنع تكرارها.
            </span>
          </div>
        ) : null}

        <section>
          <SectionTitle>عمليات بانتظار الإرسال</SectionTitle>
          {entries.isLoading ? (
            <Skeletons count={2} height={60} />
          ) : pending.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Cloud size={24} />}
                title="لا شيء بانتظار الإرسال"
                hint={local ? 'في وضع الجهاز كل شيء محفوظ فورًا ومؤكد محليًا.' : 'كل عملياتك مُرسلة إلى الخادم.'}
              />
            </Card>
          ) : (
            <Card className="divide-y divide-ink-200/70 p-0 dark:divide-ink-800/70">
              {pending.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-bold">
                      {e.entryType === 'debt' ? 'دين' : 'سداد'} {e.details ? `· ${e.details}` : ''}
                    </p>
                    <p className="text-[0.6875rem] text-gold-700 dark:text-gold-300">
                      بانتظار الاتصال والمزامنة · {formatDateTimeAr(e.createdAt)}
                    </p>
                  </div>
                  <Money minor={e.amountMinor} currency={currency} className="shrink-0 font-extrabold" />
                </div>
              ))}
            </Card>
          )}
        </section>

        <p className="px-1 pb-4 text-[0.6875rem] leading-5 text-ink-500">
          لمزيد من التفاصيل عن آلية المزامنة والخصوصية راجع{' '}
          <Link to="/settings/privacy" className="font-bold text-brand-600 underline">
            الخصوصية والأمان
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
