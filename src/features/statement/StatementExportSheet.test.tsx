/**
 * اختبار واجهة تصدير كشف الحساب PDF — للدورين:
 *   · التاجر يُصدر كشفًا لأي عميل وينزّله/يشاركه
 *   · العميل يُصدر كشفًا لأي محل
 *
 * يُبنى ملف PDF فعلي (بخطوط التطبيق) ويُتحقق من:
 *   · صحة الملف (يبدأ بـ %PDF)
 *   · صحة اسم الملف
 *   · أن الملف يُمرَّر إلى آلية التنزيل (أو المشاركة)
 */

import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/app/App'
import { deleteDatabase } from '@/data/local/db'
import { resetDataSource } from '@/data/load'
import { queryClient } from '@/app/queryClient'

const originalFetch = globalThis.fetch

let created: Blob[] = []
let downloads: string[] = []

beforeEach(async () => {
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
  window.location.hash = '#/'
  created = []
  downloads = []

  // خطوط الكشف تُخدَم من ملفات المشروع (كما في الجهاز الحقيقي)
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const name = url.split('/').pop() ?? ''
    const bytes = readFileSync(`public/fonts/${name}`)
    return new Response(new Uint8Array(bytes), { status: 200 })
  }) as typeof fetch

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      created.push(blob)
      return 'blob:dafatar-test'
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await deleteDatabase()
  resetDataSource()
  queryClient.clear()
})

/** يبدأ دفترًا جديدًا بدور محدّد */
async function startBook(role: 'عميل' | 'تاجر', name: string) {
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('button', { name: new RegExp(`أنا ${role}`) }, { timeout: 8000 }))
  await user.type(await screen.findByLabelText(/^الاسم/), name)
  await user.click(screen.getByRole('button', { name: 'ابدأ الآن' }))

  await waitFor(() => expect(screen.queryByText('مرحبًا بك في دفترك')).not.toBeInTheDocument(), { timeout: 5000 })
  return user
}

/** ينزّل الكشف من صفحة الطرف المفتوحة ويُعيد اسم الملف */
async function exportFromDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'تصدير كشف حساب PDF' }, { timeout: 5000 }))

  // الفترة الافتراضية «كل الفترة» ثم نختار «هذا الشهر»
  await user.click(await screen.findByRole('button', { name: 'هذا الشهر' }))
  await user.click(screen.getByRole('button', { name: 'تنزيل ملف PDF' }))

  await waitFor(() => expect(downloads.length).toBeGreaterThan(0), { timeout: 15000 })
  return downloads[0]!
}

describe('تصدير كشف الحساب PDF', () => {
  it('التاجر: يُصدر كشف عميل كملف PDF صالح ويُنزّله', async () => {
    const user = await startBook('تاجر', 'متجر الأمانة')

    await user.click(await screen.findByRole('link', { name: 'العملاء' }, { timeout: 5000 }))
    await user.click(await screen.findByRole('button', { name: 'إضافة عميل' }, { timeout: 5000 }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'سعيد القاضي')
    await user.click(screen.getByRole('button', { name: 'إضافة عميل' }))

    await screen.findByRole('heading', { name: 'سعيد القاضي' }, { timeout: 5000 })

    const fileName = await exportFromDetail(user)
    expect(fileName).toMatch(/^كشف-سعيد-القاضي-\d{4}-\d{2}-\d{2}\.pdf$/)

    const bytes = new Uint8Array(await created[0]!.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(20_000)
  })

  it('العميل: يُصدر كشف محل كملف PDF بلا حاجة لربط أي حساب', async () => {
    const user = await startBook('عميل', 'أحمد الشامي')

    await user.click(await screen.findByRole('link', { name: 'الديون' }, { timeout: 5000 }))
    await user.click(await screen.findByRole('button', { name: 'إضافة محل' }, { timeout: 5000 }))
    await user.type(await screen.findByLabelText(/^الاسم/), 'بقالة النور')
    await user.click(screen.getByRole('button', { name: 'إضافة محل' }))

    await screen.findByRole('heading', { name: 'بقالة النور' }, { timeout: 5000 })

    const fileName = await exportFromDetail(user)
    expect(fileName).toMatch(/^كشف-بقالة-النور-\d{4}-\d{2}-\d{2}\.pdf$/)

    const bytes = new Uint8Array(await created[0]!.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    // لا يُطلب الربط لتصدير الكشف
    expect(screen.queryByText(/يجب ربط حسابك/)).not.toBeInTheDocument()
  })
})
