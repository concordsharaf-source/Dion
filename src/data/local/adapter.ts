/**
 * المحرّك المحلي — تنفيذ كامل لعقد البيانات على IndexedDB
 *
 * يوفّر:
 *   ✔ استخدامًا كاملًا بلا حساب سحابي (دفتر شخصي للعميل أو للتاجر)
 *   ✔ نفس قواعد العمل المالية بالحرف: الرصيد من المؤكد فقط
 *   ✔ وضعًا مشتركًا كاملًا بين حسابين على نفس الجهاز (للاختبار والتجربة)
 *   ✔ مزامنة لحظية بين التبويبات عبر BroadcastChannel
 *   ✔ سجل تدقيق كامل + إشعارات + طابور مزامنة
 */

import type {
  AppNotification,
  BalanceProposal,
  EntryType,
  FinancialEntry,
  LinkRequest,
  NotificationKind,
  Party,
  PartyKind,
  Profile,
  Relationship,
  Role,
} from '@/core/domain'
import { canPerform, counterpartyOf } from '@/core/domain'
import { computeTotals, normalizeArabic } from '@/core/balance'
import { appError } from '@/core/errors'
import { isUuid, uuid } from '@/core/id'
import { hashPassword, verifyPassword, sha256Hex } from './crypto'
import { assertLinkUsable, expiryFromNow, generateToken, LINK_TTL_MS, tokenToCode } from '@/core/qr'
import { normalizePhoneNumber } from '@/core/validation'
import { getDB, type UserRow } from './db'
import type { BackupPayload } from '@/core/backup'
import type { RestoreResult } from '../port'
import type {
  AuthPort,
  AuthSession,
  CreateEntryDTO,
  CreatePartyDTO,
  DataEvent,
  DataSource,
  EntryPort,
  EntryQuery,
  LinkPort,
  LinkPreview,
  NotificationPort,
  NotificationQuery,
  Page,
  PartyPort,
  PartyQuery,
  SignInInput,
  SignUpInput,
  SignUpResult,
  SyncPort,
  SyncResult,
  SyncState,
} from '../port'

const SESSION_LS = 'dafatar.session'
const SESSION_TAB = 'dafatar.session.tab'

/* ============================ أدوات داخلية ============================ */

function nowISO(): string {
  return new Date().toISOString()
}

function asParty(row: Record<string, unknown>): Party {
  return row as unknown as Party
}

function asEntry(row: Record<string, unknown>): FinancialEntry {
  return row as unknown as FinancialEntry
}

function makeSearchKey(name: string): string {
  return normalizeArabic(name)
}

/** قارئ الجلسة: تبويب أولًا (يسمح بحسابين في تبويبين للاختبار) ثم التخزين الدائم */
function readSessionUserId(): string | null {
  try {
    const tab = sessionStorage.getItem(SESSION_TAB)
    if (tab) return tab === '__none__' ? null : tab
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(SESSION_LS)
  } catch {
    return null
  }
}

/* ============================ مساعدات الأرقام ============================ */

/**
 * توحيد رقمين للمقارنة: يتجاهل مفتاح الدولة والصفر في البداية.
 * يمنع فشل فتح الحساب لمن سجّل رقمه سابقًا بصيغة `+967…` أو `0…`.
 */
function samePhone(stored: string | null | undefined, needle: string | null): boolean {
  if (!stored || !needle) return false
  const a = normalizePhoneNumber(stored)
  const b = normalizePhoneNumber(needle)
  if (!a || !b) return false
  return a === b
}

/* ============================ أنواع داخلية ============================ */

/** حقول العملية الجديدة: الحقول المُدارة تُملأ تلقائيًا */
type NewEntryInput = Omit<
  FinancialEntry,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'excludedFromBalance'
  | 'excludedReason'
  | 'rejectedBy'
  | 'rejectedAt'
  | 'rejectedByName'
  | 'confirmedBy'
  | 'confirmedAt'
  | 'confirmedByName'
  | 'cancelledAt'
  | 'reversesEntryId'
  | 'reversedByEntryId'
> &
  Partial<
    Pick<
      FinancialEntry,
      | 'confirmedBy'
      | 'confirmedAt'
      | 'confirmedByName'
      | 'rejectedBy'
      | 'rejectedAt'
      | 'rejectedByName'
      | 'cancelledAt'
      | 'reversesEntryId'
      | 'reversedByEntryId'
    >
  >

/* ============================ المحرّك ============================ */

export class LocalDataSource implements DataSource {
  readonly kind = 'local' as const
  readonly supportsShared = true

  private listeners = new Set<(event: DataEvent) => void>()
  private channel: BroadcastChannel | null = null
  private syncListeners = new Set<(state: SyncState) => void>()
  private authListeners = new Set<(session: AuthSession | null) => void>()

