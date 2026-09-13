/**
 * واجهة طبقة البيانات (Port) — العقد الوحيد الذي تعرفه الواجهة
 *
 * يوجد تنفيذان لنفس العقد:
 *   - LocalDataSource    : محرّك كامل على IndexedDB (بلا إنترنت / بلا حساب سحابي)
 *   - SupabaseDataSource : PostgreSQL + Auth + Realtime عبر Supabase
 *
 * الواجهة (UI) لا تعرف أي شيء عن Supabase. هذا ما يجعل:
 *   1) الاختبار ممكنًا بالكامل بلا شبكة
 *   2) التحويل لاحقًا إلى Capacitor/Android مباشرًا
 *   3) التبديل بين المحرّكين سطرًا واحدًا في الإعدادات
 */

import type {
  AppNotification,
  BalanceProposal,
  EntryType,
  FinancialEntry,
  LinkRequest,
  Party,
  PartyKind,
  Profile,
  Relationship,
  Role,
} from '@/core/domain'

/* ============================ عناصر عامة ============================ */

export interface Page<T> {
  items: T[]
  /** مؤشر الصفحة التالية — عند null لا يوجد المزيد */
  nextCursor: string | null
  hasMore: boolean
}

export interface AuthSession {
  userId: string
  email: string | null
  createdAt: string
}

export interface DataEvent {
  table: 'entries' | 'parties' | 'notifications' | 'link_requests' | 'relationships' | 'balance_proposals' | 'profile'
  action: 'insert' | 'update' | 'delete'
  id?: string
  /** userId المتأثر — لتصفية الأحداث */
  userId?: string
}

