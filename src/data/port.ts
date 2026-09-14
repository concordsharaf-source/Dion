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

import type { BackupPayload } from '@/core/backup'
import type { EmailLinkType } from '@/core/emailLink'
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
  /** رقم الهاتف (يُحفظ مع بيانات المستخدم) */
  phone?: string | null
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
  createProfile(input: { fullName: string; role: Role; currency?: string; phone?: string | null }): Promise<Profile>
  onAuthStateChange(cb: (session: AuthSession | null) => void): () => void
  /** تغيير كلمة المرور (مستخدم مسجّل) */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>
  /**
   * بدء سريع على الجهاز — متاح في المحرّك المحلي فقط.
   * يُنشئ حسابًا محليًا باسم ورقم عشوائي غير معروض (لا حاجة لبريد إلكتروني).
   */
  signInQuick?(input: { fullName: string; role: Role }): Promise<AuthSession>
  /** حسابات محفوظة على هذا الجهاز (وضع الدفتر المحلي) */
  listDeviceAccounts?(): Promise<DeviceAccount[]>
  /** دخول بحساب محفوظ على هذا الجهاز بلا كلمة مرور (وضع الدفتر المحلي) */
  signInAsDeviceAccount?(accountId: string): Promise<AuthSession>
  /**
   * إنشاء حساب على هذا الجهاز: الاسم + رقم الهاتف + كلمة المرور.
   * تبقى البيانات محفوظة على الجهاز، ويستطيع المستخدم الدخول بها بعد الخروج.
   */
  signUpDevice?(input: { fullName: string; phone: string; password: string; role: Role }): Promise<AuthSession>
  /** دخول برقم الهاتف (أو البريد) وكلمة المرور لحساب محفوظ على هذا الجهاز */
  signInDevice?(input: { identifier: string; password: string }): Promise<AuthSession>
  /**
   * استعادة كلمة المرور على هذا الجهاز بعد التحقق من رقم الهاتف المسجّل.
   * (في الوضع السحابي تُستعاد عبر رابط يُرسل إلى البريد)
   */
  resetDevicePassword?(input: { phone: string; newPassword: string }): Promise<void>
  /** إرسال رابط استعادة كلمة المرور إلى البريد (الوضع السحابي) */
  resetPassword?(email: string): Promise<void>
  /** هل يوجد حساب بهذا المعرّف على هذا الجهاز؟ (لتوجيه رسائل الاستعادة) */
  findDeviceAccount?(identifier: string): Promise<DeviceAccount | null>
  /**
   * تأكيد رابط أُرسل إلى البريد (`?token_hash=…&type=…`) — الوضع السحابي فقط.
   * يُرجع الجلسة بعد التحقق (وnull إن لم يُنشأ رمز الدخول).
   */
  verifyEmailLink?(params: { tokenHash: string; type: EmailLinkType }): Promise<AuthSession | null>
  /** إعادة إرسال رابط تأكيد الحساب إلى البريد — الوضع السحابي فقط */
  resendConfirmation?(email: string): Promise<void>
}

/** حساب محفوظ على الجهاز — للتبديل السريع وبلا كتابة كلمة المرور */
export interface DeviceAccount {
  id: string
  fullName: string
  role: Role
  createdAt: string
  /** رقم الهاتف المسجّل (يُستخدم للدخول والاستعادة) */
  phone?: string | null
  /** البريد الإلكتروني إن وُجد */
  email?: string | null
}

/* ============================ إشعارات الدفع ============================ */

/** اشتراك دفع محفوظ في الخادم (Web Push) */
export interface StoredPushSubscription {
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string | null
}

/** تطبيق إشعارات الويب — يُنفّذه المحرّك السحابي فقط */
export interface PushPort {
  saveSubscription(input: StoredPushSubscription): Promise<void>
  removeSubscription(endpoint: string): Promise<void>
  hasSubscription(endpoint: string): Promise<boolean>
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

/** نتيجة استعادة نسخة احتياطية */
export interface RestoreResult {
  parties: number
  entries: number
  /** عناصر تُخطّيت (موجودة سابقًا أو لا تخصّ هذا الدفتر) */
  skipped: number
}

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
  /** اشتراكات إشعارات الدفع — الوضع السحابي فقط */
  push?: PushPort
  /** الأحداث اللحظية (Realtime) */
  subscribe(cb: (event: DataEvent) => void): () => void
  /** تفريغ كل بيانات المستخدم الحالي (للتطوير/الخروج الكامل) */
  resetUserData?(): Promise<void>
  /** استعادة نسخة احتياطية — دمج بلا حذف وبلا تكرار (حسب دعم المحرّك) */
  restore?(payload: BackupPayload): Promise<RestoreResult>
}