  // لا حاجة لطابور إرسال محلي: كل الكتابات تُحفظ فورًا على الجهاز
  private state: SyncState = {
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    syncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  }

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('dafatar-events')
      this.channel.onmessage = (msg) => {
        const event = msg.data as DataEvent
        this.listeners.forEach((cb) => cb(event))
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setOnline(true))
      window.addEventListener('offline', () => this.setOnline(false))
      window.addEventListener('storage', (e) => {
        if (e.key === SESSION_LS) {
          void this.currentSession().then((s) => this.authListeners.forEach((cb) => cb(s)))
        }
      })
    }
  }

  private setOnline(online: boolean): void {
    const next = { ...this.state, online }
    this.state = next
    this.syncListeners.forEach((cb) => cb(next))
  }

  private emit(event: DataEvent): void {
    this.listeners.forEach((cb) => cb(event))
    try {
      this.channel?.postMessage(event)
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------- الجلسة ---------------------------- */

  private async currentSession(): Promise<AuthSession | null> {
    const userId = readSessionUserId()
    if (!userId) return null
    const db = await getDB()
    const user = (await db.get('users', userId)) as UserRow | undefined
    if (!user) return null
    return { userId: user.id, email: user.email, createdAt: user.createdAt }
  }

  private async requireSession(): Promise<AuthSession> {
    const session = await this.currentSession()
    if (!session) throw appError('unauthorized')
    return session
  }

  private async requireProfile(session: AuthSession): Promise<Profile> {
    const db = await getDB()
    const row = await db.get('profiles', session.userId)
    if (!row) throw appError('not_found', undefined, 'لم يكتمل إعداد الحساب بعد.')
    return row as unknown as Profile
  }

  /* ---------------------------- أحداث مساعدة ---------------------------- */

  private async audit(entryId: string, actorId: string, action: string, meta?: Record<string, unknown>): Promise<void> {
    const db = await getDB()
    await db.put('auditLogs', {
      id: uuid(),
      entryId,
      actorId,
      action,
      meta: meta ?? {},
      at: nowISO(),
    })
  }

  private async notify(
    userId: string,
    kind: NotificationKind,
    title: string,
    body: string | null,
    refType: AppNotification['refType'],
    refId: string | null,
  ): Promise<void> {
    const db = await getDB()
    const row: AppNotification = {
      id: uuid(),
      userId,
      kind,
      title,
      body,
      refType,
      refId,
      readAt: null,
      createdAt: nowISO(),
    }
    await db.put('notifications', row as unknown as Record<string, unknown>)
    this.emit({ table: 'notifications', action: 'insert', id: row.id, userId })
  }

  /* ---------------------------- قراءات أساسية ---------------------------- */

  private async getPartyOrThrow(id: string, ownerId: string): Promise<Party> {
    if (!isUuid(id)) throw appError('not_found')
    const db = await getDB()
    const row = await db.get('parties', id)
    if (!row) throw appError('not_found', undefined, 'الطرف غير موجود.')
    const party = asParty(row)
    if (party.ownerId !== ownerId) throw appError('forbidden')
    return party
  }

  private async getEntryOrThrow(id: string, viewerId: string): Promise<FinancialEntry> {
    const db = await getDB()
    const row = await db.get('entries', id)
    if (!row) throw appError('not_found', undefined, 'العملية غير موجودة.')
    const entry = asEntry(row)
    const visible = entry.scope === 'solo' ? entry.ownerId === viewerId : entry.merchantUserId === viewerId || entry.customerUserId === viewerId
    if (!visible) throw appError('forbidden')
    return entry
  }

  /** كل العمليات الظاهرة لمستخدم معيّن (مستقلة + مشتركة) */
  private async visibleEntries(userId: string): Promise<FinancialEntry[]> {
    const db = await getDB()
    const [solo, asMerchant, asCustomer] = await Promise.all([
      db.getAllFromIndex('entries', 'ownerId', userId),
      db.getAllFromIndex('entries', 'merchantUserId', userId),
      db.getAllFromIndex('entries', 'customerUserId', userId),
    ])
    const map = new Map<string, FinancialEntry>()
    for (const row of [...solo, ...asMerchant, ...asCustomer]) {
      const e = asEntry(row)
      map.set(e.id, e)
    }
    return [...map.values()]
  }

  /**
   * الرصيد المؤكد لطرف واحد — يُستخدم في منع السداد الزائد.
   * ملاحظة مهمة: الطرف المرتبط رسميًا يُحسب على الدفتر المشترك فقط،
   * لأن أي سجل سابق يبقى منفصلًا حتى يُعتمد صريحًا.
   */
  private async confirmedRemainingForParty(
    partyId: string,
    userId: string,
    scope: 'solo' | 'shared',
  ): Promise<number> {
    const entries = await this.visibleEntries(userId)
    const scoped = entries.filter((e) => {
      if (e.scope !== scope) return false
      return scope === 'solo'
        ? e.partyId === partyId
        : e.merchantPartyId === partyId || e.customerPartyId === partyId
    })
    return computeTotals(scoped, userId).remaining
  }

  private async getRelationshipOrThrow(id: string, userId: string): Promise<Relationship> {
    const db = await getDB()
    const row = await db.get('relationships', id)
    if (!row) throw appError('not_found')
    const rel = row as unknown as Relationship
    if (rel.merchantUserId !== userId && rel.customerUserId !== userId) throw appError('forbidden')
    return rel
  }

  /* ============================ المصادقة ============================ */

  readonly auth: AuthPort = {
    getSession: () => this.currentSession(),

    getProfile: async () => {
      const session = await this.currentSession()
      if (!session) return null
      const db = await getDB()
      const row = await db.get('profiles', session.userId)
      return row ? (row as unknown as Profile) : null
    },

    signUp: async (input: SignUpInput): Promise<SignUpResult> => {
      const db = await getDB()
      const email = input.email.trim().toLowerCase()
      const existing = await db.getFromIndex('users', 'email', email)
      if (existing) throw appError('conflict', undefined, 'هذا البريد مسجّل مسبقًا.')

      const { hash, salt } = await hashPassword(input.password)
      const user: UserRow = { id: uuid(), email, passwordHash: hash, salt, createdAt: nowISO() }
      await db.put('users', user)

      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      return { session, needsEmailConfirmation: false }
    },

    signIn: async (input: SignInInput): Promise<AuthSession> => {
      const db = await getDB()
      const email = input.email.trim().toLowerCase()
      const user = (await db.getFromIndex('users', 'email', email)) as UserRow | undefined
      if (!user) throw appError('unauthorized', undefined, 'البريد أو كلمة المرور غير صحيحة.')
      const ok = await verifyPassword(input.password, user.passwordHash, user.salt)
      if (!ok) throw appError('unauthorized', undefined, 'البريد أو كلمة المرور غير صحيحة.')

      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      return session
    },

    signOut: async () => {
      try {
        sessionStorage.setItem(SESSION_TAB, '__none__')
        localStorage.removeItem(SESSION_LS)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(null))
    },

    createProfile: async ({ fullName, role, currency, phone }) => {
      const session = await this.requireSession()
      const db = await getDB()
      const existing = await db.get('profiles', session.userId)
      if (existing) return existing as unknown as Profile

      const profile: Profile = {
        id: session.userId,
        role,
        roles: [role],
        fullName,
        phone: phone ?? null,
        currency: currency ?? 'YER',
        theme: 'system',
        numerals: 'latin',
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
      await db.put('profiles', profile as unknown as Record<string, unknown>)
      this.emit({ table: 'profile', action: 'insert', id: profile.id, userId: profile.id })
      return profile
    },

    updateProfile: async (patch) => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const updated: Profile = { ...profile, ...patch, updatedAt: nowISO() }
      if (patch.role && !updated.roles.includes(patch.role)) updated.roles = [...updated.roles, patch.role]
      const db = await getDB()
      await db.put('profiles', updated as unknown as Record<string, unknown>)
      this.emit({ table: 'profile', action: 'update', id: updated.id, userId: updated.id })
      return updated
    },

    changePassword: async (currentPassword, newPassword) => {
      const session = await this.requireSession()
      const db = await getDB()
      const user = (await db.get('users', session.userId)) as UserRow | undefined
      if (!user) throw appError('unauthorized')
      const ok = await verifyPassword(currentPassword, user.passwordHash, user.salt)
      if (!ok) throw appError('unauthorized', undefined, 'كلمة المرور الحالية غير صحيحة.')
      const { hash, salt } = await hashPassword(newPassword)
      await db.put('users', { ...user, passwordHash: hash, salt })
    },

    /**
     * بدء سريع: حساب محلي بلا بريد إلكتروني ولا كلمة مرور يكتبها المستخدم.
     * يبقى الحساب مرتبطًا بهذا الجهاز، ويمكن استخدام التطبيق كاملًا به.
     */
    signInQuick: async ({ fullName, role }) => {
      const db = await getDB()
      const id = uuid()
      const email = `device-${id.slice(0, 8)}@local`
      const password = `${uuid()}${uuid()}`
      const { hash, salt } = await hashPassword(password)
      const user: UserRow = { id, email, passwordHash: hash, salt, createdAt: nowISO() }
      await db.put('users', user)

      const profile: Profile = {
        id,
        role,
        roles: [role],
        fullName: fullName.trim(),
        phone: null,
        currency: 'YER',
        theme: 'system',
        numerals: 'latin',
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
      await db.put('profiles', profile as unknown as Record<string, unknown>)

      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      this.emit({ table: 'profile', action: 'insert', id, userId: id })
      return session
    },

    /**
     * إنشاء حساب على هذا الجهاز: الاسم + رقم الهاتف + كلمة المرور.
     * تُحفظ بيانات الدخول (هاتف + كلمة مرور مشفّرة) وبيانات المستخدم،
     * فيستطيع الدخول بعد تسجيل الخروج ويرى دفتره كما تركه.
     */
    signUpDevice: async ({ fullName, phone, password, role }) => {
      const db = await getDB()
      const normalizedPhone = normalizePhoneNumber(phone)
      if (!normalizedPhone) throw appError('validation', undefined, 'رقم الهاتف غير صحيح.')

      const users = (await db.getAll('users')) as UserRow[]
      if (users.some((u) => samePhone(u.phone, normalizedPhone))) {
        throw appError('conflict', undefined, 'رقم الهاتف مسجّل مسبقًا على هذا الجهاز.')
      }

      const id = uuid()
      const email = `device-${id.slice(0, 8)}@local`
      const { hash, salt } = await hashPassword(password)
      const user: UserRow = { id, email, passwordHash: hash, salt, phone: normalizedPhone, createdAt: nowISO() }
      await db.put('users', user)

      const profile: Profile = {
        id,
        role,
        roles: [role],
        fullName: fullName.trim(),
        phone: normalizedPhone,
        currency: 'YER',
        theme: 'system',
        numerals: 'latin',
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
      await db.put('profiles', profile as unknown as Record<string, unknown>)

      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      this.emit({ table: 'profile', action: 'insert', id, userId: id })
      return session
    },

    /** دخول برقم الهاتف (أو البريد) وكلمة المرور — لحساب محفوظ على هذا الجهاز */
    signInDevice: async ({ identifier, password }) => {
      const db = await getDB()
      const needle = identifier.trim().toLowerCase()
      const phone = normalizePhoneNumber(identifier)
      const users = (await db.getAll('users')) as UserRow[]
      // المقارنة بعد التوحيد: تقبل الأرقام القديمة المحفوظة بمفتاح دولة أو بصفر البداية
      const user = users.find(
        (u) => samePhone(u.phone, phone) || (u.email ? u.email.toLowerCase() === needle : false),
      )
      if (!user) throw appError('unauthorized', undefined, 'لا يوجد حساب بهذا الرقم على هذا الجهاز.')
      const ok = await verifyPassword(password, user.passwordHash, user.salt)
      if (!ok) throw appError('unauthorized', undefined, 'كلمة المرور غير صحيحة.')

      if (phone && user.phone !== phone) {
        // ترحيل هادئ: نُخزّن الرقم بصيغته المحلية الموحّدة (بلا مفتاح دولة)
        await db.put('users', { ...user, phone })
        const profile = (await db.get('profiles', user.id)) as unknown as { id: string } | undefined
        if (profile) await db.put('profiles', { ...profile, phone })
      }

      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      return session
    },

    /** استعادة كلمة المرور على هذا الجهاز بعد التحقق من رقم الهاتف المسجّل */
    resetDevicePassword: async ({ phone, newPassword }) => {
      const normalizedPhone = normalizePhoneNumber(phone)
      if (!normalizedPhone) throw appError('validation', undefined, 'رقم الهاتف غير صحيح.')
      const db = await getDB()
      const users = (await db.getAll('users')) as UserRow[]
      const user = users.find((u) => u.phone === normalizedPhone)
      if (!user) throw appError('not_found', undefined, 'لا يوجد حساب بهذا الرقم على هذا الجهاز.')
      const { hash, salt } = await hashPassword(newPassword)
      await db.put('users', { ...user, passwordHash: hash, salt })
    },

    /** بحث سريع عن حساب على هذا الجهاز (لتوجيه رسائل الاستعادة) */
    findDeviceAccount: async (identifier: string) => {
      const db = await getDB()
      const needle = identifier.trim().toLowerCase()
      const phone = normalizePhoneNumber(identifier)
      const users = (await db.getAll('users')) as UserRow[]
      const user = users.find(
        (u) => (phone !== null && u.phone === phone) || (u.email ? u.email.toLowerCase() === needle : false),
      )
      if (!user) return null
      const profile = (await db.get('profiles', user.id)) as unknown as Profile | undefined
      return {
        id: user.id,
        fullName: profile?.fullName ?? '',
        role: profile?.role ?? 'customer',
        createdAt: user.createdAt,
        phone: user.phone ?? null,
        email: user.email,
      }
    },

    /** قائمة الحسابات المحفوظة على هذا الجهاز — لإتاحة الدخول بعد الخروج */
    listDeviceAccounts: async () => {
      const db = await getDB()
      const profiles = (await db.getAll('profiles')) as unknown as Profile[]
      const accounts = profiles.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        role: p.role,
        createdAt: p.createdAt,
        phone: p.phone ?? null,
        email: null as string | null,
      }))
      accounts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      return accounts
    },

    signInAsDeviceAccount: async (accountId: string) => {
      const db = await getDB()
      const user = (await db.get('users', accountId)) as UserRow | undefined
      if (!user) throw appError('not_found', undefined, 'هذا الحساب غير موجود على الجهاز.')
      const session: AuthSession = { userId: user.id, email: user.email, createdAt: user.createdAt }
      try {
        sessionStorage.setItem(SESSION_TAB, user.id)
        localStorage.setItem(SESSION_LS, user.id)
      } catch {
        /* ignore */
      }
      this.authListeners.forEach((cb) => cb(session))
      return session
    },

    onAuthStateChange: (cb) => {
      this.authListeners.add(cb)
      return () => this.authListeners.delete(cb)
    },
  }

  /* ============================ الأطراف ============================ */

  readonly parties: PartyPort = {
    list: async (query: PartyQuery = {}): Promise<Page<Party>> => {
      const session = await this.requireSession()
      const db = await getDB()
      let rows = (await db.getAllFromIndex('parties', 'ownerId', session.userId)) as Record<string, unknown>[]
      let items = rows.map(asParty)

      if (!query.includeArchived) items = items.filter((p) => !p.archivedAt)
      if (query.query) {
        const q = normalizeArabic(query.query)
        const phoneQ = query.query.replace(/[^\d]/g, '')
        items = items.filter(
          (p) =>
            p.searchKey.includes(q) ||
            normalizeArabic(p.name).includes(q) ||
            (phoneQ.length >= 3 && p.phone ? p.phone.includes(phoneQ) : false),
        )
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

      const limit = query.limit ?? 200
      const start = query.cursor ? items.findIndex((p) => p.id === query.cursor) + 1 : 0
      const slice = items.slice(start, start + limit)
      const hasMore = start + limit < items.length
      return {
        items: slice,
        nextCursor: hasMore && slice.length ? slice[slice.length - 1].id : null,
        hasMore,
      }
    },

    get: async (id) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = await db.get('parties', id)
      if (!row) return null
      const party = asParty(row)
      return party.ownerId === session.userId ? party : null
    },

    create: async (input: CreatePartyDTO) => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const db = await getDB()

      const party: Party = {
        id: uuid(),
        ownerId: session.userId,
        kind: input.kind,
        name: input.name.trim(),
        phone: input.phone ? normalizePhoneNumber(input.phone) : null,
        address: input.address ?? null,
        note: input.note ?? null,
        searchKey: makeSearchKey(input.name),
        linkedUserId: null,
        linkedProfileName: null,
        relationshipId: null,
        linkStatus: 'none',
        createdAt: nowISO(),
        updatedAt: nowISO(),
        archivedAt: null,
      }
      await db.put('parties', party as unknown as Record<string, unknown>)

      // الرصيد الافتتاحي يُسجَّل كعملية افتتاحية مؤكدة (لا حقل رصيد مكتوب يدويًا)
      const opening = input.openingAmountMinor ?? 0
      if (opening > 0) {
        await this.insertEntry({
          scope: 'solo',
          entryType: 'debt',
          entryKind: 'opening',
          status: 'confirmed',
          amountMinor: opening,
          currency: profile.currency,
          details: 'رصيد افتتاحي',
          note: null,
          reason: null,
          creatorId: session.userId,
          creatorRole: profile.role,
          creatorName: profile.fullName,
          ownerId: session.userId,
          partyId: party.id,
          relationshipId: null,
          merchantUserId: null,
          customerUserId: null,
          merchantPartyId: null,
          customerPartyId: null,
          confirmedBy: session.userId,
          confirmedAt: nowISO(),
          clientRef: `opening:${party.id}`,
          occurredAt: nowISO(),
        })
      }

      this.emit({ table: 'parties', action: 'insert', id: party.id, userId: session.userId })
      return party
    },

    update: async (id, patch) => {
      const session = await this.requireSession()
      const existing = await this.getPartyOrThrow(id, session.userId)
      const updated: Party = {
        ...existing,
        name: patch.name?.trim() ?? existing.name,
        phone: patch.phone !== undefined ? (patch.phone ? normalizePhoneNumber(patch.phone) : null) : existing.phone,
        address: patch.address !== undefined ? (patch.address ?? null) : existing.address,
        note: patch.note !== undefined ? (patch.note ?? null) : existing.note,
        updatedAt: nowISO(),
      }
      updated.searchKey = makeSearchKey(updated.name)
      const db = await getDB()
      await db.put('parties', updated as unknown as Record<string, unknown>)
      this.emit({ table: 'parties', action: 'update', id, userId: session.userId })
      return updated
    },

    archive: async (id) => {
      const session = await this.requireSession()
      const party = await this.getPartyOrThrow(id, session.userId)
      const db = await getDB()
      await db.put('parties', { ...party, archivedAt: nowISO(), updatedAt: nowISO() } as unknown as Record<string, unknown>)
      this.emit({ table: 'parties', action: 'update', id, userId: session.userId })
    },

    unarchive: async (id) => {
      const session = await this.requireSession()
      const party = await this.getPartyOrThrow(id, session.userId)
      const db = await getDB()
      await db.put('parties', { ...party, archivedAt: null, updatedAt: nowISO() } as unknown as Record<string, unknown>)
      this.emit({ table: 'parties', action: 'update', id, userId: session.userId })
    },

    listLinked: async () => {
      const session = await this.requireSession()
      const db = await getDB()
      const rows = (await db.getAllFromIndex('parties', 'ownerId', session.userId)) as Record<string, unknown>[]
      return rows.map(asParty).filter((p) => p.linkStatus === 'verified' && !p.archivedAt)
    },
  }

  /* ---------------------------- إدراج عملية (داخلي) ---------------------------- */

  private async insertEntry(partial: NewEntryInput): Promise<FinancialEntry> {
    const db = await getDB()
    const entry: FinancialEntry = {
      id: uuid(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      excludedFromBalance: false,
      excludedReason: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectedByName: null,
      confirmedByName: partial.confirmedByName ?? null,
      cancelledAt: null,
      reversesEntryId: partial.reversesEntryId ?? null,
      reversedByEntryId: null,
      ...partial,
    } as FinancialEntry

    await db.put('entries', entry as unknown as Record<string, unknown>)
    await this.audit(entry.id, entry.creatorId, 'created', {
      scope: entry.scope,
      status: entry.status,
      amountMinor: entry.amountMinor,
      entryType: entry.entryType,
    })
    this.emit({ table: 'entries', action: 'insert', id: entry.id, userId: entry.creatorId })
    return entry
  }

  /* ============================ العمليات المالية ============================ */

  readonly entries: EntryPort = {
    list: async (query: EntryQuery = {}): Promise<Page<FinancialEntry>> => {
      const session = await this.requireSession()
      let items = await this.visibleEntries(session.userId)

      if (query.partyId) {
        const pid = query.partyId
        items = items.filter((e) =>
          e.scope === 'solo' ? e.partyId === pid : e.merchantPartyId === pid || e.customerPartyId === pid,
        )
      }
      if (query.status && query.status !== 'all') items = items.filter((e) => e.status === query.status)
      if (query.entryType && query.entryType !== 'all') items = items.filter((e) => e.entryType === query.entryType)
      if (query.from) items = items.filter((e) => (e.occurredAt || e.createdAt) >= query.from!)
      if (query.to) items = items.filter((e) => (e.occurredAt || e.createdAt) <= query.to!)

      switch (query.filter) {
        case 'awaiting_me':
          items = items.filter((e) => e.status === 'pending' && e.scope === 'shared' && e.creatorId !== session.userId)
          break
        case 'created_by_me':
          items = items.filter((e) => e.creatorId === session.userId)
          break
        case 'pending':
          items = items.filter((e) => e.status === 'pending')
          break
        case 'confirmed':
          items = items.filter((e) => e.status === 'confirmed')
          break
        default:
          break
      }

      const desc = query.order !== 'asc'
      items.sort((a, b) => {
        const at = a.occurredAt || a.createdAt
        const bt = b.occurredAt || b.createdAt
        return desc ? bt.localeCompare(at) || b.createdAt.localeCompare(a.createdAt) : at.localeCompare(bt)
      })

      const limit = query.limit ?? 50
      const start = query.cursor ? items.findIndex((e) => e.id === query.cursor) + 1 : 0
      const slice = items.slice(start, start + limit)
      const hasMore = start + limit < items.length

      return { items: slice, nextCursor: hasMore && slice.length ? slice[slice.length - 1].id : null, hasMore }
    },

    get: async (id) => {
      const session = await this.requireSession()
      return this.getEntryOrThrow(id, session.userId)
    },

    listByParty: async (partyId) => {
      const session = await this.requireSession()
      const items = await this.visibleEntries(session.userId)
      return items
        .filter((e) =>
          e.scope === 'solo' ? e.partyId === partyId : e.merchantPartyId === partyId || e.customerPartyId === partyId,
        )
        .sort((a, b) => (b.occurredAt || b.createdAt).localeCompare(a.occurredAt || a.createdAt))
    },

    countAwaitingMe: async () => {
      const session = await this.currentSession()
      if (!session) return 0
      const items = await this.visibleEntries(session.userId)
      return items.filter((e) => e.status === 'pending' && e.scope === 'shared' && e.creatorId !== session.userId).length
    },

    create: async (input: CreateEntryDTO): Promise<FinancialEntry> => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const party = await this.getPartyOrThrow(input.partyId, session.userId)
      const db = await getDB()

      // 1) منع الإرسال المزدوج — نفس clientRef يعيد نفس العملية
      const existing = (await db.getAllFromIndex('entries', 'clientRef', input.clientRef)) as Record<string, unknown>[]
      if (existing.length) return asEntry(existing[0])

      // 2) التحقق من المبلغ
      if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) throw appError('invalid_amount')
      if (input.amountMinor > 99_999_999_999_999) throw appError('amount_too_large')

      // 3) تحديد النطاق: مشترك (رسمي) أم مستقل
      const isShared = party.linkStatus === 'verified' && !!party.relationshipId
      const shared = isShared ? await this.getRelationshipOrThrow(party.relationshipId!, session.userId) : null

      // 4) منع السداد الأكبر من الرصيد المؤكد في النطاق الصحيح
      const remaining = await this.confirmedRemainingForParty(party.id, session.userId, isShared ? 'shared' : 'solo')
      if (input.entryType === 'payment' && input.amountMinor > remaining) {
        throw appError('over_payment', { remaining }, 'مبلغ السداد أكبر من الرصيد المتبقي لدى هذا الطرف.')
      }

      const common = {
        currency: input.currency || profile.currency,
        details: input.details ?? null,
        note: input.note ?? null,
        reason: null,
        occurredAt: input.occurredAt ?? nowISO(),
        creatorId: session.userId,
        creatorRole: profile.role,
        creatorName: profile.fullName,
        clientRef: input.clientRef,
        entryType: input.entryType,
        entryKind: 'normal' as const,
        amountMinor: input.amountMinor,
      }

      let entry: FinancialEntry

      if (shared) {
        // العملية المشتركة: تنتظر مصادقة الطرف الآخر (لا تستطيع تأكيد عمليتك)
        const merchantSide = shared.merchantUserId === session.userId
        entry = await this.insertEntry({
          ...common,
          scope: 'shared',
          status: 'pending',
          ownerId: null,
          partyId: null,
          relationshipId: shared.id,
          merchantUserId: shared.merchantUserId,
          customerUserId: shared.customerUserId,
          merchantPartyId: merchantSide ? party.id : shared.merchantPartyId,
          customerPartyId: merchantSide ? shared.customerPartyId : party.id,
          confirmedBy: null,
          confirmedAt: null,
        })

        const who = profile.fullName
        const label = input.entryType === 'debt' ? 'دينًا' : 'سدادًا'
        await this.notify(
          counterpartyOf(entry, session.userId) ?? shared.customerUserId,
          'entry_created',
          `${who} سجّل ${label} بقيمة ${(input.amountMinor / 100).toLocaleString('en-US')}`,
          input.details ?? null,
          'entry',
          entry.id,
        )
      } else {
        // الوضع المستقل: يُسجَّل مباشرة في دفتر المستخدم، بلا انتظار أي طرف
        entry = await this.insertEntry({
          ...common,
          scope: 'solo',
          status: 'confirmed',
          ownerId: session.userId,
          partyId: party.id,
          relationshipId: null,
          merchantUserId: null,
          customerUserId: null,
          merchantPartyId: null,
          customerPartyId: null,
          confirmedBy: session.userId,
          confirmedAt: nowISO(),
        })
        await this.audit(entry.id, session.userId, 'self_confirmed', { reason: 'عملية مستقلة — لا يوجد طرف مقابل' })
      }

      return entry
    },

    confirm: async (id) => {
      const session = await this.requireSession()
      const entry = await this.getEntryOrThrow(id, session.userId)
      const check = canPerform('confirm', entry, session.userId)
      if (!check.allowed) throw appError(check.code ?? 'forbidden')

      // إعادة التحقق من السداد الزائد على الرصيد الحالي (منع تجاوز الرصيد بين الإنشاء والتأكيد)
      if (entry.entryType === 'payment') {
        const remaining = await this.confirmedRemainingForParty(
          entry.merchantUserId === session.userId ? (entry.merchantPartyId ?? '') : (entry.customerPartyId ?? ''),
          session.userId,
          'shared',
        )
        if (entry.amountMinor > remaining) {
          throw appError('over_payment', { remaining }, 'لا يمكن التأكيد: الرصيد المتبقي أقل من مبلغ السداد.')
        }
      }

      const profile = await this.requireProfile(session)
      const updated: FinancialEntry = {
        ...entry,
        status: 'confirmed',
        confirmedBy: session.userId,
        confirmedAt: nowISO(),
        confirmedByName: profile.fullName,
        updatedAt: nowISO(),
      }
      const db = await getDB()
      await db.put('entries', updated as unknown as Record<string, unknown>)
      await this.audit(entry.id, session.userId, 'confirmed', { status: 'confirmed' })
      this.emit({ table: 'entries', action: 'update', id, userId: session.userId })

      await this.notify(
        entry.creatorId,
        'entry_confirmed',
        `تم تأكيد العملية بقيمة ${(entry.amountMinor / 100).toLocaleString('en-US')}`,
        `${profile.fullName} أكّد ${entry.entryType === 'debt' ? 'الدين' : 'السداد'}`,
        'entry',
        entry.id,
      )

      // اعتماد الرصيد السابق يحدث بقيد افتتاحي مشترك
      if (entry.entryKind === 'reversal' && entry.reversesEntryId) {
        const original = (await db.get('entries', entry.reversesEntryId)) as Record<string, unknown> | undefined
        if (original) {
          await db.put('entries', {
            ...original,
            reversedByEntryId: entry.id,
            updatedAt: nowISO(),
          })
        }
      }

      return updated
    },

    reject: async (id, reason) => {
      const session = await this.requireSession()
      const entry = await this.getEntryOrThrow(id, session.userId)
      const check = canPerform('reject', entry, session.userId)
      if (!check.allowed) throw appError(check.code ?? 'forbidden')
      const profile = await this.requireProfile(session)

      const updated: FinancialEntry = {
        ...entry,
        status: 'rejected',
        reason: reason ?? null,
        rejectedBy: session.userId,
        rejectedAt: nowISO(),
        rejectedByName: profile.fullName,
        updatedAt: nowISO(),
      }
      const db = await getDB()
      await db.put('entries', updated as unknown as Record<string, unknown>)
      await this.audit(entry.id, session.userId, 'rejected', { reason: reason ?? null })
      this.emit({ table: 'entries', action: 'update', id, userId: session.userId })

      await this.notify(
        entry.creatorId,
        'entry_rejected',
        `تم رفض عملية بقيمة ${(entry.amountMinor / 100).toLocaleString('en-US')}`,
        reason ?? `${profile.fullName} رفض العملية`,
        'entry',
        entry.id,
      )
      return updated
    },

    cancel: async (id) => {
      const session = await this.requireSession()
      const entry = await this.getEntryOrThrow(id, session.userId)
      const check = canPerform('cancel', entry, session.userId)
      if (!check.allowed) throw appError(check.code ?? 'forbidden')

      const updated: FinancialEntry = { ...entry, status: 'cancelled', cancelledAt: nowISO(), updatedAt: nowISO() }
      const db = await getDB()
      await db.put('entries', updated as unknown as Record<string, unknown>)
      await this.audit(entry.id, session.userId, 'cancelled')
      this.emit({ table: 'entries', action: 'update', id, userId: session.userId })

      const other = counterpartyOf(entry, session.userId)
      if (other) {
        await this.notify(
          other,
          'entry_cancelled',
          `تم إلغاء عملية بقيمة ${(entry.amountMinor / 100).toLocaleString('en-US')}`,
          null,
          'entry',
          entry.id,
        )
      }
      return updated
    },

  }

  /* ============================ استعادة نسخة احتياطية ============================ */

  /**
   * دمج آمن: نضيف الناقص فقط، بلا حذف وبلا تكرار.
   * تُستعاد عمليات الدفتر الشخصي (solo) لأنها لا تعتمد على موافقة طرف آخر؛
   * والعمليات المشتركة تُترَك لأنها تحتاج تأكيد الطرفين الحقيقي.
   */
  async restore(payload: BackupPayload): Promise<RestoreResult> {
    const session = await this.requireSession()
    const uid = session.userId
    const db = await getDB()
    const now = nowISO()

    const myParties = ((await db.getAllFromIndex('parties', 'ownerId', uid)) as unknown as Party[]) ?? []
    const byName = new Map<string, string>()
    for (const party of myParties) {
      byName.set(`${party.kind}:${normalizeArabic(party.name).trim().toLowerCase()}`, party.id)
    }

    const idMap = new Map<string, string>()
    let partiesAdded = 0
    let entriesAdded = 0
    let skipped = 0

    for (const party of payload.parties) {
      const key = `${party.kind}:${normalizeArabic(party.name).trim().toLowerCase()}`
      const known = myParties.find((p) => p.id === party.id)
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
      // لا تُستعاد حالة الربط: الربط يحتاج موافقة الطرفين من جديد
      const restoredParty: Party = {
        ...party,
        ownerId: uid,
        linkedUserId: null,
        linkedProfileName: null,
        relationshipId: null,
        linkStatus: 'none',
        updatedAt: now,
      }
      await db.put('parties', restoredParty as unknown as Record<string, unknown>)
      idMap.set(party.id, restoredParty.id)
      byName.set(key, restoredParty.id)
      partiesAdded += 1
    }

    const myEntries = await this.visibleEntries(uid)
    const seenIds = new Set(myEntries.map((e) => e.id))
    const seenRefs = new Set(myEntries.map((e) => `${e.creatorId}:${e.clientRef}`))

    for (const entry of payload.entries) {
      // العمليات الشخصية فقط: المشتركة تعتمد على تأكيد الطرف الآخر ولا تُفرض من نسخة
      if (entry.scope !== 'solo') {
        skipped += 1
        continue
      }
      const refKey = `${uid}:${entry.clientRef ?? entry.id}`
      if (seenIds.has(entry.id) || seenRefs.has(refKey)) {
        skipped += 1
        continue
      }
      const sourcePartyId = entry.partyId ?? entry.merchantPartyId ?? entry.customerPartyId
      const partyId =
        (sourcePartyId ? idMap.get(sourcePartyId) : undefined) ??
        (sourcePartyId && myParties.some((p) => p.id === sourcePartyId) ? sourcePartyId : undefined)
      if (!partyId) {
        skipped += 1
        continue
      }

      const restored: FinancialEntry = {
        ...entry,
        partyId,
        ownerId: uid,
        creatorId: uid,
        updatedAt: now,
      }
      await db.put('entries', restored as unknown as Record<string, unknown>)
      await this.audit(restored.id, uid, 'restored', { fromBackup: payload.createdAt })
      seenIds.add(restored.id)
      seenRefs.add(refKey)
      entriesAdded += 1
    }

    if (partiesAdded > 0) this.emit({ table: 'parties', action: 'insert', id: 'restore', userId: uid })
    if (entriesAdded > 0) this.emit({ table: 'entries', action: 'insert', id: 'restore', userId: uid })

    return { parties: partiesAdded, entries: entriesAdded, skipped }
  }

  /* ============================ الربط بين الطرفين ============================ */

  readonly links: LinkPort = {
    createInvite: async () => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const db = await getDB()

      const token = generateToken(24)
      const request: LinkRequest = {
        id: uuid(),
        merchantUserId: session.userId,
        merchantName: profile.fullName,
        customerUserId: null,
        customerName: null,
        status: 'awaiting_scan',
        token,
        code: tokenToCode(token),
        expiresAt: expiryFromNow(LINK_TTL_MS),
        createdAt: nowISO(),
        updatedAt: nowISO(),
        usedAt: null,
        previousBalanceMinor: 0,
      }
      await db.put('linkRequests', request as unknown as Record<string, unknown>)
      this.emit({ table: 'link_requests', action: 'insert', id: request.id, userId: session.userId })
      return request
    },

    cancelInvite: async (id) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = (await db.get('linkRequests', id)) as Record<string, unknown> | undefined
      if (!row) throw appError('not_found')
      const request = row as unknown as LinkRequest
      if (request.merchantUserId !== session.userId) throw appError('forbidden')
      await db.put('linkRequests', { ...request, status: 'cancelled', updatedAt: nowISO() })
      this.emit({ table: 'link_requests', action: 'update', id, userId: session.userId })
    },

    previewInvite: async (token): Promise<LinkPreview> => {
      const session = await this.requireSession()
      if (!session) throw appError('unauthorized')
      const db = await getDB()
      const hash = await sha256Hex(token)

      const all = (await db.getAll('linkRequests')) as Record<string, unknown>[]
      const request = (all.find((r) => r.token === token || r.tokenHash === hash)) as unknown as LinkRequest | undefined
      assertLinkUsable(request ?? null)

      if (!request) throw appError('link_invalid')
      if (request.merchantUserId === session.userId) throw appError('self_link')

      // رصيد سابق مسجّل عند التاجر باسم العميل نفسه (لا يُدمج تلقائيًا)
      const profile = await this.requireProfile(session)
      const merchantParties = (await db.getAllFromIndex('parties', 'ownerId', request.merchantUserId)) as Record<string, unknown>[]
      const myKey = normalizeArabic(profile.fullName)
      const match = merchantParties.map(asParty).find((p) => p.searchKey === myKey && !p.archivedAt)

      let previousBalanceMinor = 0
      if (match) {
        previousBalanceMinor = await this.legacyRemainingForParty(match.id, request.merchantUserId)
      }

      const rels = (await db.getAllFromIndex('relationships', 'customerUserId', session.userId)) as Record<string, unknown>[]
      const alreadyLinked = rels.some((r) => (r as unknown as Relationship).merchantUserId === request.merchantUserId)

      return {
        merchantUserId: request.merchantUserId,
        merchantName: request.merchantName ?? 'تاجر',
        expiresAt: request.expiresAt,
        previousBalanceMinor,
        alreadyLinked,
      }
    },

    claimInvite: async (token) => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const db = await getDB()

      const all = (await db.getAll('linkRequests')) as Record<string, unknown>[]
      const row = all.find((r) => r.token === token) as Record<string, unknown> | undefined
      const request = row ? (row as unknown as LinkRequest) : null
      assertLinkUsable(request)
      if (!request) throw appError('link_invalid')
      if (request.merchantUserId === session.userId) throw appError('self_link')

      // رفض الربط المتكرر مع نفس التاجر
      const rels = (await db.getAllFromIndex('relationships', 'customerUserId', session.userId)) as Record<string, unknown>[]
      const alreadyLinked = rels.some(
        (r) => (r as unknown as Relationship).merchantUserId === request.merchantUserId,
      )
      if (alreadyLinked) throw appError('already_linked')

      const updated: LinkRequest = {
        ...request,
        customerUserId: session.userId,
        customerName: profile.fullName,
        status: 'pending',
        updatedAt: nowISO(),
      }
      await db.put('linkRequests', updated as unknown as Record<string, unknown>)
      this.emit({ table: 'link_requests', action: 'update', id: updated.id, userId: session.userId })

      await this.notify(
        request.merchantUserId,
        'link_request',
        `طلب ربط جديد من ${profile.fullName}`,
        'افتح قسم الربط للموافقة',
        'link',
        updated.id,
      )
      return updated
    },

    listRequests: async () => {
      const session = await this.requireSession()
      const db = await getDB()
      const [asMerchant, asCustomer] = await Promise.all([
        db.getAllFromIndex('linkRequests', 'merchantUserId', session.userId),
        db.getAll('linkRequests'),
      ])
      const map = new Map<string, LinkRequest>()
      for (const row of asMerchant) {
        const r = row as unknown as LinkRequest
        map.set(r.id, r)
      }
      for (const row of asCustomer) {
        const r = row as unknown as LinkRequest
        if (r.customerUserId === session.userId) map.set(r.id, r)
      }
      return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    acceptRequest: async (id) => {
      const session = await this.requireSession()
      const profile = await this.requireProfile(session)
      const db = await getDB()
      const row = (await db.get('linkRequests', id)) as Record<string, unknown> | undefined
      if (!row) throw appError('not_found')
      const request = row as unknown as LinkRequest
      if (request.merchantUserId !== session.userId) throw appError('forbidden')
      if (request.status !== 'pending' || !request.customerUserId) throw appError('conflict')
      assertLinkUsable({ expiresAt: request.expiresAt, status: request.status })

      const customerProfile = (await db.get('profiles', request.customerUserId)) as unknown as Profile | undefined

      // 1) الطرف الخاص بالعميل في دفتر التاجر (أو إعادة استخدام طرف قائم بالاسم)
      const merchantParties = (await db.getAllFromIndex('parties', 'ownerId', session.userId)) as Record<string, unknown>[]
      const customerKey = normalizeArabic(customerProfile?.fullName ?? request.customerName ?? '')
      let merchantParty = merchantParties
        .map(asParty)
        .find((p) => !p.archivedAt && p.searchKey === customerKey && p.linkStatus !== 'verified')

      if (!merchantParty) {
        merchantParty = {
          id: uuid(),
          ownerId: session.userId,
          kind: 'customer',
          name: customerProfile?.fullName ?? request.customerName ?? 'عميل',
          phone: null,
          address: null,
          note: null,
          searchKey: customerKey,
          linkedUserId: request.customerUserId,
          linkedProfileName: customerProfile?.fullName ?? null,
          relationshipId: null,
          linkStatus: 'pending',
          createdAt: nowISO(),
          updatedAt: nowISO(),
          archivedAt: null,
        }
        await db.put('parties', merchantParty as unknown as Record<string, unknown>)
      }

      // 2) الطرف الخاص بالتاجر في دفتر العميل
      const customerParties = (await db.getAllFromIndex('parties', 'ownerId', request.customerUserId)) as Record<string, unknown>[]
      const merchantKey = normalizeArabic(profile.fullName)
      let customerParty = customerParties
        .map(asParty)
        .find((p) => !p.archivedAt && p.searchKey === merchantKey && p.linkStatus !== 'verified')

      if (!customerParty) {
        customerParty = {
          id: uuid(),
          ownerId: request.customerUserId,
          kind: 'shop',
          name: profile.fullName,
          phone: null,
          address: null,
          note: null,
          searchKey: merchantKey,
          linkedUserId: session.userId,
          linkedProfileName: profile.fullName,
          relationshipId: null,
          linkStatus: 'pending',
          createdAt: nowISO(),
          updatedAt: nowISO(),
          archivedAt: null,
        }
        await db.put('parties', customerParty as unknown as Record<string, unknown>)
      }

      // 3) إنشاء العلاقة الموثّقة
      const relationship: Relationship = {
        id: uuid(),
        merchantUserId: session.userId,
        customerUserId: request.customerUserId,
        merchantPartyId: merchantParty.id,
        customerPartyId: customerParty.id,
        merchantName: profile.fullName,
        customerName: customerProfile?.fullName ?? request.customerName ?? null,
        status: 'verified',
        openingBalanceStatus: 'none',
        openingBalanceMinor: 0,
        createdAt: nowISO(),
        updatedAt: nowISO(),
      }
      await db.put('relationships', relationship as unknown as Record<string, unknown>)

      await db.put('parties', { ...merchantParty, linkStatus: 'verified', relationshipId: relationship.id, linkedUserId: request.customerUserId, linkedProfileName: customerProfile?.fullName ?? null })
      await db.put('parties', { ...customerParty, linkStatus: 'verified', relationshipId: relationship.id, linkedUserId: session.userId, linkedProfileName: profile.fullName })
      await db.put('linkRequests', { ...request, status: 'accepted', usedAt: nowISO(), updatedAt: nowISO() })

      this.emit({ table: 'relationships', action: 'insert', id: relationship.id, userId: session.userId })
      this.emit({ table: 'parties', action: 'update', id: merchantParty.id, userId: session.userId })
      this.emit({ table: 'parties', action: 'update', id: customerParty.id, userId: request.customerUserId })

      // 4) الرصيد السابق: نحسبه أولًا، ثم نفصله فورًا عن الرصيد الموثّق
      //    ويُعرض كاقتراح اعتماد — لا يُدمج أي سجل قديم إلا بموافقة صريحة
      const legacy = await this.legacyRemainingForParty(merchantParty.id, session.userId)
      await this.excludeLegacyEntries(relationship, 'legacy_unverified')
      if (legacy !== 0) {
        const proposal: BalanceProposal = {
          id: uuid(),
          relationshipId: relationship.id,
          proposedBy: session.userId,
          amountMinor: legacy,
          note: 'رصيد سابق مسجّل في دفترك قبل الربط',
          status: 'pending',
          respondedBy: null,
          respondedAt: null,
          createdAt: nowISO(),
        }
        await db.put('balanceProposals', proposal as unknown as Record<string, unknown>)
        relationship.openingBalanceStatus = 'proposed'
        relationship.openingBalanceMinor = legacy
        await db.put('relationships', { ...relationship })
        await this.notify(
          request.customerUserId,
          'balance_proposal',
          `يوجد رصيد سابق مسجّل بقيمة ${(legacy / 100).toLocaleString('en-US')} لدى ${profile.fullName}`,
          'راجع الرصيد واعتمده أو ابدأ حسابًا جديدًا',
          'relationship',
          relationship.id,
        )
      }

      await this.notify(
        request.customerUserId,
        'link_established',
        `تم الربط بنجاح مع ${profile.fullName}`,
        'أصبحت العمليات بينكما موثّقة وتحتاج تأكيد الطرفين',
        'relationship',
        relationship.id,
      )

      return relationship
    },

    rejectRequest: async (id, reason) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = (await db.get('linkRequests', id)) as Record<string, unknown> | undefined
      if (!row) throw appError('not_found')
      const request = row as unknown as LinkRequest
      if (request.merchantUserId !== session.userId) throw appError('forbidden')
      await db.put('linkRequests', { ...request, status: 'rejected', usedAt: nowISO(), updatedAt: nowISO() })
      this.emit({ table: 'link_requests', action: 'update', id, userId: session.userId })
      if (request.customerUserId) {
        await this.notify(request.customerUserId, 'link_rejected', 'تم رفض طلب الربط', reason ?? null, 'link', id)
      }
    },

    listRelationships: async () => {
      const session = await this.requireSession()
      const db = await getDB()
      const [asMerchant, asCustomer] = await Promise.all([
        db.getAllFromIndex('relationships', 'merchantUserId', session.userId),
        db.getAllFromIndex('relationships', 'customerUserId', session.userId),
      ])
      const map = new Map<string, Relationship>()
      for (const row of [...asMerchant, ...asCustomer]) {
        const r = row as unknown as Relationship
        map.set(r.id, r)
      }
      return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    endRelationship: async (id) => {
      const session = await this.requireSession()
      const rel = await this.getRelationshipOrThrow(id, session.userId)
      const db = await getDB()
      await db.put('relationships', { ...rel, status: 'ended', updatedAt: nowISO() })

      for (const pid of [rel.merchantPartyId, rel.customerPartyId]) {
        if (!pid) continue
        const row = await db.get('parties', pid)
        if (row) {
          await db.put('parties', { ...(row as Record<string, unknown>), linkStatus: 'none', relationshipId: null, linkedUserId: null, updatedAt: nowISO() })
        }
      }
      this.emit({ table: 'relationships', action: 'update', id, userId: session.userId })
    },

    listBalanceProposals: async () => {
      await this.requireSession()
      const rels = await this.links.listRelationships()
      const db = await getDB()
      const out: BalanceProposal[] = []
      for (const rel of rels) {
        const rows = (await db.getAllFromIndex('balanceProposals', 'relationshipId', rel.id)) as Record<string, unknown>[]
        for (const row of rows) out.push(row as unknown as BalanceProposal)
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    proposeOpeningBalance: async (relationshipId, amountMinor, note) => {
      const session = await this.requireSession()
      const rel = await this.getRelationshipOrThrow(relationshipId, session.userId)
      if (amountMinor <= 0) throw appError('invalid_amount')
      const db = await getDB()
      const proposal: BalanceProposal = {
        id: uuid(),
        relationshipId,
        proposedBy: session.userId,
        amountMinor,
        note: note ?? null,
        status: 'pending',
        respondedBy: null,
        respondedAt: null,
        createdAt: nowISO(),
      }
      await db.put('balanceProposals', proposal as unknown as Record<string, unknown>)
      await db.put('relationships', { ...rel, openingBalanceStatus: 'proposed', openingBalanceMinor: amountMinor, updatedAt: nowISO() })
      this.emit({ table: 'balance_proposals', action: 'insert', id: proposal.id, userId: session.userId })

      const other = rel.merchantUserId === session.userId ? rel.customerUserId : rel.merchantUserId
      await this.notify(
        other,
        'balance_proposal',
        `اقتراح اعتماد رصيد سابق بقيمة ${(amountMinor / 100).toLocaleString('en-US')}`,
        note ?? null,
        'relationship',
        relationshipId,
      )
      return proposal
    },

    respondProposal: async (id, accept) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = (await db.get('balanceProposals', id)) as Record<string, unknown> | undefined
      if (!row) throw appError('not_found')
      const proposal = row as unknown as BalanceProposal
      if (proposal.status !== 'pending') throw appError('already_decided')

      const rel = await this.getRelationshipOrThrow(proposal.relationshipId, session.userId)
      if (proposal.proposedBy === session.userId) throw appError('self_confirm')

      const status = accept ? 'accepted' : 'declined'
      await db.put('balanceProposals', {
        ...proposal,
        status,
        respondedBy: session.userId,
        respondedAt: nowISO(),
      } as unknown as Record<string, unknown>)

      // سبب الاستثناء يُحدَّث ليعكس القرار النهائي للطرفين
      await this.excludeLegacyEntries(rel, accept ? 'superseded_by_opening' : 'legacy_unverified')

      if (accept) {
        // قيد افتتاحي مشترك مؤكد — يصبح الرصيد السابق جزءًا من الحساب الموثّق
        await this.insertEntry({
          scope: 'shared',
          entryType: 'debt',
          entryKind: 'opening',
          status: 'confirmed',
          amountMinor: proposal.amountMinor,
          currency: 'YER',
          details: 'اعتماد رصيد سابق بالاتفاق',
          note: proposal.note,
          reason: null,
          occurredAt: nowISO(),
          creatorId: session.userId,
          creatorRole: rel.customerUserId === session.userId ? 'customer' : 'merchant',
          creatorName: null,
          ownerId: null,
          partyId: null,
          relationshipId: rel.id,
          merchantUserId: rel.merchantUserId,
          customerUserId: rel.customerUserId,
          merchantPartyId: rel.merchantPartyId,
          customerPartyId: rel.customerPartyId,
          confirmedBy: session.userId,
          confirmedAt: nowISO(),
          clientRef: `opening-shared:${rel.id}`,
        })
      }

      await db.put('relationships', {
        ...rel,
        openingBalanceStatus: accept ? 'accepted' : 'declined',
        updatedAt: nowISO(),
      })
      this.emit({ table: 'balance_proposals', action: 'update', id, userId: session.userId })

      const other = proposal.proposedBy
      await this.notify(
        other,
        accept ? 'balance_accepted' : 'balance_declined',
        accept ? 'تم اعتماد الرصيد السابق' : 'تم رفض اعتماد الرصيد السابق',
        null,
        'relationship',
        rel.id,
      )
    },
  }

  /**
   * يفصل السجلات المستقلة السابقة عن الرصيد الموثّق عند إنشاء علاقة رسمية.
   * السجل يبقى ظاهرًا كتاريخ، لكنه لا يُحتسب إلا بعد اعتماد صريح من الطرفين.
   */
  private async excludeLegacyEntries(rel: Relationship, reason: 'superseded_by_opening' | 'legacy_unverified'): Promise<void> {
    const db = await getDB()
    const all = (await db.getAll('entries')) as Record<string, unknown>[]
    for (const raw of all) {
      const entry = raw as unknown as FinancialEntry
      if (entry.scope !== 'solo' || entry.status !== 'confirmed') continue
      const belongs =
        entry.partyId === rel.merchantPartyId ||
        entry.partyId === rel.customerPartyId ||
        entry.merchantPartyId === rel.merchantPartyId ||
        entry.customerPartyId === rel.customerPartyId
      if (!belongs) continue
      await db.put('entries', { ...entry, excludedFromBalance: true, excludedReason: reason, updatedAt: nowISO() })
      this.emit({ table: 'entries', action: 'update', id: entry.id, userId: entry.ownerId ?? undefined })
    }
  }

  /**
   * الرصيد *السابق* لطرف يملكه مستخدم آخر (يُستخدم في معاينة الربط واعتماد الرصيد).
   * يحسب السجلات المستقلة المؤكدة وغير المستثناة فقط — لا يدخل أي شيء مشترك.
   */
  private async legacyRemainingForParty(partyId: string, ownerId: string): Promise<number> {
    const db = await getDB()
    const rows = (await db.getAllFromIndex('entries', 'ownerId', ownerId)) as Record<string, unknown>[]
    const scoped = rows
      .map(asEntry)
      .filter((e) => e.scope === 'solo' && e.partyId === partyId && !e.excludedFromBalance)
    return computeTotals(scoped, ownerId).remaining
  }

  /* ============================ الإشعارات ============================ */

  readonly notifications: NotificationPort = {
    list: async (query: NotificationQuery = {}): Promise<Page<AppNotification>> => {
      const session = await this.requireSession()
      const db = await getDB()
      let items = (await db.getAllFromIndex('notifications', 'userId', session.userId)) as Record<string, unknown>[]
      let list = items.map((r) => r as unknown as AppNotification)
      if (query.unreadOnly) list = list.filter((n) => !n.readAt)
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

      const limit = query.limit ?? 50
      const start = query.cursor ? list.findIndex((n) => n.id === query.cursor) + 1 : 0
      const slice = list.slice(start, start + limit)
      const hasMore = start + limit < list.length
      return { items: slice, nextCursor: hasMore && slice.length ? slice[slice.length - 1].id : null, hasMore }
    },

    unreadCount: async () => {
      const session = await this.currentSession()
      if (!session) return 0
      const db = await getDB()
      const rows = (await db.getAllFromIndex('notifications', 'userId', session.userId)) as Record<string, unknown>[]
      return rows.filter((r) => !(r as { readAt: string | null }).readAt).length
    },

    markRead: async (id) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = (await db.get('notifications', id)) as Record<string, unknown> | undefined
      if (!row) return
      const n = row as unknown as AppNotification
      if (n.userId !== session.userId) throw appError('forbidden')
      await db.put('notifications', { ...n, readAt: n.readAt ?? nowISO() })
      this.emit({ table: 'notifications', action: 'update', id, userId: session.userId })
    },

    markAllRead: async () => {
      const session = await this.requireSession()
      const db = await getDB()
      const rows = (await db.getAllFromIndex('notifications', 'userId', session.userId)) as Record<string, unknown>[]
      for (const row of rows) {
        const n = row as unknown as AppNotification
        if (!n.readAt) await db.put('notifications', { ...n, readAt: nowISO() })
      }
      this.emit({ table: 'notifications', action: 'update', userId: session.userId })
    },

    remove: async (id) => {
      const session = await this.requireSession()
      const db = await getDB()
      const row = await db.get('notifications', id)
      if (!row) return
      if ((row as unknown as AppNotification).userId !== session.userId) throw appError('forbidden')
      await db.delete('notifications', id)
      this.emit({ table: 'notifications', action: 'delete', id, userId: session.userId })
    },
  }

  /* ============================ المزامنة ============================ */

  readonly sync: SyncPort = {
    state: () => ({ ...this.state, lastSyncedAt: readLastSynced() }),
    onChange: (cb) => {
      this.syncListeners.add(cb)
      cb(this.sync.state())
      return () => this.syncListeners.delete(cb)
    },
    sync: async (): Promise<SyncResult> => {
      // المحرّك المحلي لا يحتاج إرسالًا: البيانات محفوظة على الجهاز
      const next: SyncState = { ...this.state, syncing: false, pendingCount: 0, lastSyncedAt: nowISO(), lastError: null }
      this.state = next
      if (next.lastSyncedAt) writeLastSynced(next.lastSyncedAt)
      this.syncListeners.forEach((cb) => cb(next))
      return { pushed: 0, pulled: 0, failed: 0, errors: [] }
    },
    retry: async () => {
      await this.sync.sync()
    },
  }

  /* ============================ الاشتراك اللحظي ============================ */

  subscribe(cb: (event: DataEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async resetUserData(): Promise<void> {
    const session = await this.requireSession()
    const db = await getDB()
    const uid = session.userId

    const parties = (await db.getAllFromIndex('parties', 'ownerId', uid)) as Record<string, unknown>[]
    for (const p of parties) await db.delete('parties', (p as { id: string }).id)

    const entries = await this.visibleEntries(uid)
    for (const e of entries) if (e.creatorId === uid || e.ownerId === uid || e.merchantUserId === uid || e.customerUserId === uid) await db.delete('entries', e.id)

    const notifs = (await db.getAllFromIndex('notifications', 'userId', uid)) as Record<string, unknown>[]
    for (const n of notifs) await db.delete('notifications', (n as { id: string }).id)

    const rels = (await db.getAllFromIndex('relationships', 'merchantUserId', uid)) as Record<string, unknown>[]
    for (const r of rels) await db.delete('relationships', (r as { id: string }).id)

    this.emit({ table: 'entries', action: 'delete', userId: uid })
    this.emit({ table: 'parties', action: 'delete', userId: uid })
  }
}

/* ============================ تخزين قيم صغيرة ============================ */

const LAST_SYNC_KEY = 'dafatar.lastSyncedAt'

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

/** أدوار مساعدة */
export function roleFromPartyKind(kind: PartyKind): Role {
  return kind === 'customer' ? 'merchant' : 'customer'
}

export { type UserRow }
export type { EntryType }
