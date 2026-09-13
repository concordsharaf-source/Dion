/**
 * المحرّك السحابي — Supabase (PostgreSQL + Auth + Realtime)
 *
 * يُحمَّل فقط عند وجود مفاتيح VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 * يُنفّذ نفس عقد `DataSource` تمامًا، لذا الواجهة لا تعرف أي فرق بين المحرّكين.
 *
 * مبادئ مهمة:
 *   · لا يوجد أي مفتاح سري هنا: مفتاح anon فقط، وكل الحماية من RLS + دوال SECURITY DEFINER.
 *   · كل الكتابات المالية تمرّ عبر RPC (create_entry / confirm_entry / ...) ولا تُكتب الجداول مباشرة.
 *   · الكتابة أثناء انقطاع الاتصال تُحفظ في طابور محلي (IndexedDB) وتظهر «بانتظار المزامنة»،
 *     ولا تُعتبر مؤكدة عند الطرف الآخر حتى تصل وتُعتمد.
 *   · منع الإرسال المزدوج: `client_ref` فريد لكل (منشئ، مرجع) على مستوى قاعدة البيانات.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthPort,
  AuthSession,
  CreateEntryDTO,
  CreatePartyDTO,
  DataEvent,
  DataSource,
  RestoreResult,
  EntryPort,
  EntryQuery,
  LinkPort,
  LinkPreview,
  NotificationPort,
  NotificationQuery,
  Page,
  PartyPort,
  PartyQuery,
  SignUpInput,
  SignUpResult,
  SyncPort,
  SyncResult,
  SyncState,
} from '../port'
import type {
  AppNotification,
  BalanceProposal,
  EntryKind,
  EntryScope,
  EntryStatus,
  EntryType,
  FinancialEntry,
  LinkRequest,
  LinkStatus,
  Party,
  PartyKind,
  Profile,
  Relationship,
  Role,
} from '@/core/domain'
import { appError, type ErrorCode } from '@/core/errors'
import { uuid } from '@/core/id'
import { normalizeArabic } from '@/core/balance'
import { tokenToCode } from '@/core/qr'
import type { BackupPayload } from '@/core/backup'
import { getDB, type OutboxRow } from '../local/db'

type Row = Record<string, unknown>

const LAST_SYNC_KEY = 'dafatar.lastSyncedAt'

/* ============================ التحويلات ============================ */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))
const iso = (v: unknown): string => (typeof v === 'string' ? v : new Date().toISOString())

