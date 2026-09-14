/**
 * اختبارات ربط حساب الجهاز بحساب سحابي («أضف بريدك الإلكتروني»).
 *
 * المهم هنا: البريد اختياري تمامًا ولا يُطلب عند التسجيل، وعند إضافته
 * لا يضيع دفتر المستخدم — يُنقل إلى الحساب السحابي، وإن تعذّر النقل الآن
 * تبقى نسخة محفوظة تُنقل تلقائيًا بعد إعادة التحميل.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalDataSource } from '@/data/local/adapter'
import { deleteDatabase } from '@/data/local/db'
import { appError } from '@/core/errors'
import type { AuthSession, DataSource, RestoreResult, SignUpInput } from '@/data/port'
import type { Profile } from '@/core/domain'
import {
  clearPendingTransfer,
  linkCloudAccount,
  readPendingTransfer,
  stashPendingTransfer,
} from './cloudLink'

const SESSION_LS = 'dafatar.session'
const SESSION_TAB = 'dafatar.session.tab'

let local: DataSource
let session: AuthSession

async function seedDeviceBook(): Promise<{ local: DataSource; session: AuthSession }> {
  const device = new LocalDataSource()
  const created = await device.auth.signUpDevice!({
    fullName: 'أحمد محمد',
    phone: '771234567',
    password: '1234',
    role: 'customer',
  })
  sessionStorage.setItem(SESSION_TAB, created.userId)
  localStorage.setItem(SESSION_LS, created.userId)
  const shop = await device.parties.create({ kind: 'shop', name: 'بقالة الحي' })
  await device.entries.create({
    partyId: shop.id,
    entryType: 'debt',
    amountMinor: 2_500_000,
    currency: 'YER',
    clientRef: 'ref-cloud-1',
  })
  return { local: device, session: created }
}

async function profileOf(ds: DataSource): Promise<Profile> {
  const profile = await ds.auth.getProfile()
  if (!profile) throw new Error('لا يوجد ملف شخصي')
  return profile
}

/** محرّك سحابي مزيّف: يسجّل ما طُلب منه ويُعيد ما نحدّده */
function fakeCloud(options: {
  signUp?: (input: SignUpInput) => Promise<{ session: AuthSession | null; needsEmailConfirmation: boolean }>
  signIn?: () => Promise<AuthSession>
  restore?: () => Promise<RestoreResult>
}): DataSource & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { signUp: [], signIn: [], createProfile: [], restore: [] }
  const cloudSession: AuthSession = { userId: 'cloud-user', email: 'owner@example.com', createdAt: '2026-01-01T00:00:00.000Z' }
  const stub = {
    kind: 'supabase',
    supportsShared: true,
    calls,
    auth: {
      getSession: async () => cloudSession,
      getProfile: async () => null,
      signUp: async (input: SignUpInput) => {
        calls.signUp.push(input)
        if (options.signUp) return options.signUp(input)
        return { session: cloudSession, needsEmailConfirmation: false }
      },
      signIn: async () => {
        calls.signIn.push(true)
        if (options.signIn) return options.signIn()
        return cloudSession
      },
      createProfile: async (input: unknown) => {
        calls.createProfile.push(input)
        return null as unknown as Profile
      },
      signOut: async () => undefined,
      updateProfile: async () => null as unknown as Profile,
      onAuthStateChange: () => () => undefined,
    },
    restore: async () => {
      calls.restore.push(true)
      if (options.restore) return options.restore()
      return { parties: 1, entries: 1, skipped: 0 }
    },
    subscribe: () => () => undefined,
  }
  return stub as unknown as DataSource & { calls: Record<string, unknown[]> }
}

beforeEach(async () => {
  await deleteDatabase()
  localStorage.clear()
  sessionStorage.clear()
  const seeded = await seedDeviceBook()
  local = seeded.local
  session = seeded.session
})

afterEach(async () => {
  clearPendingTransfer()
  await deleteDatabase()
  localStorage.clear()
  sessionStorage.clear()
})

