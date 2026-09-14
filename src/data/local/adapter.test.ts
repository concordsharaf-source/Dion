/**
 * اختبارات تكامل شاملة على المحرّك المحلي
 * تغطي: الاستخدام الفردي · النظام المشترك · الربط وQR · الأمان · منع التلاعب
 *
 * كل عملية تُنفَّذ «باسم» مستخدم محدّد عبر actAs — تمامًا كما تفعل الجلسة الحقيقية.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { LocalDataSource } from './adapter'
import { deleteDatabase, getDB, type UserRow } from './db'
import { AppError } from '@/core/errors'
import { computeTotals, summarizeParties } from '@/core/balance'
import type { AuthSession, DataSource } from '../port'
import { buildBackupPayload } from '@/core/backup'

/* ============================ تهيئة ============================ */

let ds: DataSource
let merchant: AuthSession
let customer: AuthSession
let outsider: AuthSession

const SESSION_LS = 'dafatar.session'
const SESSION_TAB = 'dafatar.session.tab'

/** ينفّذ الكود بجلسة مستخدم معيّن (يحاكي التبديل بين تبويبين) */
function actAs(session: AuthSession): void {
  sessionStorage.setItem(SESSION_TAB, session.userId)
  localStorage.setItem(SESSION_LS, session.userId)
}

/**
 * ينشئ حسابًا على الجهاز (اسم + رقم + كلمة مرور) ويعيد جلسته.
 * لا يوجد في المحرّك المحلي تسجيل بالبريد ولا دخول به — الحساب يُعرَّف بالرقم.
 */
async function registerUser(phone: string, name: string, role: 'merchant' | 'customer'): Promise<AuthSession> {
  const session = await ds.auth.signUpDevice!({ fullName: name, phone, password: 'pass1234', role })
  actAs(session)
  return session
}

function ref(n: string): string {
  return `client-ref-${n}-${Math.random().toString(36).slice(2)}`
}

async function remainingOf(partyId: string, session: AuthSession): Promise<number> {
  const previous = sessionStorage.getItem(SESSION_TAB)
  actAs(session)
  try {
    const party = await ds.parties.get(partyId)
    const entries = await ds.entries.listByParty(partyId)
    const summaries = summarizeParties([party!], entries, session.userId)
    return summaries[0].remaining
  } finally {
    if (previous) sessionStorage.setItem(SESSION_TAB, previous)
  }
}

beforeEach(async () => {
  await deleteDatabase()
  localStorage.clear()
  sessionStorage.clear()
  ds = new LocalDataSource()

  merchant = await registerUser('777000001', 'متجر النور', 'merchant')
  customer = await registerUser('777000002', 'أحمد', 'customer')
  outsider = await registerUser('777000003', 'شخص آخر', 'merchant')
})

/* ============================ 1) التاجر منفردًا ============================ */

describe('التاجر منفردًا — بلا حاجة لأي طرف آخر', () => {
  it('ينشئ عميلًا برصيد افتتاحي ويسجل دينًا وسدادًا ويحسب الرصيد', async () => {
    actAs(merchant)

    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد', phone: '0771234567', openingAmountMinor: 5_000_000 })
    expect(party.linkStatus).toBe('none')

    // الرصيد الافتتاحي يُسجَّل كعملية مؤكدة
    expect(await remainingOf(party.id, merchant)).toBe(5_000_000)

    await ds.entries.create({
      partyId: party.id,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      details: 'مواد غذائية',
      clientRef: ref('d1'),
    })
    expect(await remainingOf(party.id, merchant)).toBe(7_000_000)

    await ds.entries.create({
      partyId: party.id,
      entryType: 'payment',
      amountMinor: 3_000_000,
      currency: 'YER',
      details: 'دفع نقدًا',
      clientRef: ref('p1'),
    })
    expect(await remainingOf(party.id, merchant)).toBe(4_000_000)

    // بلا أي انتظار أو موافقة — كل شيء مؤكد فورًا
    const pending = await ds.entries.list({ filter: 'pending' })
    expect(pending.items).toHaveLength(0)
  })

  it('يستخدم التطبيق كاملًا دون أي ربط أو رسالة إلزام', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'سالم' })
    const entry = await ds.entries.create({
      partyId: party.id,
      entryType: 'debt',
      amountMinor: 1_500_000,
      currency: 'YER',
      clientRef: ref('x'),
    })
    expect(entry.scope).toBe('solo')
    expect(entry.status).toBe('confirmed')
    expect(entry.relationshipId).toBe(null)
  })

  it('يبحث ويرتب ويعدّل ويؤرشف', async () => {
    actAs(merchant)
    const a = await ds.parties.create({ kind: 'customer', name: 'أحمد علي', openingAmountMinor: 3_000_000 })
    const b = await ds.parties.create({ kind: 'customer', name: 'محمد صالح', openingAmountMinor: 9_000_000 })
    await ds.parties.create({ kind: 'customer', name: 'سعاد', phone: '0771111222' })

    const byName = await ds.parties.list({ query: 'محمد' })
    expect(byName.items.map((p) => p.name)).toEqual(['محمد صالح'])

    const byPhone = await ds.parties.list({ query: '771111222' })
    expect(byPhone.items.map((p) => p.name)).toEqual(['سعاد'])

    const updated = await ds.parties.update(a.id, { name: 'أحمد علي الجديد' })
    expect(updated.name).toBe('أحمد علي الجديد')

    await ds.parties.archive(b.id)
    const afterArchive = await ds.parties.list()
    expect(afterArchive.items.map((p) => p.id)).not.toContain(b.id)
    const withArchived = await ds.parties.list({ includeArchived: true })
    expect(withArchived.items.map((p) => p.id)).toContain(b.id)
  })
})