function toProfile(r: Row): Profile {
  return {
    id: str(r.id),
    role: (str(r.role) || 'customer') as Role,
    roles: [(str(r.role) || 'customer') as Role],
    fullName: str(r.full_name),
    phone: strOrNull(r.phone),
    currency: str(r.currency) || 'YER',
    theme: (str(r.theme) || 'system') as Profile['theme'],
    numerals: (str(r.numerals) || 'latin') as Profile['numerals'],
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

function toParty(r: Row): Party {
  return {
    id: str(r.id),
    ownerId: str(r.owner_id),
    kind: (str(r.kind) || 'customer') as PartyKind,
    name: str(r.name),
    phone: strOrNull(r.phone),
    address: strOrNull(r.address),
    note: strOrNull(r.note),
    searchKey: str(r.search_key),
    linkedUserId: strOrNull(r.linked_user_id),
    linkedProfileName: strOrNull(r.linked_profile_name),
    relationshipId: strOrNull(r.relationship_id),
    linkStatus: (str(r.link_status) || 'none') as LinkStatus,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: strOrNull(r.archived_at),
  }
}

function toEntry(r: Row): FinancialEntry {
  return {
    id: str(r.id),
    scope: (str(r.scope) || 'solo') as EntryScope,
    entryType: (str(r.entry_type) || 'debt') as EntryType,
    entryKind: (str(r.entry_kind) || 'normal') as EntryKind,
    status: (str(r.status) || 'pending') as EntryStatus,
    amountMinor: num(r.amount_minor),
    currency: str(r.currency) || 'YER',
    details: strOrNull(r.details),
    note: strOrNull(r.note),
    reason: strOrNull(r.reason),
    occurredAt: iso(r.occurred_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    creatorId: str(r.creator_id),
    creatorRole: (str(r.creator_role) || 'customer') as Role,
    creatorName: strOrNull(r.creator_name),
    ownerId: strOrNull(r.owner_id),
    partyId: strOrNull(r.party_id),
    relationshipId: strOrNull(r.relationship_id),
    merchantUserId: strOrNull(r.merchant_user_id),
    customerUserId: strOrNull(r.customer_user_id),
    merchantPartyId: strOrNull(r.merchant_party_id),
    customerPartyId: strOrNull(r.customer_party_id),
    confirmedBy: strOrNull(r.confirmed_by),
    confirmedAt: strOrNull(r.confirmed_at),
    confirmedByName: strOrNull(r.confirmed_by_name),
    rejectedBy: strOrNull(r.rejected_by),
    rejectedAt: strOrNull(r.rejected_at),
    rejectedByName: strOrNull(r.rejected_by_name),
    cancelledAt: strOrNull(r.cancelled_at),
    reversesEntryId: strOrNull(r.reverses_entry_id),
    reversedByEntryId: strOrNull(r.reversed_by_entry_id),
    clientRef: str(r.client_ref),
    excludedFromBalance: Boolean(r.excluded_from_balance),
    excludedReason: (strOrNull(r.excluded_reason) as FinancialEntry['excludedReason']) ?? null,
    pendingSync: false,
  }
}

function toRelationship(r: Row): Relationship {
  return {
    id: str(r.id),
    merchantUserId: str(r.merchant_user_id),
    customerUserId: str(r.customer_user_id),
    merchantPartyId: strOrNull(r.merchant_party_id),
    customerPartyId: strOrNull(r.customer_party_id),
    merchantName: strOrNull(r.merchant_name),
    customerName: strOrNull(r.customer_name),
    status: (str(r.status) || 'verified') as Relationship['status'],
    openingBalanceStatus: (str(r.opening_balance_status) || 'none') as Relationship['openingBalanceStatus'],
    openingBalanceMinor: num(r.opening_balance_minor),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }
}

function toLinkRequest(r: Row): LinkRequest {
  const token = str(r.token)
  return {
    id: str(r.id),
    merchantUserId: str(r.merchant_user_id),
    merchantName: strOrNull(r.merchant_name),
    customerUserId: strOrNull(r.customer_user_id),
    customerName: strOrNull(r.customer_name),
    status: (str(r.status) || 'awaiting_scan') as LinkRequest['status'],
    token,
    code: token ? tokenToCode(token) : '',
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    usedAt: strOrNull(r.used_at),
    previousBalanceMinor: num(r.previous_balance_minor),
  }
}

function toProposal(r: Row): BalanceProposal {
  return {
    id: str(r.id),
    relationshipId: str(r.relationship_id),
    proposedBy: str(r.proposed_by),
    amountMinor: num(r.amount_minor),
    note: strOrNull(r.note),
    status: (str(r.status) || 'pending') as BalanceProposal['status'],
    respondedBy: strOrNull(r.responded_by),
    respondedAt: strOrNull(r.responded_at),
    createdAt: iso(r.created_at),
  }
}

function toNotification(r: Row): AppNotification {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    kind: str(r.kind) as AppNotification['kind'],
    title: str(r.title),
    body: strOrNull(r.body),
    refType: (strOrNull(r.ref_type) as AppNotification['refType']) ?? null,
    refId: strOrNull(r.ref_id),
    readAt: strOrNull(r.read_at),
    createdAt: iso(r.created_at),
  }
}

/* ============================ تحويل الأخطاء ============================ */

const CODE_MAP: Record<string, ErrorCode> = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  validation: 'validation',
  invalid_amount: 'invalid_amount',
  over_payment: 'over_payment',
  already_decided: 'already_decided',
  conflict: 'conflict',
  self_confirm: 'self_confirm',
  self_decide: 'self_confirm',
  self_link: 'self_link',
  already_linked: 'already_linked',
  link_expired: 'link_expired',
  link_used: 'link_used',
  link_invalid: 'link_invalid',
  profile_missing: 'not_found',
  not_confirmed: 'entry_locked',
  not_shared: 'validation',
  solo_not_cancellable: 'conflict',
  duplicate: 'duplicate',
  rate_limited: 'rate_limited',
}

function mapError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|network|load failed|abort/i.test(message)) throw appError('network')
  for (const key of Object.keys(CODE_MAP)) {
    if (message.includes(key)) throw appError(CODE_MAP[key]!)
  }
  throw appError('unknown', { raw: message })
}

/* ============================ الطابور المحلي ============================ */

interface QueuedWrite {
  id: string
  op: 'create_entry'
  payload: CreateEntryDTO & { creatorRole: Role; creatorName: string; sharedHint: boolean }
  userId: string
  clientRef: string
  createdAt: string
  attempts: number
  lastError: string | null
  status: 'queued' | 'sending' | 'failed'
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function readLastSynced(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch {
    return null
  }
}

function writeLastSynced(value: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, value)
  } catch {
    /* ignore */
  }
}

/* ============================ المحرّك ============================ */

export class SupabaseDataSource implements DataSource {
  readonly kind = 'supabase' as const
  readonly supportsShared = true

  private readonly client: SupabaseClient
  private userId: string | null = null
  private profile: Profile | null = null

  private readonly authListeners = new Set<(session: AuthSession | null) => void>()
  private readonly eventListeners = new Set<(event: DataEvent) => void>()
  private readonly syncListeners = new Set<(state: SyncState) => void>()
  private channel: ReturnType<SupabaseClient['channel']> | null = null
  private broadcast: BroadcastChannel | null = null

  private state: SyncState = {
    online: isOnline(),
    syncing: false,
    pendingCount: 0,
    lastSyncedAt: readLastSynced(),
    lastError: null,
  }

