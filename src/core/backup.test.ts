import { describe, expect, it } from 'vitest'
import {
  BACKUP_APP_ID,
  backupDayKey,
  backupFileName,
  buildBackupPayload,
  defaultAutoBackup,
  formatBytes,
  needsDailyBackup,
  parseBackup,
  serializeBackup,
  summarizeBackup,
} from './backup'
import { AppError } from './errors'
import type { FinancialEntry, Party } from './domain'

function party(id: string, name: string, ownerId = 'u1'): Party {
  return {
    id,
    ownerId,
    kind: 'customer',
    name,
    phone: null,
    address: null,
    note: null,
    searchKey: name,
    linkedUserId: null,
    linkedProfileName: null,
    relationshipId: null,
    linkStatus: 'none',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  }
}

function entry(id: string, partyId: string, amountMinor: number, ownerId = 'u1'): FinancialEntry {
  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scope: 'solo',
    entryType: 'debt',
    entryKind: 'normal',
    status: 'confirmed',
    amountMinor,
    currency: 'YER',
    details: null,
    note: null,
    reason: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    creatorId: ownerId,
    creatorRole: 'merchant',
    creatorName: 'متجر',
    ownerId,
    partyId,
    relationshipId: null,
    merchantUserId: null,
    customerUserId: null,
    merchantPartyId: null,
    customerPartyId: null,
    confirmedBy: ownerId,
    confirmedByName: 'متجر',
    confirmedAt: '2026-01-01T00:00:00.000Z',
    rejectedBy: null,
    rejectedByName: null,
    rejectedAt: null,
    cancelledAt: null,
    reversesEntryId: null,
    reversedByEntryId: null,
    excludedFromBalance: false,
    excludedReason: null,
    clientRef: `ref-${id}`,
  }
}

describe('النسخة الاحتياطية — البناء والقراءة', () => {
  it('يبني نسخة بعدد صحيح من الأطراف والعمليات', () => {
    const payload = buildBackupPayload({
      profile: { id: 'u1', fullName: 'متجر النور', role: 'merchant', currency: 'YER' },
      parties: [party('p1', 'أحمد'), party('p2', 'سعيد')],
      entries: [entry('e1', 'p1', 2_000_000)],
      engine: 'local',
      deviceRef: 'dev-1',
      now: new Date('2026-09-14T20:00:00.000Z'),
    })

    expect(payload.app).toBe(BACKUP_APP_ID)
    expect(payload.version).toBe(1)
    expect(payload.counts).toEqual({ parties: 2, entries: 1 })
    expect(payload.deviceRef).toBe('dev-1')
    expect(payload.createdAt).toBe('2026-09-14T20:00:00.000Z')
  })

  it('يكتب ويقرأ النسخة كما هي', () => {
    const payload = buildBackupPayload({
      profile: null,
      parties: [party('p1', 'أحمد')],
      entries: [entry('e1', 'p1', 1_000_000)],
      engine: 'local',
    })
    const parsed = parseBackup(serializeBackup(payload))
    expect(parsed.parties[0]!.name).toBe('أحمد')
    expect(parsed.entries[0]!.amountMinor).toBe(1_000_000)
    expect(parsed.counts).toEqual({ parties: 1, entries: 1 })
  })

  it('يرفض الملفات غير الصالحة برسالة عربية', () => {
    expect(() => parseBackup('ليس JSON')).toThrow(AppError)
    expect(() => parseBackup('{"app":"شيء آخر"}')).toThrow(/ليس نسخة احتياطية/)
    expect(() => parseBackup('{"app":"dafatar-adyoon","version":99}')).toThrow(/إصدار أحدث/)
  })

  it('يقبل نسخًا صدّرها إصدار سابق من التطبيق', () => {
    const legacy = JSON.stringify({
      app: 'دفتر الديون',
      version: 1,
      exportedAt: '2026-05-01T10:00:00.000Z',
      profile: { id: 'u1', fullName: 'أحمد', role: 'customer', currency: 'YER' },
      parties: [party('p1', 'بقالة النور')],
      entries: [entry('e1', 'p1', 500_000)],
    })
    const parsed = parseBackup(legacy)
    expect(parsed.createdAt).toBe('2026-05-01T10:00:00.000Z')
    expect(parsed.parties).toHaveLength(1)
  })

  it('يتجاهل العناصر التالفة ويُبقي الصالحة', () => {
    const raw = JSON.stringify({
      app: BACKUP_APP_ID,
      version: 1,
      parties: [party('p1', 'أحمد'), { id: 'x' }, null],
      entries: [entry('e1', 'p1', 100), { id: 'bad' }, 'نص'],
    })
    const parsed = parseBackup(raw)
    expect(parsed.parties).toHaveLength(1)
    expect(parsed.entries).toHaveLength(1)
  })
})

describe('النسخة الاحتياطية — سياسة النسخة الواحدة واليوم', () => {
  it('مفتاح اليوم واسم الملف بالتوقيت المحلي', () => {
    const date = new Date(2026, 8, 14, 23, 30) // 14 سبتمبر 2026
    expect(backupDayKey(date)).toBe('2026-09-14')
    expect(backupFileName(date)).toBe('daftar-backup-2026-09-14.json')
  })

  it('التاجر: نسخة تلقائية افتراضيًا — والعميل لا', () => {
    expect(defaultAutoBackup('merchant')).toBe(true)
    expect(defaultAutoBackup('customer')).toBe(false)
  })

  it('تأخذ نسخة اليوم إن لم تكن موجودة، ولا تكرّرها', () => {
    const now = new Date(2026, 8, 14, 22, 0)
    expect(needsDailyBackup({ role: 'merchant', autoEnabled: true, lastDayKey: null, now })).toBe(true)
    expect(needsDailyBackup({ role: 'merchant', autoEnabled: true, lastDayKey: '2026-09-13', now })).toBe(true)
    expect(needsDailyBackup({ role: 'merchant', autoEnabled: true, lastDayKey: '2026-09-14', now })).toBe(false)
  })

  it('لا تأخذ نسخة إن كان الخيار موقوفًا', () => {
    expect(needsDailyBackup({ role: 'merchant', autoEnabled: false, lastDayKey: null })).toBe(false)
    expect(needsDailyBackup({ role: 'customer', autoEnabled: false, lastDayKey: null })).toBe(false)
  })

  it('يصف المحتوى والحجم بصيغة مقروءة', () => {
    expect(summarizeBackup({ counts: { parties: 3, entries: 12 } })).toBe('3 طرف · 12 عملية')
    expect(formatBytes(900)).toBe('900 بايت')
    expect(formatBytes(2048)).toBe('2.0 كيلوبايت')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 ميجابايت')
  })
})