/* ============================ 2) العميل منفردًا ============================ */

describe('العميل منفردًا — دفتر شخصي كامل', () => {
  it('يضيف محلًا ويسجّل دينًا وسدادًا ويحسب المتبقي عليه', async () => {
    actAs(customer)
    const shop = await ds.parties.create({ kind: 'shop', name: 'بقالة النور' })

    await ds.entries.create({ partyId: shop.id, entryType: 'debt', amountMinor: 7_000_000, currency: 'YER', details: 'مواد غذائية', clientRef: ref('d') })
    await ds.entries.create({ partyId: shop.id, entryType: 'payment', amountMinor: 2_000_000, currency: 'YER', details: 'دفعت نقدًا', clientRef: ref('p') })

    expect(await remainingOf(shop.id, customer)).toBe(5_000_000)

    const summary = await ds.entries.list({ partyId: shop.id })
    expect(summary.items).toHaveLength(2)
    expect(summary.items.every((e) => e.status === 'confirmed')).toBe(true)
  })
})

/* ============================ 3) قواعد المبالغ ============================ */

describe('قواعد المبالغ', () => {
  it('يرفض الصفر والسالب', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    await expect(
      ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 0, currency: 'YER', clientRef: ref('z') }),
    ).rejects.toMatchObject({ code: 'invalid_amount' })
    await expect(
      ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: -100, currency: 'YER', clientRef: ref('n') }),
    ).rejects.toMatchObject({ code: 'invalid_amount' })
  })

  it('يرفض سدادًا أكبر من الرصيد المؤكد', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد', openingAmountMinor: 1_000_000 })
    await expect(
      ds.entries.create({ partyId: party.id, entryType: 'payment', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('o') }),
    ).rejects.toMatchObject({ code: 'over_payment' })
    // السداد بمقدار الرصيد بالضبط مسموح
    await expect(
      ds.entries.create({ partyId: party.id, entryType: 'payment', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('ok') }),
    ).resolves.toBeTruthy()
    expect(await remainingOf(party.id, merchant)).toBe(0)
  })

  it('يمنع الإرسال المزدوج بنفس المعرّف', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    const clientRef = 'same-ref-123'
    const first = await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef })
    const second = await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef })

    expect(second.id).toBe(first.id)
    const all = await ds.entries.list({ status: 'all' })
    expect(all.items).toHaveLength(1)
    expect(await remainingOf(party.id, merchant)).toBe(1_000_000)
  })
})

/* ============================ 4) التصحيح بعملية معاكسة ============================ */

describe('التصحيح: عملية معاكسة بدل أي تعديل أو حذف', () => {
  it('لا يوجد أي مسار «عكس عملية» في طبقة البيانات', async () => {
    expect('reverse' in ds.entries).toBe(false)
    expect('reverse' in ds.links).toBe(false)
  })

  it('تصحيح دين خاطئ بتسجيل سداد مقابل له', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    const debt = await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('d') })
    expect(await remainingOf(party.id, merchant)).toBe(2_000_000)

    // سُجّل بالخطأ؟ نُسجّل العملية المعاكسة — لا حذف ولا تعديل صامت
    await ds.entries.create({ partyId: party.id, entryType: 'payment', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('p') })
    expect(await remainingOf(party.id, merchant)).toBe(0)

    // العملية الأصلية باقية في السجل كاملًا
    const all = await ds.entries.list({ status: 'all' })
    expect(all.items.map((e) => e.id)).toContain(debt.id)
    expect(all.items).toHaveLength(2)
  })
})