  constructor(client: SupabaseClient) {
    this.client = client

    void this.bootstrap()

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setState({ online: true }))
      window.addEventListener('offline', () => this.setState({ online: false }))
    }

    try {
      this.broadcast = new BroadcastChannel('dafatar-events')
      this.broadcast.onmessage = (e: MessageEvent<DataEvent>) => this.emitLocal(e.data)
    } catch {
      this.broadcast = null
    }
  }

  /* ---------------- الأساسيات ---------------- */

  private async bootstrap(): Promise<void> {
    const { data } = await this.client.auth.getSession()
    const user = data.session?.user
    this.userId = user?.id ?? null
    if (this.userId) {
      this.profile = await this.fetchProfile().catch(() => null)
      this.startRealtime()
    }
    await this.refreshOutboxCount()

    this.client.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user
      this.userId = nextUser?.id ?? null
      this.profile = null
      if (this.userId) {
        this.startRealtime()
        void this.fetchProfile().then((p) => {
          this.profile = p
        })
      } else {
        this.stopRealtime()
      }
      const mapped: AuthSession | null = nextUser
        ? { userId: nextUser.id, email: nextUser.email ?? null, createdAt: nextUser.created_at ?? new Date().toISOString() }
        : null
      this.authListeners.forEach((cb) => cb(mapped))
    })
  }

  private setState(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    this.syncListeners.forEach((cb) => cb(this.state))
  }

  private emit(event: DataEvent): void {
    this.eventListeners.forEach((cb) => cb(event))
    try {
      this.broadcast?.postMessage(event)
    } catch {
      /* ignore */
    }
  }

  private emitLocal(event: DataEvent): void {
    this.eventListeners.forEach((cb) => cb(event))
  }

  private async requireUserId(): Promise<string> {
    if (this.userId) return this.userId
    const { data } = await this.client.auth.getSession()
    const id = data.session?.user?.id ?? null
    if (!id) throw appError('unauthorized')
    this.userId = id
    return id
  }

  private async fetchProfile(): Promise<Profile | null> {
    const uid = await this.requireUserId()
    const { data, error } = await this.client.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (error) mapError(error)
    return data ? toProfile(data as Row) : null
  }

  /* ---------------- Realtime ---------------- */

  private startRealtime(): void {
    this.stopRealtime()
    const uid = this.userId
    if (!uid) return

    const channel = this.client.channel(`dafatar:${uid}`)

    const listen = (table: string, column: string, event: DataEvent['table']) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${column}=eq.${uid}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Row | null
          this.emit({
            table: event,
            action: payload.eventType === 'INSERT' ? 'insert' : payload.eventType === 'DELETE' ? 'delete' : 'update',
            id: row && typeof row.id === 'string' ? row.id : undefined,
            userId: uid,
          })
        },
      )
    }

    listen('financial_entries', 'creator_id', 'entries')
    listen('financial_entries', 'merchant_user_id', 'entries')
    listen('financial_entries', 'customer_user_id', 'entries')
    listen('financial_entries', 'owner_id', 'entries')
    listen('parties', 'owner_id', 'parties')
    listen('notifications', 'user_id', 'notifications')
    listen('link_requests', 'merchant_user_id', 'link_requests')
    listen('link_requests', 'customer_user_id', 'link_requests')
    listen('relationships', 'merchant_user_id', 'relationships')
    listen('relationships', 'customer_user_id', 'relationships')
    listen('balance_proposals', 'proposed_by', 'balance_proposals')

    channel.subscribe()
    this.channel = channel
  }

  private stopRealtime(): void {
    if (this.channel) {
      void this.client.removeChannel(this.channel)
      this.channel = null
    }
  }

  /* ============================ المصادقة ============================ */

  readonly auth: AuthPort = {
    getSession: async () => {
      const { data } = await this.client.auth.getSession()
      const user = data.session?.user
      if (!user) return null
      this.userId = user.id
      return { userId: user.id, email: user.email ?? null, createdAt: user.created_at ?? new Date().toISOString() }
    },

    getProfile: async () => {
      const { data } = await this.client.auth.getSession()
      if (!data.session?.user) return null
      const profile = await this.fetchProfile()
      this.profile = profile
      return profile
    },

    signUp: async (input: SignUpInput): Promise<SignUpResult> => {
      const { data, error } = await this.client.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { full_name: input.fullName, role: input.role },
          emailRedirectTo: `${window.location.origin}/#/`,
        },
      })
      if (error) mapError(error)
      const user = data.user
      if (!user) throw appError('unknown')
      this.userId = user.id
      const session = data.session
      return {
        session: session
          ? { userId: user.id, email: user.email ?? null, createdAt: user.created_at ?? new Date().toISOString() }
          : null,
        needsEmailConfirmation: !session,
      }
    },

    signIn: async ({ email, password }) => {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password })
      if (error) mapError(error)
      const user = data.user
      if (!user) throw appError('unknown')
      this.userId = user.id
      return { userId: user.id, email: user.email ?? null, createdAt: user.created_at ?? new Date().toISOString() }
    },

    signOut: async () => {
      await this.client.auth.signOut()
      this.userId = null
      this.profile = null
      this.stopRealtime()
    },

    createProfile: async ({ fullName, role, currency }) => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('profiles')
        .upsert({ id: uid, full_name: fullName, role, currency: currency ?? 'YER' }, { onConflict: 'id' })
        .select('*')
        .single()
      if (error) mapError(error)
      const profile = toProfile(data as Row)
      this.profile = profile
      this.emit({ table: 'profile', action: 'update', id: uid, userId: uid })
      return profile
    },

    updateProfile: async (patch) => {
      const uid = await this.requireUserId()
      const row: Row = { updated_at: new Date().toISOString() }
      if (patch.fullName !== undefined) row.full_name = patch.fullName
      if (patch.role !== undefined) row.role = patch.role
      if (patch.currency !== undefined) row.currency = patch.currency
      if (patch.theme !== undefined) row.theme = patch.theme
      if (patch.numerals !== undefined) row.numerals = patch.numerals
      if (patch.phone !== undefined) row.phone = patch.phone
      const { data, error } = await this.client.from('profiles').update(row).eq('id', uid).select('*').single()
      if (error) mapError(error)
      const profile = toProfile(data as Row)
      this.profile = profile
      this.emit({ table: 'profile', action: 'update', id: uid, userId: uid })
      return profile
    },

    onAuthStateChange: (cb) => {
      this.authListeners.add(cb)
      return () => this.authListeners.delete(cb)
    },

    changePassword: async (currentPassword, newPassword) => {
      const { data } = await this.client.auth.getSession()
      const email = data.session?.user?.email
      if (!email) throw appError('unauthorized')
      // تحقق من كلمة المرور الحالية قبل التغيير
      const { error: verifyError } = await this.client.auth.signInWithPassword({ email, password: currentPassword })
      if (verifyError) throw appError('forbidden', undefined, 'كلمة المرور الحالية غير صحيحة')
      const { error } = await this.client.auth.updateUser({ password: newPassword })
      if (error) mapError(error)
    },
  }

  /* ============================ الأطراف ============================ */

  private cacheParties(rows: Row[]): void {
    void (async () => {
      try {
        const db = await getDB()
        await Promise.all(rows.map((r) => db.put('parties', { ...r })))
      } catch {
        /* الكاش اختياري */
      }
    })()
  }

  private async cachedParty(id: string): Promise<Party | null> {
    try {
      const db = await getDB()
      const row = (await db.get('parties', id)) as Row | undefined
      return row ? toParty(row) : null
    } catch {
      return null
    }
  }

  readonly parties: PartyPort = {
    list: async (query: PartyQuery = {}): Promise<Page<Party>> => {
      try {
        const uid = await this.requireUserId()
        let q = this.client.from('parties').select('*').eq('owner_id', uid)
        if (!query.includeArchived) q = q.is('archived_at', null)
        const search = query.query?.trim()
        if (search) q = q.ilike('name', `%${search}%`)
        if (query.cursor) q = q.lt('created_at', query.cursor)
        q = q.order('created_at', { ascending: false }).limit(query.limit ?? 100)

        const { data, error } = await q
        if (error) mapError(error)
        const rows = (data ?? []) as Row[]
        this.cacheParties(rows)
        const items = rows.map(toParty)
        return {
          items,
          nextCursor: items.length === (query.limit ?? 100) ? (rows[rows.length - 1]?.created_at as string) : null,
          hasMore: items.length === (query.limit ?? 100),
        }
      } catch (error) {
        if (!(error instanceof Error) || !/network|offline/i.test(String((error as { code?: string }).code ?? ''))) throw error
        throw error
      }
    },

    get: async (id) => {
      try {
        const { data, error } = await this.client.from('parties').select('*').eq('id', id).maybeSingle()
        if (error) mapError(error)
        if (!data) return null
        this.cacheParties([data as Row])
        return toParty(data as Row)
      } catch (error) {
        const cached = await this.cachedParty(id)
        if (cached) return cached
        throw error
      }
    },

    create: async (input: CreatePartyDTO) => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('parties')
        .insert({
          owner_id: uid,
          kind: input.kind,
          name: input.name,
          phone: input.phone ?? null,
          address: input.address ?? null,
          note: input.note ?? null,
        })
        .select('*')
        .single()
      if (error) mapError(error)
      const party = toParty(data as Row)
      this.cacheParties([data as Row])

      if (input.openingAmountMinor && input.openingAmountMinor > 0) {
        await this.entries.create({
          partyId: party.id,
          entryType: 'debt',
          amountMinor: input.openingAmountMinor,
          currency: this.profile?.currency ?? 'YER',
          details: 'رصيد افتتاحي',
          clientRef: `opening:${party.id}`,
        })
      }

      this.emit({ table: 'parties', action: 'insert', id: party.id, userId: uid })
      return party
    },

    update: async (id, patch) => {
      const uid = await this.requireUserId()
      const row: Row = { updated_at: new Date().toISOString() }
      if (patch.name !== undefined) row.name = patch.name
      if (patch.phone !== undefined) row.phone = patch.phone
      if (patch.address !== undefined) row.address = patch.address
      if (patch.note !== undefined) row.note = patch.note
      const { data, error } = await this.client.from('parties').update(row).eq('id', id).eq('owner_id', uid).select('*').single()
      if (error) mapError(error)
      this.cacheParties([data as Row])
      this.emit({ table: 'parties', action: 'update', id, userId: uid })
      return toParty(data as Row)
    },

    archive: async (id) => {
      const uid = await this.requireUserId()
      const { error } = await this.client
        .from('parties')
        .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', uid)
      if (error) mapError(error)
      this.emit({ table: 'parties', action: 'update', id, userId: uid })
    },

    unarchive: async (id) => {
      const uid = await this.requireUserId()
      const { error } = await this.client
        .from('parties')
        .update({ archived_at: null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_id', uid)
      if (error) mapError(error)
      this.emit({ table: 'parties', action: 'update', id, userId: uid })
    },

    listLinked: async () => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('parties')
        .select('*')
        .eq('owner_id', uid)
        .not('linked_user_id', 'is', null)
      if (error) mapError(error)
      return ((data ?? []) as Row[]).map(toParty)
    },
  }

  /* ============================ استعادة نسخة احتياطية ============================ */

  /**
   * الوضع السحابي: الكتابة تمرّ عبر الدوال الآمنة فقط، لذلك تُعاد الأطراف
   * والعمليات الشخصية **كعمليات جديدة** بنفس معرّف العميل (client_ref) — فلا
   * تتكرر ولا يُنشأ سجل مزدوج. العمليات المشتركة لا تُستعاد تلقائيًا لأنها
   * تحتاج تأكيد الطرف الآخر الحقيقي.
   */
  async restore(payload: BackupPayload): Promise<RestoreResult> {
    await this.requireUserId()
    const profile = await this.auth.getProfile()
    const kind: PartyKind = profile?.role === 'merchant' ? 'customer' : 'shop'

    const existing = (await this.parties.list({ includeArchived: true, limit: 5000 })).items
    const byName = new Map<string, string>()
    for (const party of existing) byName.set(`${party.kind}:${normalizeArabic(party.name).trim().toLowerCase()}`, party.id)

    const idMap = new Map<string, string>()
    let partiesAdded = 0
    let entriesAdded = 0
    let skipped = 0

    for (const party of payload.parties) {
      const key = `${party.kind}:${normalizeArabic(party.name).trim().toLowerCase()}`
      const known = existing.find((p) => p.id === party.id)
      if (known) {
        idMap.set(party.id, known.id)
        continue
      }
      const sameName = byName.get(key)
      if (sameName) {
        idMap.set(party.id, sameName)
        skipped += 1
        continue
      }
      const created = await this.parties.create({
        kind,
        name: party.name,
        phone: party.phone,
        address: party.address,
        note: party.note,
        openingAmountMinor: 0,
      })
      idMap.set(party.id, created.id)
      byName.set(key, created.id)
      partiesAdded += 1
    }

    for (const entry of payload.entries) {
      if (entry.scope !== 'solo') {
        skipped += 1
        continue
      }
      const sourcePartyId = entry.partyId ?? entry.merchantPartyId ?? entry.customerPartyId
      const partyId = sourcePartyId ? idMap.get(sourcePartyId) : undefined
      if (!partyId) {
        skipped += 1
        continue
      }
      await this.entries.create({
        partyId,
        entryType: entry.entryType,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        details: entry.details,
        note: entry.note,
        occurredAt: entry.occurredAt,
        clientRef: entry.clientRef ?? entry.id,
      })
      entriesAdded += 1
    }

    return { parties: partiesAdded, entries: entriesAdded, skipped }
  }

  /* ============================ العمليات المالية ============================ */

  private buildQuery(query: EntryQuery = {}, count = false) {
    let q = this.client.from('financial_entries').select('*', count ? { count: 'exact', head: true } : {})
    if (query.status && query.status !== 'all') q = q.eq('status', query.status)
    if (query.entryType && query.entryType !== 'all') q = q.eq('entry_type', query.entryType)
    if (query.filter === 'pending') q = q.eq('status', 'pending')
    if (query.filter === 'confirmed') q = q.eq('status', 'confirmed')
    if (query.from) q = q.gte('occurred_at', query.from)
    if (query.to) q = q.lte('occurred_at', query.to)
    return q
  }

  readonly entries: EntryPort = {
    list: async (query: EntryQuery = {}): Promise<Page<FinancialEntry>> => {
      const uid = await this.requireUserId()
      const limit = query.limit ?? 100
      let q = this.buildQuery(query)

      if (query.filter === 'created_by_me') q = q.eq('creator_id', uid)
      if (query.filter === 'awaiting_me') {
        q = q
          .eq('status', 'pending')
          .neq('creator_id', uid)
          .or(`merchant_user_id.eq.${uid},customer_user_id.eq.${uid}`)
      }
      if (query.partyId) {
        q = q.or(`party_id.eq.${query.partyId},merchant_party_id.eq.${query.partyId},customer_party_id.eq.${query.partyId}`)
      }
      if (query.cursor) q = q.lt('occurred_at', query.cursor)

      const { data, error } = await q
        .order('occurred_at', { ascending: query.order === 'asc' })
        .limit(limit)
      if (error) mapError(error)

      const rows = (data ?? []) as Row[]
      const items = rows.map(toEntry)
      return {
        items,
        nextCursor: items.length === limit ? (rows[rows.length - 1]?.occurred_at as string) : null,
        hasMore: items.length === limit,
      }
    },

    get: async (id) => {
      const { data, error } = await this.client.from('financial_entries').select('*').eq('id', id).maybeSingle()
      if (error) mapError(error)
      return data ? toEntry(data as Row) : null
    },

    create: async (input: CreateEntryDTO) => {
      const uid = await this.requireUserId()
      const party = await this.parties.get(input.partyId)
      if (!party) throw appError('not_found')
      const sharedHint = party.linkStatus === 'verified'

      if (!isOnline()) {
        return this.queueEntry(input, sharedHint)
      }

      const { data, error } = await this.client.rpc('create_entry', {
        p_party_id: input.partyId,
        p_entry_type: input.entryType,
        p_amount_minor: input.amountMinor,
        p_currency: input.currency,
        p_details: input.details ?? null,
        p_note: input.note ?? null,
        p_occurred_at: input.occurredAt ?? new Date().toISOString(),
        p_client_ref: input.clientRef,
        p_device_ref: this.deviceRef(),
        p_session_ref: null,
      })
      if (error) {
        if (/over_payment|invalid_amount/.test(error.message)) mapError(error)
        if (!isOnline()) return this.queueEntry(input, sharedHint)
        mapError(error)
      }
      const entry = toEntry(data as Row)
      this.emit({ table: 'entries', action: 'insert', id: entry.id, userId: uid })
      return entry
    },

    confirm: async (id) => this.entryAction('confirm_entry', { p_entry_id: id }, id),
    reject: async (id, reason) => this.entryAction('reject_entry', { p_entry_id: id, p_reason: reason ?? null }, id),
    cancel: async (id) => this.entryAction('cancel_entry', { p_entry_id: id }, id),

    countAwaitingMe: async () => {
      const uid = await this.requireUserId()
      const { count, error } = await this.client
        .from('financial_entries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .neq('creator_id', uid)
        .or(`merchant_user_id.eq.${uid},customer_user_id.eq.${uid}`)
      if (error) mapError(error)
      return count ?? 0
    },

    listByParty: async (partyId) => {
      const { data, error } = await this.client
        .from('financial_entries')
        .select('*')
        .or(`party_id.eq.${partyId},merchant_party_id.eq.${partyId},customer_party_id.eq.${partyId}`)
        .order('occurred_at', { ascending: false })
        .limit(500)
      if (error) mapError(error)
      return ((data ?? []) as Row[]).map(toEntry)
    },
  }

  private async entryAction(fn: string, args: Record<string, unknown>, localId: string): Promise<FinancialEntry> {
    const uid = await this.requireUserId()
    const { data, error } = await this.client.rpc(fn, args)
    if (error) mapError(error)
    const entry = toEntry(data as Row)
    this.emit({ table: 'entries', action: 'update', id: localId, userId: uid })
    return entry
  }

  private deviceRef(): string {
    try {
      const key = 'dafatar.device'
      let value = localStorage.getItem(key)
      if (!value) {
        value = uuid()
        localStorage.setItem(key, value)
      }
      return value
    } catch {
      return 'unknown-device'
    }
  }

  /** حفظ عملية بلا اتصال في الطابور — تظهر «بانتظار الاتصال والمزامنة» */
  private async queueEntry(input: CreateEntryDTO, sharedHint: boolean): Promise<FinancialEntry> {
    const uid = await this.requireUserId()
    const profile = this.profile ?? (await this.fetchProfile())
    const now = new Date().toISOString()
    const row: QueuedWrite = {
      id: uuid(),
      op: 'create_entry',
      payload: {
        ...input,
        creatorRole: profile?.role ?? 'customer',
        creatorName: profile?.fullName ?? '',
        sharedHint,
      },
      userId: uid,
      clientRef: input.clientRef,
      createdAt: now,
      attempts: 0,
      lastError: null,
      status: 'queued',
    }

    const db = await getDB()
    await db.put('outbox', row as unknown as OutboxRow)
    await this.refreshOutboxCount()

    const optimistic: FinancialEntry = {
      id: row.id,
      scope: sharedHint ? 'shared' : 'solo',
      entryType: input.entryType,
      entryKind: 'normal',
      status: sharedHint ? 'pending' : 'confirmed',
      amountMinor: input.amountMinor,
      currency: input.currency,
      details: input.details ?? null,
      note: input.note ?? null,
      reason: null,
      occurredAt: input.occurredAt ?? now,
      createdAt: now,
      updatedAt: now,
      creatorId: uid,
      creatorRole: profile?.role ?? 'customer',
      creatorName: profile?.fullName ?? null,
      ownerId: sharedHint ? null : uid,
      partyId: sharedHint ? null : input.partyId,
      relationshipId: null,
      merchantUserId: null,
      customerUserId: null,
      merchantPartyId: null,
      customerPartyId: null,
      confirmedBy: sharedHint ? null : uid,
      confirmedAt: sharedHint ? null : now,
      confirmedByName: sharedHint ? null : (profile?.fullName ?? null),
      rejectedBy: null,
      rejectedAt: null,
      rejectedByName: null,
      cancelledAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      clientRef: input.clientRef,
      excludedFromBalance: false,
      excludedReason: null,
      pendingSync: true,
    }

    await db.put('entries', { ...optimistic } as unknown as Record<string, unknown>)
    this.emit({ table: 'entries', action: 'insert', id: optimistic.id, userId: uid })
    return optimistic
  }

  private async refreshOutboxCount(): Promise<void> {
    try {
      const db = await getDB()
      const all = (await db.getAll('outbox')) as unknown as QueuedWrite[]
      this.setState({ pendingCount: all.filter((r) => r.status !== 'sending').length })
    } catch {
      /* ignore */
    }
  }

  /* ============================ الربط ============================ */

  readonly links: LinkPort = {
    createInvite: async () => {
      const { data, error } = await this.client.rpc('create_link_invite')
      if (error) mapError(error)
      const request = toLinkRequest(data as Row)
      this.emit({ table: 'link_requests', action: 'insert', id: request.id, userId: request.merchantUserId })
      return request
    },

    cancelInvite: async (id) => {
      const { error } = await this.client.rpc('cancel_link_invite', { p_request_id: id })
      if (error) mapError(error)
      this.emit({ table: 'link_requests', action: 'update', id })
    },

    previewInvite: async (token): Promise<LinkPreview> => {
      const { data, error } = await this.client.rpc('preview_link_token', { p_token: token })
      if (error) mapError(error)
      const row = data as Row
      return {
        merchantUserId: str(row.merchant_user_id),
        merchantName: str(row.merchant_name) || 'تاجر',
        expiresAt: iso(row.expires_at),
        previousBalanceMinor: num(row.previous_balance_minor),
        alreadyLinked: Boolean(row.already_linked),
      }
    },

    claimInvite: async (token) => {
      const { data, error } = await this.client.rpc('claim_link_invite', { p_token: token })
      if (error) mapError(error)
      const request = toLinkRequest(data as Row)
      this.emit({ table: 'link_requests', action: 'update', id: request.id })
      return request
    },

    listRequests: async () => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('link_requests')
        .select('*')
        .or(`merchant_user_id.eq.${uid},customer_user_id.eq.${uid}`)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) mapError(error)
      return ((data ?? []) as Row[]).map(toLinkRequest)
    },

    acceptRequest: async (id) => {
      const { data, error } = await this.client.rpc('accept_link_request', { p_request_id: id })
      if (error) mapError(error)
      this.emit({ table: 'relationships', action: 'insert' })
      this.emit({ table: 'link_requests', action: 'update', id })
      return toRelationship(data as Row)
    },

    rejectRequest: async (id, reason) => {
      const { error } = await this.client.rpc('reject_link_request', { p_request_id: id, p_reason: reason ?? null })
      if (error) mapError(error)
      this.emit({ table: 'link_requests', action: 'update', id })
    },

    listRelationships: async () => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('relationships')
        .select('*')
        .or(`merchant_user_id.eq.${uid},customer_user_id.eq.${uid}`)
        .order('created_at', { ascending: false })
      if (error) mapError(error)
      return ((data ?? []) as Row[]).map(toRelationship)
    },

    endRelationship: async (id) => {
      const { error } = await this.client.rpc('end_relationship', { p_relationship_id: id })
      if (error) mapError(error)
      this.emit({ table: 'relationships', action: 'update', id })
    },

    listBalanceProposals: async () => {
      const uid = await this.requireUserId()
      const { data, error } = await this.client
        .from('balance_proposals')
        .select('*, relationships!inner(merchant_user_id, customer_user_id)')
        .or(`merchant_user_id.eq.${uid},customer_user_id.eq.${uid}`, { foreignTable: 'relationships' })
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) mapError(error)
      return ((data ?? []) as Row[]).map(toProposal)
    },

    respondProposal: async (id, accept) => {
      const { error } = await this.client.rpc('respond_opening_balance', { p_proposal_id: id, p_accept: accept })
      if (error) mapError(error)
      this.emit({ table: 'balance_proposals', action: 'update', id })
    },

    proposeOpeningBalance: async (relationshipId, amountMinor, note) => {
      const { data, error } = await this.client.rpc('propose_opening_balance', {
        p_relationship_id: relationshipId,
        p_amount_minor: amountMinor,
        p_note: note ?? null,
      })
      if (error) mapError(error)
      this.emit({ table: 'balance_proposals', action: 'insert', id: str((data as Row).id) })
      return toProposal(data as Row)
    },
  }

  /* ============================ الإشعارات ============================ */

  readonly notifications: NotificationPort = {
    list: async (query: NotificationQuery = {}): Promise<Page<AppNotification>> => {
      const uid = await this.requireUserId()
      const limit = query.limit ?? 50
      let q = this.client.from('notifications').select('*').eq('user_id', uid)
      if (query.unreadOnly) q = q.is('read_at', null)
      if (query.cursor) q = q.lt('created_at', query.cursor)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
      if (error) mapError(error)
      const rows = (data ?? []) as Row[]
      const items = rows.map(toNotification)
      return {
        items,
        nextCursor: items.length === limit ? (rows[rows.length - 1]?.created_at as string) : null,
        hasMore: items.length === limit,
      }
    },

    unreadCount: async () => {
      const uid = await this.requireUserId()
      const { count, error } = await this.client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .is('read_at', null)
      if (error) mapError(error)
      return count ?? 0
    },

    markRead: async (id) => {
      const uid = await this.requireUserId()
      const { error } = await this.client
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', uid)
      if (error) mapError(error)
      this.emit({ table: 'notifications', action: 'update', id, userId: uid })
    },

    markAllRead: async () => {
      const uid = await this.requireUserId()
      const { error } = await this.client
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', uid)
        .is('read_at', null)
      if (error) mapError(error)
      this.emit({ table: 'notifications', action: 'update', userId: uid })
    },

    remove: async (id) => {
      const uid = await this.requireUserId()
      const { error } = await this.client.from('notifications').delete().eq('id', id).eq('user_id', uid)
      if (error) mapError(error)
      this.emit({ table: 'notifications', action: 'delete', id, userId: uid })
    },
  }

  /* ============================ المزامنة ============================ */

  readonly sync: SyncPort = {
    state: () => ({ ...this.state, online: isOnline(), lastSyncedAt: readLastSynced() }),

    sync: async (): Promise<SyncResult> => {
      if (!isOnline()) {
        this.setState({ online: false, lastError: null })
        throw appError('offline')
      }

      this.setState({ syncing: true, lastError: null })
      const result: SyncResult = { pushed: 0, pulled: 0, failed: 0, errors: [] }

      try {
        const db = await getDB()
        const queued = ((await db.getAll('outbox')) as unknown as QueuedWrite[]).filter((r) => r.status !== 'sending')

        for (const row of queued) {
          await db.put('outbox', { ...row, status: 'sending' } as unknown as OutboxRow)
          try {
            const payload = row.payload
            const { error } = await this.client.rpc('create_entry', {
              p_party_id: payload.partyId,
              p_entry_type: payload.entryType,
              p_amount_minor: payload.amountMinor,
              p_currency: payload.currency,
              p_details: payload.details ?? null,
              p_note: payload.note ?? null,
              p_occurred_at: payload.occurredAt ?? row.createdAt,
              p_client_ref: payload.clientRef,
              p_device_ref: this.deviceRef(),
              p_session_ref: null,
            })
            if (error) throw error
            await db.delete('outbox', row.id)
            await db.delete('entries', row.id)
            result.pushed += 1
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            result.failed += 1
            result.errors.push(message)
            const attempts = row.attempts + 1
            await db.put('outbox', {
              ...row,
              attempts,
              lastError: message,
              status: attempts >= 5 ? 'failed' : 'queued',
            } as unknown as OutboxRow)
          }
        }

        const now = new Date().toISOString()
        writeLastSynced(now)
        this.setState({
          syncing: false,
          pendingCount: result.failed,
          lastSyncedAt: now,
          lastError: result.errors[0] ?? null,
          online: true,
        })
        this.emit({ table: 'entries', action: 'update' })
        await this.refreshOutboxCount()
        return result
      } catch (error) {
        this.setState({ syncing: false, lastError: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },

    onChange: (cb) => {
      this.syncListeners.add(cb)
      return () => this.syncListeners.delete(cb)
    },

    retry: async () => {
      try {
        const db = await getDB()
        const rows = (await db.getAll('outbox')) as unknown as QueuedWrite[]
        for (const row of rows.filter((r) => r.status === 'failed')) {
          await db.put('outbox', { ...row, status: 'queued', attempts: 0 } as unknown as OutboxRow)
        }
        await this.refreshOutboxCount()
      } catch {
        /* ignore */
      }
    },
  }

  /* ============================ أحداث لحظية للواجهة ============================ */

  subscribe(cb: (event: DataEvent) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  async resetUserData(): Promise<void> {
    const uid = await this.requireUserId()
    // لا حذف للسجل المالي: نمسح فقط الطابور المحلي والإشعارات المقروءة
    const db = await getDB()
    const rows = (await db.getAll('outbox')) as unknown as QueuedWrite[]
    await Promise.all(rows.filter((r) => r.userId === uid).map((r) => db.delete('outbox', r.id)))
    await this.refreshOutboxCount()
  }
}
