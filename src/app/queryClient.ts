import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        // لا نعيد المحاولة على أخطاء الصلاحيات أو المدخلات
        const code = (error as { code?: string })?.code
        if (code && ['unauthorized', 'forbidden', 'not_found', 'validation', 'invalid_amount'].includes(code)) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
})

/** مفاتيح الاستعلام — مركزية لتسهيل الإبطال عند Realtime */
export const qk = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  parties: (filters?: unknown) => ['parties', filters ?? {}] as const,
  party: (id: string) => ['party', id] as const,
  entries: (filters?: unknown) => ['entries', filters ?? {}] as const,
  entry: (id: string) => ['entry', id] as const,
  partyEntries: (partyId: string) => ['party-entries', partyId] as const,
  awaiting: ['entries', 'awaiting'] as const,
  notifications: (filters?: unknown) => ['notifications', filters ?? {}] as const,
  unread: ['notifications', 'unread'] as const,
  linkRequests: ['link-requests'] as const,
  relationships: ['relationships'] as const,
  proposals: ['balance-proposals'] as const,
  sync: ['sync'] as const,
  backup: ['backup'] as const,
  backupAuto: ['backup-auto'] as const,
}