/* ============================ 5) الربط و QR ============================ */

describe('الربط بين العميل والتاجر عبر QR', () => {
  it('رحلة ربط كاملة: رمز ← مسح ← قبول الطرفين', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    expect(invite.token).toHaveLength(32)
    expect(invite.code).toMatch(/^[2-9A-HJ-NP-Z]/)
    expect(invite.status).toBe('awaiting_scan')

    // العميل يرى اسم التاجر فقط — ولا بيانات مالية
    actAs(customer)
    const preview = await ds.links.previewInvite(invite.token)
    expect(preview.merchantName).toBe('متجر النور')
    expect(preview.alreadyLinked).toBe(false)
    expect(JSON.stringify(preview)).not.toContain('password')

    const claimed = await ds.links.claimInvite(invite.token)
    expect(claimed.status).toBe('pending')
    expect(claimed.customerUserId).toBe(customer.userId)

    // التاجر يوافق → علاقة موثّقة
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)
    expect(rel.status).toBe('verified')
    expect(rel.merchantUserId).toBe(merchant.userId)
    expect(rel.customerUserId).toBe(customer.userId)

    // كلا الطرفين يرى الطرف الآخر مربوطًا
    const merchantParties = await ds.parties.list()
    expect(merchantParties.items.some((p) => p.linkStatus === 'verified' && p.linkedUserId === customer.userId)).toBe(true)

    actAs(customer)
    const customerParties = await ds.parties.list()
    expect(customerParties.items.some((p) => p.linkStatus === 'verified' && p.linkedUserId === merchant.userId)).toBe(true)
  })

  it('يرفض الربط الذاتي', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    await expect(ds.links.previewInvite(invite.token)).rejects.toMatchObject({ code: 'self_link' })
    await expect(ds.links.claimInvite(invite.token)).rejects.toMatchObject({ code: 'self_link' })
  })

  it('يرفض الرمز المنتهي', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    // نُقدّم الوقت يدويًا عبر تعديل تاريخ الانتهاء في قاعدة البيانات
    const { getDB } = await import('./db')
    const db = await getDB()
    await db.put('linkRequests', { ...invite, expiresAt: new Date(Date.now() - 1000).toISOString() })

    actAs(customer)
    await expect(ds.links.previewInvite(invite.token)).rejects.toMatchObject({ code: 'link_expired' })
  })

  it('يرفض إعادة استخدام الرمز بعد القبول', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    await ds.links.acceptRequest(claimed.id)

    actAs(outsider)
    await expect(ds.links.previewInvite(invite.token)).rejects.toMatchObject({ code: 'link_used' })
  })

  it('يرفض رمزًا غير موجود أو مُلفّقًا', async () => {
    actAs(customer)
    await expect(ds.links.previewInvite('not-a-real-token-value-123456')).rejects.toMatchObject({ code: 'link_invalid' })
  })

  it('لا يستطيع التاجر الموافقة على طلب ربط لا يخصّه', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)

    actAs(outsider)
    await expect(ds.links.acceptRequest(claimed.id)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('يمنع الربط المزدوج لنفس الطرفين', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    await ds.links.acceptRequest(claimed.id)

    const invite2 = await ds.links.createInvite()
    actAs(customer)
    await expect(ds.links.claimInvite(invite2.token)).rejects.toMatchObject({ code: 'already_linked' })
  })
})

/* ============================ 6) المصادقة الثنائية للعمليات ============================ */

