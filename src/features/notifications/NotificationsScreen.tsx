import { useNavigate } from 'react-router-dom'
import {
  BellOff,
  BadgeCheck,
  CircleSlash,
  Link2,
  Link2Off,
  RotateCcw,
  Scale,
  Wallet,
  XCircle,
} from 'lucide-react'
import clsx from 'clsx'
import { Button, Card, EmptyState, Skeletons, useToast } from '@/components/ui'
import { useDataSource } from '@/app/DataSourceProvider'
import { useNotifications, useUnreadCount } from '@/app/hooks/useData'
import { formatRelativeAr } from '@/core/datetime'
import { queryClient } from '@/app/queryClient'
import type { NotificationKind } from '@/core/domain'

const ICONS: Record<NotificationKind, typeof Wallet> = {
  entry_created: Wallet,
  entry_confirmed: BadgeCheck,
  entry_rejected: XCircle,
  entry_cancelled: CircleSlash,
  entry_reversal: RotateCcw,
  link_request: Link2,
  link_accepted: Link2,
  link_rejected: Link2Off,
  link_established: Link2,
  balance_proposal: Scale,
  balance_accepted: BadgeCheck,
  balance_declined: XCircle,
  sync: RotateCcw,
}

export function NotificationsScreen() {
  const ds = useDataSource()
  const navigate = useNavigate()
  const toast = useToast()
  const notifications = useNotifications()
  const unread = useUnreadCount()

  async function markAll() {
    await ds.notifications.markAllRead()
    await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    toast.show('تم تعليم الكل كمقروء')
  }

  async function open(id: string, refType: string | null, refId: string | null) {
    await ds.notifications.markRead(id)
    await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    if (refType === 'entry' && refId) navigate(`/entries?entryId=${encodeURIComponent(refId)}`)
    else if (refType === 'party' && refId) navigate(`/parties/${refId}`)
    else if (refType === 'relationship' && refId) navigate(`/link/${refId}`)
    else if (refType === 'link') navigate('/link')
    else navigate('/notifications')
  }

  return (
    <div className="pb-4">
      <header className="app-bar pt-safe">
        <div className="flex-1">
          <h1 className="text-[1.0625rem] font-extrabold">الإشعارات</h1>
          <p className="text-[0.6875rem] text-ink-500">{unread.data ? `${unread.data} غير مقروء` : 'كل الإشعارات مقروءة'}</p>
        </div>
        {unread.data ? (
          <button
            type="button"
            onClick={() => void markAll()}
            className="rounded-xl bg-ink-200/70 px-3 py-1.5 text-[0.6875rem] font-bold text-ink-700 dark:bg-ink-800 dark:text-ink-200"
          >
            تعليم الكل كمقروء
          </button>
        ) : null}
      </header>

      <div className="space-y-3 px-4 pt-3">
        {notifications.isLoading ? (
          <Skeletons count={4} height={72} />
        ) : (notifications.data?.items.length ?? 0) === 0 ? (
          <Card>
            <EmptyState
              icon={<BellOff size={26} />}
              title="لا توجد إشعارات"
              hint="ستظهر هنا تأكيدات العمليات، طلبات الربط، والتنبيهات المهمة."
            />
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {notifications.data!.items.map((n) => {
              const Icon = ICONS[n.kind] ?? Wallet
              const isUnread = !n.readAt
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void open(n.id, n.refType, n.refId)}
                    className={clsx(
                      'flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start transition active:scale-[0.99]',
                      isUnread
                        ? 'border-brand-200 bg-brand-50/70 dark:border-brand-800/50 dark:bg-brand-900/20'
                        : 'border-ink-200/70 bg-white dark:border-ink-800/70 dark:bg-ink-900',
                    )}
                  >
                    <span
                      className={clsx(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-2xl',
                        isUnread ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
                      )}
                    >
                      <Icon size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="flex-1 text-[0.875rem] font-bold leading-6">{n.title}</span>
                        {isUnread ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-danger-500" /> : null}
                      </span>
                      {n.body ? <span className="mt-0.5 block text-[0.75rem] leading-5 text-ink-500">{n.body}</span> : null}
                      <span className="mt-1 block text-[0.6875rem] text-ink-400">{formatRelativeAr(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {(notifications.data?.hasMore ?? false) ? (
          <Button
            block
            variant="ghost"
            loading={notifications.isFetching}
            onClick={() => {
              void notifications.refetch()
            }}
          >
            تحديث
          </Button>
        ) : null}
      </div>
    </div>
  )
}
