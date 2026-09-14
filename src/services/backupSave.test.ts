/**
 * حفظ ملف النسخة الاحتياطية على الجهاز — الدالة التي تجيب عن «عملت نسخة ولا أجدها»:
 *   · اختيار أفضل وسيلة حسب المتصفح (File System Access ← المشاركة ← التنزيل)
 *   · إخبار المستخدم بمكان الملف بعد الحفظ
 *   · احترام إلغاء النافذة (لا نُخفي ملفًا لم يرضَ به)
 *   · السقوط الآمن إلى التنزيل عند أي فشل
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBackupPayload, backupFileName, type BackupPayload } from '@/core/backup'
import {
  BACKUP_STORAGE_HINT,
  chooseBackupSaveMethod,
  describeBackupSaveLocation,
  describeBackupSaveMethod,
  saveBackupFile,
} from './backup'

function payload(): BackupPayload {
  return buildBackupPayload({
    profile: { id: 'u1', fullName: 'أحمد', role: 'merchant', currency: 'YER' },
    parties: [],
    entries: [],
    engine: 'local',
    now: new Date('2026-09-14T10:00:00.000Z'),
  })
}

type FakeWindow = Window & {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<unknown>
}

type FakeNavigator = Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> }

const originalPicker = (window as FakeWindow).showSaveFilePicker
const originalCanShare = (navigator as FakeNavigator).canShare
const originalShare = (navigator as FakeNavigator).share
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})

afterEach(() => {
  ;(window as FakeWindow).showSaveFilePicker = originalPicker
  ;(navigator as FakeNavigator).canShare = originalCanShare
  ;(navigator as FakeNavigator).share = originalShare
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  vi.restoreAllMocks()
})

describe('اختيار وسيلة الحفظ', () => {
  it('يُقدّم نافذة الحفظ، ثم المشاركة، ثم التنزيل', () => {
    expect(chooseBackupSaveMethod({ hasFileSystemAccess: true, canShareFiles: true })).toBe('file-picker')
    expect(chooseBackupSaveMethod({ hasFileSystemAccess: false, canShareFiles: true })).toBe('share')
    expect(chooseBackupSaveMethod({ hasFileSystemAccess: false, canShareFiles: false })).toBe('download')
  })

  it('يسمي الوسيلة للمستخدم بوضوح', () => {
    expect(describeBackupSaveMethod('file-picker')).toContain('المجلد')
    expect(describeBackupSaveMethod('share')).toContain('حفظ في الملفات')
    expect(describeBackupSaveMethod('download')).toContain('التنزيلات')
  })

  it('يخبر بمكان الملف مع اسمه في كل وسيلة', () => {
    expect(describeBackupSaveLocation('file-picker', 'a.json')).toContain('المجلد الذي اخترته')
    expect(describeBackupSaveLocation('file-picker', 'a.json')).toContain('a.json')
    expect(describeBackupSaveLocation('share', 'a.json')).toContain('حفظ في الملفات')
    expect(describeBackupSaveLocation('download', 'a.json')).toContain('Downloads')
  })

  it('المكان الداخلي للنسخة مذكور في التطبيق (IndexedDB)', () => {
    expect(BACKUP_STORAGE_HINT).toContain('dafatar.backup')
    expect(BACKUP_STORAGE_HINT).toContain('meta')
  })
})

describe('saveBackupFile', () => {
  it('يكتب الملف عبر File System Access بالمقترح نفسه ويؤكد الحفظ', async () => {
    const written: unknown[] = []
    let closed = false
    let suggested: string | undefined
    ;(window as FakeWindow).showSaveFilePicker = vi.fn(async (options?: { suggestedName?: string }) => {
      suggested = options?.suggestedName
      return {
        createWritable: async () => ({
          write: async (data: unknown) => written.push(data),
          close: async () => {
            closed = true
          },
        }),
      }
    })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })

    const result = await saveBackupFile(payload())

    expect(result.method).toBe('file-picker')
    expect(result.cancelled).toBe(false)
    expect(suggested).toBe(backupFileName(new Date(payload().createdAt)))
    expect(written).toHaveLength(1)
    expect(closed).toBe(true)
    expect(result.hint).toContain('المجلد الذي اخترته')
    expect(URL.createObjectURL).not.toHaveBeenCalled() // لا تنزيل مزدوج
  })

  it('يحترم إلغاء نافذة الحفظ ولا يُنزّل بدلًا منه', async () => {
    ;(window as FakeWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })

    const result = await saveBackupFile(payload())

    expect(result.cancelled).toBe(true)
    expect(result.hint).toContain('أُلغيت العملية')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('يسقط إلى التنزيل إذا رفض المتصفح نافذة الحفظ (لا إيماءة مستخدم)', async () => {
    ;(window as FakeWindow).showSaveFilePicker = vi.fn(async () => {
      throw new TypeError('not allowed')
    })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })

    const result = await saveBackupFile(payload())

    expect(result.method).toBe('download')
    expect(result.cancelled).toBe(false)
    expect(result.hint).toContain('Downloads')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('على iOS يستخدم المشاركة بحفظ الملف باسم صحيح', async () => {
    ;(window as FakeWindow).showSaveFilePicker = undefined
    const shared: ShareData[] = []
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => Array.isArray(data.files) && data.files.length > 0,
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data)
      },
    })

    const result = await saveBackupFile(payload())

    expect(result.method).toBe('share')
    expect(shared[0]?.files?.[0].name).toBe('daftar-backup-2026-09-14.json')
    expect(result.hint).toContain('حفظ في الملفات')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('بلا أي دعم: تنزيل كلاسيكي باسم الملف المتوقع', async () => {
    ;(window as FakeWindow).showSaveFilePicker = undefined
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })

    const result = await saveBackupFile(payload())

    expect(result.method).toBe('download')
    expect(result.fileName).toBe('daftar-backup-2026-09-14.json')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