describe('ربط حساب الجهاز بحساب سحابي', () => {
  it('لا يطلب البريد عند التسجيل: الحساب يُنشأ على الجهاز بلا بريد', async () => {
    // جلسة الجهاز بلا بريد إلكتروني إطلاقًا
    expect(session.email).toBeNull()
    const profile = await profileOf(local)
    expect(profile.fullName).toBe('أحمد محمد')
    expect(profile.phone).toBe('771234567')
    expect(readPendingTransfer()).toBeNull()
  })

  it('ينشئ الحساب السحابي بالبيانات نفسها وينقل دفتر الجهاز إليه', async () => {
    const cloud = fakeCloud({})
    const profile = await profileOf(local)

    const result = await linkCloudAccount({
      cloud,
      local,
      profile,
      email: 'Owner@Example.com',
      password: '123456',
    })

    expect(result.needsConfirmation).toBe(false)
    expect(result.transferred).toEqual({ parties: 1, entries: 1, skipped: 0 })

    // الحساب السحابي أُنشئ بنفس الاسم والهاتف والدور، وبريد موحّد بحروف صغيرة
    const signUpInput = cloud.calls.signUp[0] as SignUpInput
    expect(signUpInput.email).toBe('owner@example.com')
    expect(signUpInput.fullName).toBe('أحمد محمد')
    expect(signUpInput.phone).toBe('771234567')
    expect(signUpInput.role).toBe('customer')

    expect(cloud.calls.createProfile).toHaveLength(1)
    expect(cloud.calls.restore).toHaveLength(1)
    // لا شيء معلّق بعد نجاح النقل
    expect(readPendingTransfer()).toBeNull()
  })

  it('إن طلب المزوّد تأكيد البريد: تُحفظ نسخة الدفتر وتُنقل بعد التأكيد', async () => {
    const cloud = fakeCloud({
      signUp: async () => ({ session: null, needsEmailConfirmation: true }),
    })
    const profile = await profileOf(local)

    const result = await linkCloudAccount({
      cloud,
      local,
      profile,
      email: 'owner@example.com',
      password: '123456',
    })

    expect(result.needsConfirmation).toBe(true)
    expect(result.transferred).toBeNull()
    expect(cloud.calls.createProfile).toHaveLength(0)
    expect(cloud.calls.restore).toHaveLength(0)

    const pending = readPendingTransfer()
    expect(pending?.parties).toHaveLength(1)
    expect(pending?.entries).toHaveLength(1)
    expect(pending?.counts).toEqual({ parties: 1, entries: 1 })

    clearPendingTransfer()
    expect(readPendingTransfer()).toBeNull()
  })

  it('بريد مسجّل مسبقًا: يدخل بالحساب نفسه وينقل الدفتر إليه', async () => {
    const cloud = fakeCloud({
      signUp: async () => {
        throw appError('conflict', undefined, 'هذا البريد مسجّل مسبقًا.')
      },
    })
    const profile = await profileOf(local)

    const result = await linkCloudAccount({
      cloud,
      local,
      profile,
      email: 'owner@example.com',
      password: '123456',
    })

    expect(result.needsConfirmation).toBe(false)
    expect(cloud.calls.signIn).toHaveLength(1)
    expect(cloud.calls.restore).toHaveLength(1)
  })

  it('بريد مسجّل بكلمة مرور مختلفة: رسالة عربية واضحة بلا نقل بيانات', async () => {
    const cloud = fakeCloud({
      signUp: async () => {
        throw appError('conflict')
      },
      signIn: async () => {
        throw appError('unauthorized')
      },
    })
    const profile = await profileOf(local)

    await expect(
      linkCloudAccount({ cloud, local, profile, email: 'owner@example.com', password: '123456' }),
    ).rejects.toThrow(/كلمة مرور مختلفة/)

    expect(cloud.calls.restore).toHaveLength(0)
    expect(readPendingTransfer()).toBeNull()
  })

  it('فشل النقل (شبكة): لا يضيع الدفتر — تبقى النسخة معلّقة للنقل لاحقًا', async () => {
    const cloud = fakeCloud({
      restore: async () => {
        throw appError('network')
      },
    })
    const profile = await profileOf(local)

    const result = await linkCloudAccount({
      cloud,
      local,
      profile,
      email: 'owner@example.com',
      password: '123456',
    })

    expect(result.needsConfirmation).toBe(false)
    expect(result.transferred).toBeNull()
    expect(readPendingTransfer()?.parties).toHaveLength(1)
  })

  it('نسخة الدفتر المعلّقة تُقرأ وتُمسح كما هي', () => {
    stashPendingTransfer({
      app: 'dafatar-adyoon',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      deviceRef: null,
      engine: 'local',
      profile: null,
      parties: [],
      entries: [],
      counts: { parties: 0, entries: 0 },
    })
    expect(readPendingTransfer()?.app).toBe('dafatar-adyoon')
    clearPendingTransfer()
    expect(readPendingTransfer()).toBeNull()
  })

  it('لا ينقل شيئًا إذا كان دفتر الجهاز فارغًا', async () => {
    const empty = new LocalDataSource()
    const created = await empty.auth.signUpDevice!({
      fullName: 'سالم',
      phone: '733444555',
      password: '1234',
      role: 'merchant',
    })
    sessionStorage.setItem(SESSION_TAB, created.userId)
    localStorage.setItem(SESSION_LS, created.userId)

    const cloud = fakeCloud({})
    const result = await linkCloudAccount({
      cloud,
      local: empty,
      profile: await profileOf(empty),
      email: 'salem@example.com',
      password: '123456',
    })

    expect(result.transferred).toEqual({ parties: 0, entries: 0, skipped: 0 })
    expect(cloud.calls.restore).toHaveLength(0)
  })

  it('يفشل الربط بوضوح إن كان المحرّك السحابي بلا قدرة تسجيل', async () => {
    const bare = {
      kind: 'supabase',
      auth: { getSession: async () => null, getProfile: async () => null, signOut: async () => undefined },
    } as unknown as DataSource
    const profile = await profileOf(local)
    await expect(
      linkCloudAccount({ cloud: bare, local, profile, email: 'owner@example.com', password: '123456' }),
    ).rejects.toThrow(/غير متاح/)
  })
})

describe('حساب الجهاز لا يعرف البريد', () => {
  it('قائمة الحسابات على الجهاز لا تحمل بريدًا ولا تُظهره', async () => {
    const accounts = await local.auth.listDeviceAccounts!()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.fullName).toBe('أحمد محمد')
    expect(accounts[0]).not.toHaveProperty('email')
  })

  it('البحث عن حساب على الجهاز يتم بالرقم وحده', async () => {
    expect(await local.auth.findDeviceAccount!('771234567')).toMatchObject({ phone: '771234567' })
    expect(await local.auth.findDeviceAccount!('owner@example.com')).toBeNull()
    vi.restoreAllMocks()
  })
})
