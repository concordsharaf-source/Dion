/**
 * تحميل المحرّك المناسب
 * المحرّك السحابي يُحمَّل عند الحاجة فقط (code-splitting)
 */

import type { DataSource } from './port'
import { LocalDataSource } from './local/adapter'
import { appError } from '@/core/errors'
import { CLOUD_SESSION_KEY, isCloudOptedIn } from '@/core/cloudMode'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let current: DataSource | null = null

/** هل مفاتيح مشروع Supabase مضبوطة في بيئة النشر؟ */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith('http'))
}

/**
 * هل نعمل الآن بالمحرّك السحابي؟
 * يحتاج: مفاتيح مضبوطة + أن يكون المستخدم قد فعّل الحساب السحابي (محلي أولًا).
 */
export function isSupabaseActive(): boolean {
  return isSupabaseConfigured() && isCloudOptedIn()
}

export function dataSourceKind(): 'local' | 'supabase' {
  return current?.kind ?? (isSupabaseActive() ? 'supabase' : 'local')
}

/**
 * ينشئ محرّك Supabase (يُحمَّل عند الحاجة فقط — code splitting).
 *
 * يُستعمل في مكانين:
 *   1) إقلاع التطبيق في الوضع السحابي
 *   2) **ربط** حساب الجهاز بحساب سحابي من الإعدادات (إضافة البريد) — قبل
 *      تبديل الوضع، فننشئ المحرّك مؤقتًا وننقل البيانات ثم نُفعّل الوضع.
 */
export async function createCloudSource(): Promise<DataSource> {
  if (!isSupabaseConfigured()) {
    throw appError('not_configured', undefined, 'مفاتيح مشروع Supabase غير مضبوطة في هذه البيئة.')
  }

  const [{ SupabaseDataSource }, { createClient }] = await Promise.all([
    import('./supabase/adapter'),
    import('@supabase/supabase-js'),
  ])

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: CLOUD_SESSION_KEY,
    },
    realtime: { params: { eventsPerSecond: 5 } },
    global: { headers: { 'x-application-name': 'daftar-adyoon' } },
  })

  return new SupabaseDataSource(client)
}

export async function loadDataSource(): Promise<DataSource> {
  if (current) return current

  if (!isSupabaseActive()) {
    current = new LocalDataSource()
    return current
  }

  current = await createCloudSource()
  return current
}

/** للاختبارات */
export function resetDataSource(): void {
  current = null
}
