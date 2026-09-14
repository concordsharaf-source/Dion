/**
 * ربط حساب الجهاز بحساب سحابي — «أضف بريدك الإلكتروني» من الإعدادات.
 *
 * الفكرة: المستخدم يبدأ دفتره على جهازه بلا بريد إلكتروني إطلاقًا.
 * ومتى أراد المزامنة بين الأجهزة والعمليات المشتركة والإشعارات، يضيف بريده
 * من الإعدادات ⇒ ننشئ له حسابًا سحابيًا بالاسم والهاتف والدور نفسه،
 * **وننقل دفتره المحلي كاملًا** ثم نُشغّل الوضع السحابي.
 *
 * إن طلب المزوّد تأكيد البريد (قبل تشغيل SMTP مثلًا) نحفظ نسخة الدفتر
 * في الجهاز، وتُنقل تلقائيًا بعد التأكيد ودخول الحساب (انظر CloudTransferWatcher).
 */

import { appError } from '@/core/errors'
import type { BackupPayload } from '@/core/backup'
import type { Profile } from '@/core/domain'
import type { DataSource, RestoreResult } from '@/data/port'
import { collectBackup } from './backup'

/** نسخة الدفتر بانتظار النقل إلى الحساب السحابي (تخزين مؤقت على الجهاز) */
const PENDING_KEY = 'dafatar.cloud.transfer'
/** إشعار يُعرض مرة واحدة بعد إعادة التحميل */
const NOTICE_KEY = 'dafatar.cloud.notice'

export interface LinkCloudResult {
  /** يحتاج تأكيد البريد قبل إنشاء الجلسة */
  needsConfirmation: boolean
  /** نتيجة نقل الدفتر المحلي (null إن لم يحدث بعد) */
  transferred: RestoreResult | null
}

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function readCloudNotice(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage.getItem(NOTICE_KEY)
  } catch {
    return null
  }
}

export function takeCloudNotice(): string | null {
  const value = readCloudNotice()
  writeSession(NOTICE_KEY, null)
  return value
}

export function writeCloudNotice(message: string): void {
  writeSession(NOTICE_KEY, message)
}

/* ============================ نسخة الدفتر المعلّقة ============================ */

export function stashPendingTransfer(payload: BackupPayload): void {
  const target = store()
  if (!target) return
  try {
    target.setItem(PENDING_KEY, JSON.stringify(payload))
  } catch {
    /* الذاكرة ممتلئة — نتابع بلا نقل تلقائي */
  }
}

export function readPendingTransfer(): BackupPayload | null {
  const target = store()
  if (!target) return null
  try {
    const raw = target.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BackupPayload
    return Array.isArray(parsed?.parties) && Array.isArray(parsed?.entries) ? parsed : null
  } catch {
    return null
  }
}

export function clearPendingTransfer(): void {
  try {
    store()?.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

/* ============================ الربط ============================ */

/** بيانات الحساب السحابي تُبنى من ملف المستخدم المحلي */
export function cloudSignUpPayload(profile: Profile, email: string, password: string) {
  return {
    email: email.trim().toLowerCase(),
    password,
    fullName: profile.fullName,
    role: profile.role,
    phone: profile.phone ?? null,
  }
}

function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'conflict'
}

/**
 * ينقل دفتر الجهاز إلى الحساب السحابي (دمج بلا حذف وبلا تكرار).
 * عند الفشل تُحفظ النسخة للنقل التلقائي لاحقًا — لا تضيع بيانات المستخدم.
 */
export async function transferLocalBook(
  cloud: DataSource,
  local: DataSource,
  profile: Profile,
): Promise<RestoreResult | null> {
  if (!cloud.restore) return null
  const payload = await collectBackup(local, profile)
  if (payload.parties.length === 0 && payload.entries.length === 0) return { parties: 0, entries: 0, skipped: 0 }
  return cloud.restore(payload)
}

/**
 * يضيف بريدًا إلكترونيًا لحساب الجهاز ⇒ حساب سحابي.
 * ترتيب الخطوات مهم: الملف الشخصي أولًا (تعتمد عليه طبيعة الأطراف في النقل),
 * ثم نقل الدفتر، ثم يستدعي المُنادي تفعيل الوضع السحابي وإعادة التحميل.
 */
export async function linkCloudAccount(input: {
  /** محرّك سحابي جديد (يُحقن للاختبار) */
  cloud: DataSource
  /** محرّك الجهاز الحالي الذي يحمل الدفتر */
  local: DataSource
  profile: Profile
  email: string
  password: string
}): Promise<LinkCloudResult> {
  const { cloud, local, profile } = input

  if (!cloud.auth.signUp || !cloud.auth.signIn) {
    throw appError('not_configured', undefined, 'الحساب السحابي غير متاح — تحقّق من إعدادات المشروع.')
  }

  let needsConfirmation = false

  try {
    const result = await cloud.auth.signUp(cloudSignUpPayload(profile, input.email, input.password))
    needsConfirmation = result.needsEmailConfirmation && !result.session
  } catch (error) {
    // بريد مسجّل مسبقًا: نحاول الدخول به (ربما أنشأ الحساب على جهاز آخر)
    if (!isConflict(error)) throw error
    try {
      await cloud.auth.signIn({ email: input.email.trim().toLowerCase(), password: input.password })
    } catch {
      throw appError(
        'conflict',
        undefined,
        'هذا البريد مسجّل مسبقًا بكلمة مرور مختلفة على حسابك السحابي. استخدم «لديّ حساب سحابي» في الإعدادات.',
      )
    }
  }

  // ملفك الشخصي على الحساب السحابي (الاسم + النوع + العملة + الهاتف)
  if (!needsConfirmation) {
    await cloud.auth.createProfile({
      fullName: profile.fullName,
      role: profile.role,
      currency: profile.currency,
      phone: profile.phone ?? null,
    })
  }

  if (needsConfirmation) {
    // لا جلسة بعد: نحفظ نسخة الدفتر لتُنقل تلقائيًا بعد تأكيد البريد
    try {
      stashPendingTransfer(await collectBackup(local, profile))
    } catch {
      /* لا نُفشل الربط بسبب النسخة */
    }
    return { needsConfirmation: true, transferred: null }
  }

  let transferred: RestoreResult | null = null
  try {
    transferred = await transferLocalBook(cloud, local, profile)
  } catch {
    // فشل النقل (شبكة مثلًا): يبقى للمحاولة التالية بعد إعادة التحميل
    try {
      stashPendingTransfer(await collectBackup(local, profile))
    } catch {
      /* ignore */
    }
  }

  return { needsConfirmation: false, transferred }
}