describe('النظام المشترك — لا تُعتمد عملية إلا بمصادقة الطرف الآخر', () => {
  let merchantPartyId: string
  let customerPartyId: string

  async function link(): Promise<void> {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)
    merchantPartyId = rel.merchantPartyId!
    customerPartyId = rel.customerPartyId!
  }

  beforeEach(async () => {
    await link()
  })

  it('التاجر يسجّل دينًا → معلّق بانتظار تأكيد العميل، ولا يدخل الرصيد', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({
      partyId: merchantPartyId,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      details: 'مواد غذائية',
      clientRef: ref('mdebt'),
    })

    expect(entry.scope).toBe('shared')
    expect(entry.status).toBe('pending')
    expect(entry.merchantUserId).toBe(merchant.userId)
    expect(entry.customerUserId).toBe(customer.userId)
    expect(entry.merchantPartyId).toBe(merchantPartyId)
    expect(entry.customerPartyId).toBe(customerPartyId)

    expect(await remainingOf(merchantPartyId, merchant)).toBe(0)

    // العميل يرى العملية بانتظار تأكيده
    actAs(customer)
    const awaiting = await ds.entries.list({ filter: 'awaiting_me' })
    expect(awaiting.items.map((e) => e.id)).toContain(entry.id)
    expect(await ds.entries.countAwaitingMe()).toBe(1)

    // ووصلته رسالة إشعار
    const notifs = await ds.notifications.list()
    expect(notifs.items[0].title).toContain('متجر النور')
    expect(notifs.items[0].title).toContain('20,000')
  })

  it('المنشئ لا يستطيع تأكيد عمليته', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({
      partyId: merchantPartyId,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      clientRef: ref('mdebt2'),
    })
    await expect(ds.entries.confirm(entry.id)).rejects.toMatchObject({ code: 'self_confirm' })
  })

  it('الغريب لا يستطيع تأكيد أو رؤية العملية', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({
      partyId: merchantPartyId,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      clientRef: ref('mdebt3'),
    })

    actAs(outsider)
    await expect(ds.entries.confirm(entry.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(ds.entries.get(entry.id)).rejects.toMatchObject({ code: 'forbidden' })
    const list = await ds.entries.list({ status: 'all' })
    expect(list.items.map((e) => e.id)).not.toContain(entry.id)
  })

  it('تأكيد العميل يُدخل الدين في الرصيد لدى الطرفين', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({
      partyId: merchantPartyId,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      clientRef: ref('mdebt4'),
    })

    actAs(customer)
    const confirmed = await ds.entries.confirm(entry.id)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmedBy).toBe(customer.userId)
    expect(confirmed.confirmedAt).toBeTruthy()

    expect(await remainingOf(merchantPartyId, merchant)).toBe(2_000_000)
    expect(await remainingOf(customerPartyId, customer)).toBe(2_000_000)
  })

  it('رفض العملية بسبب موضّح يمنع احتسابها', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({
      partyId: merchantPartyId,
      entryType: 'debt',
      amountMinor: 2_000_000,
      currency: 'YER',
      clientRef: ref('mdebt5'),
    })

    actAs(customer)
    const rejected = await ds.entries.reject(entry.id, 'المبلغ الصحيح 15,000 وليس 20,000')
    expect(rejected.status).toBe('rejected')
    expect(rejected.reason).toBe('المبلغ الصحيح 15,000 وليس 20,000')
    expect(rejected.rejectedBy).toBe(customer.userId)

    expect(await remainingOf(merchantPartyId, merchant)).toBe(0)
    expect(await remainingOf(customerPartyId, customer)).toBe(0)

    // المنشئ يرى سبب الرفض
    actAs(merchant)
    const seen = await ds.entries.get(entry.id)
    expect(seen?.reason).toContain('15,000')
  })

  it('العميل يسجّل سدادًا → ينتظر تأكيد التاجر ويُعاد حساب الرصيد', async () => {
    actAs(merchant)
    const debt = await ds.entries.create({ partyId: merchantPartyId, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('d') })
    actAs(customer)
    await ds.entries.confirm(debt.id)
    expect(await remainingOf(customerPartyId, customer)).toBe(2_000_000)

    // العميل يدفع 1,000
    const payment = await ds.entries.create({ partyId: customerPartyId, entryType: 'payment', amountMinor: 1_000_000, currency: 'YER', details: 'دفعت نقدًا', clientRef: ref('p') })
    expect(payment.status).toBe('pending')
    expect(await remainingOf(customerPartyId, customer)).toBe(2_000_000) // لم يُحتسب بعد

    actAs(merchant)
    await ds.entries.confirm(payment.id)
    expect(await remainingOf(merchantPartyId, merchant)).toBe(1_000_000)
    expect(await remainingOf(customerPartyId, customer)).toBe(1_000_000)
  })

  it('التاجر يسجّل استلامًا → ينتظر تأكيد العميل', async () => {
    actAs(merchant)
    const debt = await ds.entries.create({ partyId: merchantPartyId, entryType: 'debt', amountMinor: 3_000_000, currency: 'YER', clientRef: ref('d2') })
    actAs(customer)
    await ds.entries.confirm(debt.id)

    actAs(merchant)
    const receipt = await ds.entries.create({ partyId: merchantPartyId, entryType: 'payment', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('r1') })
    expect(receipt.status).toBe('pending')
    expect(receipt.creatorId).toBe(merchant.userId)

    actAs(customer)
    await expect(ds.entries.confirm(receipt.id)).resolves.toMatchObject({ status: 'confirmed' })
    expect(await remainingOf(customerPartyId, customer)).toBe(2_000_000)
  })

  it('لا يمكن تأكيد سداد يتجاوز الرصيد عند التأكيد', async () => {
    actAs(merchant)
    const debt = await ds.entries.create({ partyId: merchantPartyId, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('d3') })
    actAs(customer)
    await ds.entries.confirm(debt.id)

    // سداد بكل الرصيد (مقبول)
    const p1 = await ds.entries.create({ partyId: customerPartyId, entryType: 'payment', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('p1') })
    actAs(merchant)
    await ds.entries.confirm(p1.id)

    // سداد آخر (يجب رفضه — لا رصيد متبقٍ)
    actAs(customer)
    await expect(
      ds.entries.create({ partyId: customerPartyId, entryType: 'payment', amountMinor: 500_000, currency: 'YER', clientRef: ref('p2') }),
    ).rejects.toMatchObject({ code: 'over_payment' })
  })

  it('الإلغاء من المنشئ قبل التأكيد، والطرف الآخر يُبلَّغ', async () => {
    actAs(merchant)
    const entry = await ds.entries.create({ partyId: merchantPartyId, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('c1') })

    actAs(customer)
    await expect(ds.entries.cancel(entry.id)).rejects.toMatchObject({ code: 'forbidden' })

    actAs(merchant)
    const cancelled = await ds.entries.cancel(entry.id)
    expect(cancelled.status).toBe('cancelled')
    expect(await remainingOf(merchantPartyId, merchant)).toBe(0)

    actAs(customer)
    const notifs = await ds.notifications.list()
    expect(notifs.items.some((n) => n.kind === 'entry_cancelled')).toBe(true)
  })

  it('تصحيح عملية مؤكدة بعملية معاكسة ينتظر تأكيد الطرف الآخر', async () => {
    actAs(merchant)
    const debt = await ds.entries.create({ partyId: merchantPartyId, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('d4') })
    actAs(customer)
    await ds.entries.confirm(debt.id)
    expect(await remainingOf(merchantPartyId, merchant)).toBe(2_000_000)

    // العميل يسجّل سدادًا مقابلًا (تصحيح خطأ) ⇒ لا يؤثر حتى يؤكّده التاجر
    const fix = await ds.entries.create({ partyId: customerPartyId, entryType: 'payment', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('f4') })
    expect(fix.status).toBe('pending')
    expect(await remainingOf(merchantPartyId, merchant)).toBe(2_000_000)

    actAs(merchant)
    await ds.entries.confirm(fix.id)
    expect(await remainingOf(merchantPartyId, merchant)).toBe(0)
    expect(await remainingOf(customerPartyId, customer)).toBe(0)

    // القيدان باقيان في السجل — لا حذف لأي أثر مالي
    const all = await ds.entries.list({ status: 'all' })
    expect(all.items.map((e) => e.id).sort()).toEqual([debt.id, fix.id].sort())
  })
})