export interface SyncState {
  online: boolean
  syncing: boolean
  /** عدد العمليات بانتظار الإرسال */
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

export interface SyncResult {
  pushed: number
  pulled: number
  failed: number
  errors: string[]
}

/* ============================ المصادقة ============================ */

export interface SignUpInput {
  email: string
  password: string
  fullName: string
  role: Role
}

export interface SignInInput {
  email: string
  password: string
}

export interface SignUpResult {
  session: AuthSession | null
  /** يحتاج تأكيد البريد */
  needsEmailConfirmation: boolean
}

export interface AuthPort {
  getSession(): Promise<AuthSession | null>
  /** الملف الشخصي للمستخدم الحالي (null قبل إتمام الإعداد) */
  getProfile(): Promise<Profile | null>
  signUp(input: SignUpInput): Promise<SignUpResult>
  signIn(input: SignInInput): Promise<AuthSession>
  signOut(): Promise<void>
  updateProfile(patch: Partial<Pick<Profile, 'fullName' | 'role' | 'currency' | 'theme' | 'numerals' | 'phone'>>): Promise<Profile>
  /** إنشاء الملف الشخصي بعد التسجيل (اختيار الدور) */
  createProfile(input: { fullName: string; role: Role; currency?: string }): Promise<Profile>
  onAuthStateChange(cb: (session: AuthSession | null) => void): () => void
  /** تغيير كلمة المرور (مستخدم مسجّل) */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>
  /**
   * بدء سريع على الجهاز — متاح في المحرّك المحلي فقط.
   * يُنشئ حسابًا محليًا باسم ورقم عشوائي غير معروض (لا حاجة لبريد إلكتروني).
   */
  signInQuick?(input: { fullName: string; role: Role }): Promise<AuthSession>
}

/* ============================ الأطراف (محل / عميل) ============================ */

export interface CreatePartyDTO {
  kind: PartyKind
  name: string
  phone?: string | null
  address?: string | null
  note?: string | null
  openingAmountMinor?: number
}

export interface PartyQuery {
  query?: string
  limit?: number
  cursor?: string | null
  includeArchived?: boolean
}

export interface PartyPort {
  list(query?: PartyQuery): Promise<Page<Party>>
  get(id: string): Promise<Party | null>
  create(input: CreatePartyDTO): Promise<Party>
  update(id: string, patch: Partial<CreatePartyDTO>): Promise<Party>
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  /** الأطراف المرتبطة بحساب حقيقي */
  listLinked(): Promise<Party[]>
}

/* ============================ العمليات المالية ============================ */

export interface CreateEntryDTO {
  partyId: string
  entryType: EntryType
  amountMinor: number
  currency: string
  details?: string | null
  note?: string | null
  occurredAt?: string
  /** معرّف من الجهاز — يمنع تسجيل العملية مرتين */
  clientRef: string
}

export interface EntryQuery {
  partyId?: string
  status?: FinancialEntry['status'] | 'all'
  entryType?: EntryType | 'all'
  /** تصفية: ما ينتظر تأكيدي · ما سجّلته أنا */
  filter?: 'all' | 'awaiting_me' | 'created_by_me' | 'pending' | 'confirmed'
  from?: string
  to?: string
  limit?: number
  cursor?: string | null
  /** ترتيب */
  order?: 'desc' | 'asc'
}

export interface EntryPort {
  list(query?: EntryQuery): Promise<Page<FinancialEntry>>
  get(id: string): Promise<FinancialEntry | null>
  create(input: CreateEntryDTO): Promise<FinancialEntry>
  confirm(id: string): Promise<FinancialEntry>
  reject(id: string, reason?: string | null): Promise<FinancialEntry>
  cancel(id: string): Promise<FinancialEntry>
  /** عكس عملية مؤكدة بقيد جديد (لا تعديل صامت) */
  reverse(id: string, note?: string | null): Promise<FinancialEntry>
  countAwaitingMe(): Promise<number>
  /** كل عمليات طرف واحد (لحساب رصيده) */
  listByParty(partyId: string): Promise<FinancialEntry[]>
}

/* ============================ الربط بين الطرفين ============================ */

export interface LinkPreview {
  merchantUserId: string
  merchantName: string
  expiresAt: string
  /** رصيد سابق مسجّل عند التاجر (لا يُدمج تلقائيًا) */
  previousBalanceMinor: number
  alreadyLinked: boolean
}

export interface LinkPort {
  /** التاجر: إنشاء رمز ربط مؤقت */
  createInvite(): Promise<LinkRequest>
  /** التاجر: إلغاء رمز لم يُستخدم */
  cancelInvite(id: string): Promise<void>
  /** العميل: معاينة رمز قبل الموافقة (الاسم فقط) */
  previewInvite(token: string): Promise<LinkPreview>
  /** العميل: الموافقة المبدئية → إنشاء طلب معلّق بانتظار التاجر */
  claimInvite(token: string): Promise<LinkRequest>
  listRequests(): Promise<LinkRequest[]>
  /** التاجر: الموافقة النهائية → إنشاء العلاقة */
  acceptRequest(id: string): Promise<Relationship>
  rejectRequest(id: string, reason?: string | null): Promise<void>
  listRelationships(): Promise<Relationship[]>
  endRelationship(id: string): Promise<void>
  listBalanceProposals(): Promise<BalanceProposal[]>
  respondProposal(id: string, accept: boolean): Promise<void>
  /** اقتراح اعتماد رصيد سابق */
  proposeOpeningBalance(relationshipId: string, amountMinor: number, note?: string | null): Promise<BalanceProposal>
}

/* ============================ الإشعارات ============================ */

export interface NotificationQuery {
  limit?: number
  cursor?: string | null
  unreadOnly?: boolean
}

export interface NotificationPort {
  list(query?: NotificationQuery): Promise<Page<AppNotification>>
  unreadCount(): Promise<number>
  markRead(id: string): Promise<void>
  markAllRead(): Promise<void>
  remove(id: string): Promise<void>
}

/* ============================ المزامنة ============================ */

export interface SyncPort {
  state(): SyncState
  sync(): Promise<SyncResult>
  onChange(cb: (state: SyncState) => void): () => void
  /** يعيد المحاولة الآن */
  retry(): Promise<void>
}

/* ============================ العقد الكامل ============================ */

export interface DataSource {
  readonly kind: 'local' | 'supabase'
  /** هل يدعم الربط بين حسابين والمزامنة اللحظية؟ */
  readonly supportsShared: boolean
  auth: AuthPort
  parties: PartyPort
  entries: EntryPort
  links: LinkPort
  notifications: NotificationPort
  sync: SyncPort
  /** الأحداث اللحظية (Realtime) */
  subscribe(cb: (event: DataEvent) => void): () => void
  /** تفريغ كل بيانات المستخدم الحالي (للتطوير/الخروج الكامل) */
  resetUserData?(): Promise<void>
}
