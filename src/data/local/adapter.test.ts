/**
 * حسابات الجهاز: إنشاء بلا كلمة مرور، وفتح بالرقم وحده،
 * وقبول الأرقام القديمة المحفوظة بمفتاح دولة أو بصفر البداية (مع توحيدها).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDataSource } from './adapter'
import { deleteDatabase, getDB, type UserRow } from './db'

let ds: LocalDataSource

beforeEach(async () => {
  await deleteDatabase()
  ds = new LocalDataSource()
})

afterEach(async () => {
  await deleteDatabase()
})

describe('حسابات الجهاز', () => {
  it('ينشئ حسابًا بالاسم والهاتف فقط — بلا كلمة مرور', async () => {
    const session = await ds.auth.signUpDevice!({ fullName: 'متجر النور', phone: '0771234567', role: 'merchant' })
    expect(session.userId).toBeTruthy()

    const profile = await ds.auth.getProfile()
    expect(profile?.fullName).toBe('متجر النور')
    expect(profile?.role).toBe('merchant')
    // الرقم يُخزَّن محليًا بلا صفر البداية
    expect(profile?.phone).toBe('771234567')
  })

  it('يرفض رقمين متشابهين بصيغتين مختلفتين (تكرار الحساب)', async () => {
    await ds.auth.signUpDevice!({ fullName: 'أحمد', phone: '771234567', role: 'customer' })
    await expect(
      ds.auth.signUpDevice!({ fullName: 'أحمد آخر', phone: '+967 771 234 567', role: 'customer' }),
    ).rejects.toThrow(/مسجّل مسبقًا/)
  })

  it('يفتح الحساب بالرقم وحده، وبأي صيغة يكتبها المستخدم', async () => {
    await ds.auth.signUpDevice!({ fullName: 'أحمد', phone: '771234567', role: 'customer' })
    await ds.auth.signOut()

    for (const written of ['771234567', '0771234567', '+967 771 234 567', '00967771234567']) {
      const session = await ds.auth.signInDevice!({ identifier: written })
      expect(session.userId).toBeTruthy()
      await ds.auth.signOut()
    }
  })

  it('يفتح حسابًا قديمًا حُفظ رقمه بمفتاح دولة، ويُوحّده بعد الدخول', async () => {
    const db = await getDB()
    // حساب من نسخة سابقة: الرقم مخزَّن بمفتاح دولة
    const legacy: UserRow = {
      id: 'legacy-1',
      email: 'device-legacy@local',
      passwordHash: '',
      salt: '',
      phone: '+967733222111',
      createdAt: new Date().toISOString(),
    }
    await db.put('users', legacy)
    await db.put('profiles', {
      id: 'legacy-1',
      role: 'merchant',
      roles: ['merchant'],
      fullName: 'متجر قديم',
      phone: '+967733222111',
      currency: 'YER',
      theme: 'system',
      numerals: 'latin',
      createdAt: legacy.createdAt,
      updatedAt: legacy.createdAt,
    } as unknown as Record<string, unknown>)

    const session = await ds.auth.signInDevice!({ identifier: '733222111' })
    expect(session.userId).toBe('legacy-1')

    // الترحيل الهادئ: الرقم صار محليًا في المستخدم والملف الشخصي
    const healed = (await db.get('users', 'legacy-1')) as unknown as UserRow
    expect(healed.phone).toBe('733222111')
    const profile = (await db.get('profiles', 'legacy-1')) as unknown as { phone: string }
    expect(profile.phone).toBe('733222111')
  })

  it('رسالة واضحة عند رقم غير مسجّل', async () => {
    await expect(ds.auth.signInDevice!({ identifier: '700000000' })).rejects.toThrow(/لا يوجد حساب بهذا الرقم/)
  })
})
