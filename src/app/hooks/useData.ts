import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataSource } from '../DataSourceProvider'
import { qk } from '../queryClient'
import { useProfile } from './useAuth'
import type { CreateEntryDTO, CreatePartyDTO, EntryQuery, PartyQuery } from '@/data/port'
import { uuid } from '@/core/id'
import { filterAndSortParties, summarizeParties, type FilterOptions } from '@/core/balance'
import { useMemo } from 'react'

/* ============================ الأطراف ============================ */

export function useParties(query: PartyQuery = {}) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.parties(query),
    queryFn: () => ds.parties.list(query),
  })
}

export function useParty(id: string | undefined) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.party(id ?? ''),
    queryFn: () => (id ? ds.parties.get(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  })
}

export function usePartyEntries(partyId: string | undefined) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.partyEntries(partyId ?? ''),
    queryFn: () => (partyId ? ds.entries.listByParty(partyId) : Promise.resolve([])),
    enabled: Boolean(partyId),
  })
}

/* ============================ العمليات ============================ */

export function useEntries(query: EntryQuery = {}) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.entries(query),
    queryFn: () => ds.entries.list(query),
  })
}

export function useEntry(id: string | undefined) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.entry(id ?? ''),
    queryFn: () => (id ? ds.entries.get(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  })
}

export function useAwaitingCount() {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.awaiting,
    queryFn: () => ds.entries.countAwaitingMe(),
    refetchInterval: 30_000,
  })
}

/* ============================ الإشعارات ============================ */

export function useNotifications(unreadOnly = false) {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.notifications({ unreadOnly }),
    queryFn: () => ds.notifications.list({ unreadOnly, limit: 100 }),
  })
}

export function useUnreadCount() {
  const ds = useDataSource()
  return useQuery({
    queryKey: qk.unread,
    queryFn: () => ds.notifications.unreadCount(),
    refetchInterval: 30_000,
  })
}

/* ============================ الربط ============================ */

export function useLinkRequests() {
  const ds = useDataSource()
  return useQuery({ queryKey: qk.linkRequests, queryFn: () => ds.links.listRequests() })
}

export function useRelationships() {
  const ds = useDataSource()
  return useQuery({ queryKey: qk.relationships, queryFn: () => ds.links.listRelationships() })
}

export function useBalanceProposals() {
  const ds = useDataSource()
  return useQuery({ queryKey: qk.proposals, queryFn: () => ds.links.listBalanceProposals() })
}

export function useSyncState() {
  const ds = useDataSource()
  return useQuery({ queryKey: qk.sync, queryFn: async () => ds.sync.state(), refetchInterval: 20_000 })
}

/* ============================ عمليات الكتابة ============================ */

function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['parties'] })
    void queryClient.invalidateQueries({ queryKey: ['party'] })
    void queryClient.invalidateQueries({ queryKey: ['entries'] })
    void queryClient.invalidateQueries({ queryKey: ['party-entries'] })
    void queryClient.invalidateQueries({ queryKey: qk.awaiting })
    void queryClient.invalidateQueries({ queryKey: qk.unread })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: qk.linkRequests })
    void queryClient.invalidateQueries({ queryKey: qk.relationships })
    void queryClient.invalidateQueries({ queryKey: qk.proposals })
  }
}

export function useCreateParty() {
  const ds = useDataSource()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: CreatePartyDTO) => ds.parties.create(input),
    onSuccess: invalidate,
  })
}

export function useUpdateParty() {
  const ds = useDataSource()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreatePartyDTO> }) => ds.parties.update(id, patch),
    onSuccess: invalidate,
  })
}

export function useArchiveParty() {
  const ds = useDataSource()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      archive ? ds.parties.archive(id) : ds.parties.unarchive(id),
    onSuccess: invalidate,
  })
}

export function useCreateEntry() {
  const ds = useDataSource()
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: Omit<CreateEntryDTO, 'clientRef'> & { clientRef?: string }) =>
      ds.entries.create({ ...input, clientRef: input.clientRef ?? uuid() }),
    onSuccess: invalidate,
  })
}

export function useEntryActions() {
  const ds = useDataSource()
  const invalidate = useInvalidateAll()
  return {
    confirm: useMutation({ mutationFn: (id: string) => ds.entries.confirm(id), onSuccess: invalidate }),
    reject: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason?: string | null }) => ds.entries.reject(id, reason),
      onSuccess: invalidate,
    }),
    cancel: useMutation({ mutationFn: (id: string) => ds.entries.cancel(id), onSuccess: invalidate }),
    reverse: useMutation({
      mutationFn: ({ id, note }: { id: string; note?: string | null }) => ds.entries.reverse(id, note),
      onSuccess: invalidate,
    }),
  }
}

/* ============================ مشتقّات ============================ */

/** يبني ملخصات الأطراف مع البحث والترتيب */
export function useFilteredParties(options: FilterOptions) {
  const profile = useProfile()
  const partiesQuery = useParties({ includeArchived: true, limit: 500 })
  const entriesQuery = useEntries({ status: 'all', limit: 1000 })
  const viewerId = profile.data?.id ?? ''

  const summaries = useMemo(() => {
    if (!partiesQuery.data || !entriesQuery.data || !viewerId) return []
    return summarizeParties(partiesQuery.data.items, entriesQuery.data.items, viewerId)
  }, [partiesQuery.data, entriesQuery.data, viewerId])

  const filtered = useMemo(() => filterAndSortParties(summaries, options), [summaries, options])

  return {
    items: filtered,
    all: summaries,
    isLoading: partiesQuery.isLoading || entriesQuery.isLoading,
    isError: partiesQuery.isError || entriesQuery.isError,
    refetch: async () => {
      await Promise.all([partiesQuery.refetch(), entriesQuery.refetch()])
    },
  }
}