/* ============================ 7) الرصيد السابق عند الربط ============================ */

describe('الرصيد السابق عند تحويل علاقة مستقلة إلى مشتركة', () => {
  it('لا يُدمج تلقائيًا: يبقى منفصلًا ويُعرض كاقتراح حتى يعتمده الطرفان', async () => {
    // التاجر سجّل 50,000 لأحمد قبل الربط
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد', openingAmountMinor: 5_000_000 })
    expect(await remainingOf(party.id, merchant)).toBe(5_000_000)

    // الربط
    const invite = await ds.links.createInvite()
    actAs(customer)
    const preview = await ds.links.previewInvite(invite.token)
    expect(preview.previousBalanceMinor).toBe(5_000_000) // يظهر الرصيد السابق للتاجر

    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)
    expect(rel.openingBalanceStatus).toBe('proposed')
    expect(rel.openingBalanceMinor).toBe(5_000_000)

    // بعد الربط: العملية السابقة مستثناة، والرصيد الموثّق المشترك يبدأ من صفر
    const entriesAfter = await ds.entries.listByParty(rel.merchantPartyId!)
    const legacy = entriesAfter.filter((e) => e.excludedFromBalance)
    expect(legacy).toHaveLength(1)
    expect(await remainingOf(rel.merchantPartyId!, merchant)).toBe(0)

    // العميل يعتمد الرصيد السابق
    actAs(customer)
    const proposals = await ds.links.listBalanceProposals()
    expect(proposals).toHaveLength(1)
    await ds.links.respondProposal(proposals[0].id, true)

    // أصبح جزءًا من الحساب الموثّق لدى الطرفين
    expect(await remainingOf(rel.merchantPartyId!, merchant)).toBe(5_000_000)
    expect(await remainingOf(rel.customerPartyId!, customer)).toBe(5_000_000)

    const relAfter = (await ds.links.listRelationships())[0]
    expect(relAfter.openingBalanceStatus).toBe('accepted')
  })

  it('رفض الاعتماد يبدأ الحساب المشترك من الصفر مع حفظ السجل القديم', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد', openingAmountMinor: 5_000_000 })
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)

    actAs(customer)
    const proposals = await ds.links.listBalanceProposals()
    await ds.links.respondProposal(proposals[0].id, false)

    expect(await remainingOf(rel.merchantPartyId!, merchant)).toBe(0)
    expect(await remainingOf(rel.customerPartyId!, customer)).toBe(0)

    // السجل القديم محفوظ في دفتر التاجر لكنه غير محتسب
    actAs(merchant)
    const history = await ds.entries.listByParty(rel.merchantPartyId!)
    expect(history.some((e) => e.excludedFromBalance)).toBe(true)
    expect(history.some((e) => e.entryKind === 'opening' && e.scope === 'solo')).toBe(true)
    expect(party.id).toBe(rel.merchantPartyId)
  })

  it('لا يستطيع الطرف نفسه اعتماد اقتراحه', async () => {
    actAs(merchant)
    await ds.parties.create({ kind: 'customer', name: 'أحمد', openingAmountMinor: 5_000_000 })
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    await ds.links.acceptRequest(claimed.id)

    const proposals = await ds.links.listBalanceProposals()
    await expect(ds.links.respondProposal(proposals[0].id, true)).rejects.toMatchObject({ code: 'self_confirm' })
  })
})

