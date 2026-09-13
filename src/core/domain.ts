/**
 * نموذج النطاق (Domain Model) — الأنواع + آلة حالات العملية المالية
 *
 * هذا الملف خالص: لا React، ولا شبكة، ولا قاعدة بيانات. قابل للاختبار بنسبة 100%.
 */

import type { Minor } from './money'
import { appError } from './errors'
import type { ErrorCode } from './errors'

/* ============================ الأنواع الأساسية ============================ */

/** دور المستخدم */
export type Role = 'customer' | 'merchant'

/** نوع الطرف المقابل في الدفتر */
export type PartyKind = 'shop' | 'customer'

/** نوع الحركة: دين (التزام) أو سداد (تسوية) */
export type EntryType = 'debt' | 'payment'

/**
 * حالة العملية:
 *  pending    معلّقة تنتظر موافقة الطرف الآخر
 *  confirmed  مؤكدة ومحتسبة في الرصيد
 *  rejected   مرفوضة (سبب اختياري)
 *  cancelled  ملغاة بواسطة المنشئ قبل التأكيد
 */
export type EntryStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled'

/**
 * طبيعة القيد:
 *  normal   قيد عادي
 *  opening  رصيد افتتاحي عند إنشاء الطرف
 *  reversal قيد عكسي يعادل أثر قيد سابق (لا نعدّل التاريخ المالي)
 */
export type EntryKind = 'normal' | 'opening' | 'reversal'

/** نطاق العملية: مستقلة (دفتر شخصي) أم مشتركة (تحتاج مصادقة الطرف الآخر) */
export type EntryScope = 'solo' | 'shared'

/* ============================ المستخدم والملف الشخصي ============================ */

export interface Profile {
  id: string
  role: Role
  /** أدوار إضافية مستقبلًا (حساب متعدد الأدوار) */
  roles: Role[]
  fullName: string
  phone: string | null
  currency: string
  theme: 'light' | 'dark' | 'system'
  numerals: 'latin' | 'arabic'
  createdAt: string
  updatedAt: string
}

/* ============================ الطرف المقابل (محل / عميل) ============================ */

export type LinkStatus = 'none' | 'pending' | 'verified'

export interface Party {
  id: string
  /** صاحب الدفتر الذي يملك هذا السجل */
  ownerId: string
  /** محل (في دفتر عميل) أو عميل (في دفتر تاجر) */
  kind: PartyKind
  name: string
  phone: string | null
  address: string | null
  note: string | null
  /** اسم مُختصر للبحث */
  searchKey: string
  /** حساب مرتبط (إن وُجد) */
  linkedUserId: string | null
  linkedProfileName: string | null
  relationshipId: string | null
  linkStatus: LinkStatus
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

/* ============================ العملية المالية ============================ */

export interface FinancialEntry {
  id: string
  scope: EntryScope
  entryType: EntryType
  entryKind: EntryKind
  status: EntryStatus
  amountMinor: Minor
  currency: string
  details: string | null
  note: string | null
  /** سبب الرفض */
  reason: string | null

  /** وقت الواقعة (قد يسبق وقت الإنشاء عند الكتابة بلا اتصال) */
  occurredAt: string
  createdAt: string
  updatedAt: string

  /** منشئ العملية (المستخدم الحقيقي) */
  creatorId: string
  creatorRole: Role
  creatorName: string | null

  /* --- الوضع المستقل --- */
  /** صاحب الدفتر في الوضع المستقل */
  ownerId: string | null
  /** الطرف في دفتر صاحب الدفتر (الوضع المستقل) */
  partyId: string | null

  /* --- الوضع المشترك --- */
  relationshipId: string | null
  merchantUserId: string | null
  customerUserId: string | null
  merchantPartyId: string | null
  customerPartyId: string | null

  /* --- المصادقة --- */
  confirmedBy: string | null
  confirmedAt: string | null
  confirmedByName: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectedByName: string | null
  cancelledAt: string | null

  /* --- العكس والتصحيح --- */
  reversesEntryId: string | null
  reversedByEntryId: string | null

  /** معرّف من الجهاز لمنع الإرسال المزدوج */
  clientRef: string
  /** بانتظار المزامنة (أُدخلت بلا اتصال) */
  pendingSync?: boolean