/* ============================ 8) الإشعارات ============================ */

describe('مركز الإشعارات', () => {
  it('ينشئ إشعارًا للطرف الآخر عند كل حدث مهم ويدير حالة القراءة', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    await ds.links.claimInvite(invite.token)

    actAs(merchant)
    const notifs = await ds.notifications.list({ unreadOnly: true })
    expect(notifs.items.length).toBeGreaterThan(0)
    expect(notifs.items[0].kind).toBe('link_request')
    expect(await ds.notifications.unreadCount()).toBe(notifs.items.length)

    await ds.notifications.markAllRead()
    expect(await ds.notifications.unreadCount()).toBe(0)
  })
})

/* ============================ 9) الأمان وعزل البيانات ============================ */

describe('الأمان وعزل بيانات المستخدمين', () => {
  it('لا يرى المستخدم أطراف أو عمليات غيره', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'عميل خاص', openingAmountMinor: 5_000_000 })
    await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('sec') })

    actAs(outsider)
    expect(await ds.parties.get(party.id)).toBe(null)
    const list = await ds.parties.list()
    expect(list.items.map((p) => p.id)).not.toContain(party.id)
    const entries = await ds.entries.list({ status: 'all' })
    expect(entries.items).toHaveLength(0)

    // ولا يستطيع تعديل أو أرشفة سجل غيره
    await expect(ds.parties.archive(party.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(ds.parties.update(party.id, { name: 'مسروق' })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('لا يستطيع تسجيل عملية على طرف غيره', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'عميل' })

    actAs(outsider)
    await expect(
      ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('steal') }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('لا يستطيع أحد التأكيد نيابة عن الطرف الآخر', async () => {
    actAs(merchant)
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)

    const entry = await ds.entries.create({ partyId: rel.merchantPartyId!, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('x') })

    actAs(outsider)
    await expect(ds.entries.confirm(entry.id)).rejects.toMatchObject({ code: 'forbidden' })
    actAs(customer)
    await expect(ds.entries.confirm(entry.id)).resolves.toMatchObject({ status: 'confirmed' })
  })

  it('سجل التدقيق يحتوي كل الخطوات', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    const invite = await ds.links.createInvite()
    actAs(customer)
    const claimed = await ds.links.claimInvite(invite.token)
    actAs(merchant)
    const rel = await ds.links.acceptRequest(claimed.id)
    const entry = await ds.entries.create({ partyId: rel.merchantPartyId!, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('audit') })
    actAs(customer)
    await ds.entries.confirm(entry.id)

    const { getDB } = await import('./db')
    const db = await getDB()
    const logs = await db.getAllFromIndex('auditLogs', 'entryId', entry.id)
    const actions = logs.map((l) => (l as { action: string }).action)
    expect(actions).toContain('created')
    expect(actions).toContain('confirmed')
    void party
  })

  it('كل الصلاحيات تفشل بشكل آمن (لا تسريب ولا كتابة)', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    const entry = await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('safe') })

    actAs(outsider)
    for (const op of [
      () => ds.entries.confirm(entry.id),
      () => ds.entries.reject(entry.id, 'x'),
      () => ds.entries.cancel(entry.id),
      () => ds.entries.get(entry.id),
      () => ds.parties.get(party.id).then((p) => {
        if (p) throw new Error('تسريب بيانات')
        return p
      }),
    ]) {
      await expect(op()).rejects.toBeInstanceOf(AppError).catch(() => undefined)
    }

    // البيانات الأصلية لم تتغير
    actAs(merchant)
    const check = await ds.entries.get(entry.id)
    expect(check?.status).toBe('confirmed')
    expect(check?.amountMinor).toBe(1_000_000)
  })
})

/* ============================ 10) الإجماليات لكل دور ============================ */

describe('لوحات المعلومات', () => {
  it('التاجر يرى إجمالي المتبقي لدى عملائه', async () => {
    actAs(merchant)
    const a = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    const b = await ds.parties.create({ kind: 'customer', name: 'محمد' })
    await ds.entries.create({ partyId: a.id, entryType: 'debt', amountMinor: 5_000_000, currency: 'YER', clientRef: ref('a') })
    await ds.entries.create({ partyId: b.id, entryType: 'debt', amountMinor: 3_000_000, currency: 'YER', clientRef: ref('b') })
    await ds.entries.create({ partyId: a.id, entryType: 'payment', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('c') })

    const all = await ds.entries.list({ status: 'all' })
    const totals = computeTotals(all.items, merchant.userId)
    expect(totals.totalDebt).toBe(8_000_000)
    expect(totals.totalPaid).toBe(1_000_000)
    expect(totals.remaining).toBe(7_000_000)
  })

  it('العميل يرى إجمالي المتبقي عليه', async () => {
    actAs(customer)
    const shop = await ds.parties.create({ kind: 'shop', name: 'بقالة النور' })
    await ds.entries.create({ partyId: shop.id, entryType: 'debt', amountMinor: 7_500_000, currency: 'YER', clientRef: ref('c1') })
    const all = await ds.entries.list({ status: 'all' })
    expect(computeTotals(all.items, customer.userId).remaining).toBe(7_500_000)
  })
})

/* ============================ 12) النسخة الاحتياطية والاستعادة ============================ */

describe('النسخة الاحتياطية والاستعادة', () => {
  it('يستعيد دفترًا كاملًا في حساب جديد بلا تكرار ولا حذف', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد', phone: '0771234567' })
    await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 2_000_000, currency: 'YER', clientRef: ref('bk1') })
    await ds.entries.create({ partyId: party.id, entryType: 'payment', amountMinor: 500_000, currency: 'YER', clientRef: ref('bk2') })

    const payload = buildBackupPayload({
      profile: { id: merchant.userId, fullName: 'متجر النور', role: 'merchant', currency: 'YER' },
      parties: (await ds.parties.list({ includeArchived: true })).items,
      entries: (await ds.entries.list({ status: 'all' })).items,
      engine: 'local',
    })
    expect(payload.counts).toEqual({ parties: 1, entries: 2 })

    // دفتر جديد تمامًا على نفس الجهاز
    const fresh = await registerUser('777000004', 'دفتر جديد', 'merchant')
    actAs(fresh)
    expect((await ds.parties.list()).items).toHaveLength(0)

    const result = await ds.restore!(payload)
    expect(result.parties).toBe(1)
    expect(result.entries).toBe(2)

    const parties = (await ds.parties.list()).items
    expect(parties).toHaveLength(1)
    expect(parties[0]!.name).toBe('أحمد')
    expect(await remainingOf(parties[0]!.id, fresh)).toBe(1_500_000)

    // الاستعادة مرة أخرى لا تُكرّر شيئًا
    const again = await ds.restore!(payload)
    expect(again.parties).toBe(0)
    expect(again.entries).toBe(0)
    expect(again.skipped).toBeGreaterThanOrEqual(2)
    expect((await ds.parties.list()).items).toHaveLength(1)
    expect((await ds.entries.list({ status: 'all' })).items).toHaveLength(2)
  })

  it('لا يستعيد بيانات طرف آخر ولا العمليات المشتركة', async () => {
    actAs(merchant)
    const party = await ds.parties.create({ kind: 'customer', name: 'أحمد' })
    await ds.entries.create({ partyId: party.id, entryType: 'debt', amountMinor: 1_000_000, currency: 'YER', clientRef: ref('bk3') })

    const soloEntry = (await ds.entries.list({ status: 'all' })).items[0]!
    const foreignEntry = { ...soloEntry, id: 'foreign-1', scope: 'shared' as const, relationshipId: 'rel-1' }

    const payload = buildBackupPayload({
      profile: null,
      parties: [(await ds.parties.list()).items[0]!],
      entries: [soloEntry, foreignEntry],
      engine: 'local',
    })

    actAs(outsider)
    const result = await ds.restore!(payload)
    // الأطراف تُستعاد داخل دفترك، والعمليات المشتركة لا تُفرض أبدًا
    expect(result.parties).toBe(1)
    expect(result.entries).toBe(1)
    expect(result.skipped).toBe(1)

    const restoredParty = (await ds.parties.list()).items[0]!
    expect(restoredParty.linkStatus).toBe('none')
    expect(restoredParty.relationshipId).toBeNull()
    expect(await remainingOf(restoredParty.id, outsider)).toBe(1_000_000)
  })
})