  /**
   * مستثناة من الرصيد الموثّق — تُستخدم عند تحويل علاقة مستقلة إلى مشتركة.
   * السجل السابق يبقى ظاهرًا كتاريخ، لكنه لا يُدمج ماليًا إلا بموافقة صريحة.
   */
  excludedFromBalance: boolean
  excludedReason: 'superseded_by_opening' | 'legacy_unverified' | null
}

/* ============================ العلاقة بين العميل والتاجر ============================ */

export type RelationshipStatus = 'verified' | 'ended'

export interface Relationship {
  id: string
  merchantUserId: string
  customerUserId: string
  merchantPartyId: string | null
  customerPartyId: string | null
  merchantName: string | null
  customerName: string | null
  status: RelationshipStatus
  /** نتيجة اعتماد الرصيد السابق */
  openingBalanceStatus: 'none' | 'proposed' | 'accepted' | 'declined'
  openingBalanceMinor: Minor
  createdAt: string
  updatedAt: string
}

/* ============================ طلبات الربط ============================ */

export type LinkRequestStatus = 'awaiting_scan' | 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'

export interface LinkRequest {
  id: string
  merchantUserId: string
  merchantName: string | null
  customerUserId: string | null
  customerName: string | null
  status: LinkRequestStatus
  /** رمز عشوائي قصير العمر — لا يحتوي أي بيانات مالية */
  token: string
  /** رمز يدوي قابل للنسخ لتسهيل الإدخال */
  code: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  usedAt: string | null
  /** عرض الرصيد السابق عند الربط (لا يُدمج تلقائيًا) */
  previousBalanceMinor: Minor
}

/* ============================ اعتماد الرصيد السابق ============================ */

export interface BalanceProposal {
  id: string
  relationshipId: string
  /** الطرف الذي اقترح */
  proposedBy: string
  amountMinor: Minor
  note: string | null
  status: 'pending' | 'accepted' | 'declined'
  respondedBy: string | null
  respondedAt: string | null
  createdAt: string
}

/* ============================ الإشعارات ============================ */

export type NotificationKind =
  | 'entry_created'
  | 'entry_confirmed'
  | 'entry_rejected'
  | 'entry_cancelled'
  | 'entry_reversal'
  | 'link_request'
  | 'link_accepted'
  | 'link_rejected'
  | 'link_established'
  | 'balance_proposal'
  | 'balance_accepted'
  | 'balance_declined'
  | 'sync'

export interface AppNotification {
  id: string
  userId: string
  kind: NotificationKind
  title: string
  body: string | null
  /** مرجع للانتقال عند الضغط */
  refType: 'entry' | 'party' | 'link' | 'relationship' | null
  refId: string | null
  readAt: string | null
  createdAt: string
}

/* ============================ آلة الحالات ============================ */

export type EntryAction = 'confirm' | 'reject' | 'cancel' | 'reverse'

const ACTION_RESULT: Record<EntryAction, EntryStatus | 'reversed'> = {
  confirm: 'confirmed',
  reject: 'rejected',
  cancel: 'cancelled',
  reverse: 'reversed',
}

export interface ActionCheck {
  allowed: boolean
  code?: ErrorCode
  userMessage?: string
}

const ALLOWED: ActionCheck = { allowed: true }

function deny(code: ErrorCode): ActionCheck {
  const e = appError(code)
  return { allowed: false, code, userMessage: e.userMessage }
}

/**
 * هل يملك هذا المستخدم تنفيذ هذا الإجراء على هذه العملية؟
 * القاعدة الجوهرية: المنشئ لا يؤكد عمليته، والتأكيد من الطرف الآخر الحقيقي فقط.
 */
export function canPerform(action: EntryAction, entry: FinancialEntry, actorId: string): ActionCheck {
  if (!actorId) return deny('unauthorized')

  switch (action) {
    case 'confirm':
    case 'reject': {
      if (entry.status !== 'pending') return deny('already_decided')
      if (entry.scope !== 'shared') {
        // في الوضع المستقل لا يوجد طرف آخر: العملية تُعتمد فور تسجيلها
        return deny('forbidden')
      }
      const isCounterparty = actorId === entry.merchantUserId || actorId === entry.customerUserId
      if (!isCounterparty) return deny('forbidden')
      if (actorId === entry.creatorId) return deny('self_confirm')
      return ALLOWED
    }
    case 'cancel': {
      if (entry.status !== 'pending') return deny('already_decided')
      if (actorId !== entry.creatorId) return deny('forbidden')
      return ALLOWED
    }
    case 'reverse': {
      if (entry.status !== 'confirmed') return deny('entry_locked')
      const isParty = actorId === entry.creatorId || actorId === entry.merchantUserId || actorId === entry.customerUserId
      if (!isParty) return deny('forbidden')
      if (entry.reversedByEntryId) return deny('conflict')
      if (entry.entryKind === 'reversal') return deny('forbidden')
      return ALLOWED
    }
    default:
      return deny('unknown')
  }
}

export function resultStatusFor(action: EntryAction): EntryStatus | 'reversed' {
  return ACTION_RESULT[action]
}

/* ============================ أثر القيد على الرصيد ============================ */

/**
 * أثر العملية على رصيد الطرف:
 *   دين     → +المبلغ (يزيد ما على الطرف)
 *   سداد    → −المبلغ (ينقص ما على الطرف)
 *   قيد عكسي → يعكس أثر القيد الأصلي تمامًا
 *
 * ملاحظة مهمة: هذا الأثر واحد للعميل والتاجر.
 * «المتبقي عليّ» لدى العميل و«المتبقي لدى العملاء» لدى التاجر
 * كلاهما = مجموع الديون المؤكدة − مجموع السدادات المؤكدة.
 */
export function entryEffect(entry: Pick<FinancialEntry, 'entryType' | 'entryKind' | 'amountMinor'>): Minor {
  const base = entry.entryType === 'debt' ? entry.amountMinor : -entry.amountMinor
  return entry.entryKind === 'reversal' ? -base : base
}

/**
 * هل هذه العملية مؤثرة في الرصيد الموثّق؟
 * شرطان: أن تكون مؤكدة، وألّا تكون مستثناة (سجل سابق غير مدموج).
 */
export function countsInBalance(
  entry: Pick<FinancialEntry, 'status'> & Partial<Pick<FinancialEntry, 'excludedFromBalance'>>,
): boolean {
  return entry.status === 'confirmed' && !entry.excludedFromBalance
}

/**
 * هل تظهر هذه العملية لهذا المستخدم؟
 * مستقل: لصاحب الدفتر فقط. مشترك: لطرفي العلاقة فقط.
 */
export function isVisibleTo(entry: FinancialEntry, viewerId: string): boolean {
  if (entry.scope === 'solo') return entry.ownerId === viewerId
  return entry.merchantUserId === viewerId || entry.customerUserId === viewerId
}

/**
 * معرف الطرف في دفتر المشاهد (المحل أو العميل).
 * هو ما يربط العملية الواحدة بدفتر كل طرف.
 */
export function partyIdForViewer(entry: FinancialEntry, viewerId: string): string | null {
  if (entry.scope === 'solo') return entry.ownerId === viewerId ? entry.partyId : null
  if (viewerId === entry.merchantUserId) return entry.merchantPartyId
  if (viewerId === entry.customerUserId) return entry.customerPartyId
  return null
}

/** الطرف الآخر في العلاقة المشتركة */
export function counterpartyOf(entry: FinancialEntry, viewerId: string): string | null {
  if (entry.scope === 'solo') return null
  if (viewerId === entry.merchantUserId) return entry.customerUserId
  if (viewerId === entry.customerUserId) return entry.merchantUserId
  return null
}

/** هل العملية بانتظار تأكيد *هذا* المستخدم؟ */
export function awaitsMyConfirmation(entry: FinancialEntry, viewerId: string): boolean {
  return entry.status === 'pending' && entry.scope === 'shared' && entry.creatorId !== viewerId && counterpartyOf(entry, viewerId) !== null
}

/** وصف نصي مختصر للعملية من منظور المشاهد */
export function describeEntry(entry: FinancialEntry, viewerId: string): string {
  const isMine = entry.creatorId === viewerId
  if (entry.entryType === 'debt') return isMine ? 'سجّلت دينًا' : 'سُجّل عليك دين'
  return isMine ? 'سجّلت سدادًا' : 'سُجّل لك سداد'
}