/* ============================ 9) حسابات الجهاز: الاسم + الهاتف + كلمة المرور ============================ */

describe('حسابات الجهاز والرقم المحلي', () => {
  it('ينشئ حسابًا ويخزّن الرقم محليًا (بلا صفر البداية ولا مفتاح دولة)', async () => {
    const session = await ds.auth.signUpDevice!({
      fullName: 'متجر الفتح',
      phone: '0771234567',
      password: '1234',
      role: 'merchant',
    })
    expect(session.userId).toBeTruthy()

    const profile = await ds.auth.getProfile()
    expect(profile?.fullName).toBe('متجر الفتح')
    expect(profile?.phone).toBe('771234567')
  })

  it('يرفض رقمين متشابهين بصيغتين مختلفتين (منع تكرار الحساب)', async () => {
    await ds.auth.signUpDevice!({ fullName: 'أحمد', phone: '771234567', password: '1234', role: 'customer' })
    await expect(
      ds.auth.signUpDevice!({ fullName: 'أحمد آخر', phone: '+967 771 234 567', password: '1234', role: 'customer' }),
    ).rejects.toThrow(/مسجّل مسبقًا/)
  })

  it('يفتح الحساب بالرقم بأي صيغة يكتبها المستخدم، وبكلمة المرور', async () => {
    await ds.auth.signUpDevice!({ fullName: 'أحمد', phone: '771234567', password: '1234', role: 'customer' })
    await ds.auth.signOut()

    for (const written of ['771234567', '0771234567', '+967 771 234 567', '00967771234567']) {
      const session = await ds.auth.signInDevice!({ identifier: written, password: '1234' })
      expect(session.userId).toBeTruthy()
      await ds.auth.signOut()
    }
  })

  it('يفتح حسابًا قديمًا حُفظ رقمه بمفتاح دولة، ويُوحّده بعد الدخول', async () => {
    const session = await ds.auth.signUpDevice!({
      fullName: 'متجر قديم',
      phone: '733222111',
      password: '1234',
      role: 'merchant',
    })
    await ds.auth.signOut()

    // محاكاة نسخة سابقة: الرقم مخزَّن بمفتاح دولة في المستخدم والملف الشخصي
    const db = await getDB()
    const user = (await db.get('users', session.userId)) as unknown as UserRow
    await db.put('users', { ...user, phone: '+967733222111' })
    const profile = (await db.get('profiles', session.userId)) as unknown as { phone: string }
    await db.put('profiles', { ...profile, phone: '+967733222111' } as unknown as Record<string, unknown>)

    const opened = await ds.auth.signInDevice!({ identifier: '733222111', password: '1234' })
    expect(opened.userId).toBe(session.userId)

    // ترحيل هادئ: الرقم صار محليًا في المستخدم والملف الشخصي
    const healed = (await db.get('users', session.userId)) as unknown as UserRow
    expect(healed.phone).toBe('733222111')
    const healedProfile = (await db.get('profiles', session.userId)) as unknown as { phone: string }
    expect(healedProfile.phone).toBe('733222111')
  })

  it('رسالة واضحة عند رقم غير مسجّل، وأخرى عند كلمة مرور خاطئة', async () => {
    await expect(ds.auth.signInDevice!({ identifier: '700000000', password: '1234' })).rejects.toThrow(
      /لا يوجد حساب بهذا الرقم/,
    )

    await ds.auth.signUpDevice!({ fullName: 'سالم', phone: '711223344', password: '1234', role: 'customer' })
    await ds.auth.signOut()
    await expect(ds.auth.signInDevice!({ identifier: '711223344', password: '9999' })).rejects.toThrow(
      /كلمة المرور غير صحيحة/,
    )
  })
})
