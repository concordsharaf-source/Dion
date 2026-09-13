/**
 * تحميل المحرّك المناسب
 * المحرّك السحابي يُحمَّل عند الحاجة فقط (code-splitting)
 */

import type { DataSource } from './port'
import { LocalDataSource } from './local/adapter'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let current: DataSource | null = null

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL.startsWith('http'))
}

export function dataSourceKind(): 'local' | 'supabase' {
  return current?.kind ?? (isSupabaseConfigured() ? 'supabase' : 'local')
}

export async function loadDataSource(): Promise<DataSource> {
  if (current) return current

  if (!isSupabaseConfigured()) {
    current = new LocalDataSource()
    return current
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
      storageKey: 'dafatar.auth',
    },
    realtime: { params: { eventsPerSecond: 5 } },
    global: { headers: { 'x-application-name': 'daftar-adyoon' } },
  })

  current = new SupabaseDataSource(client)
  return current
}

/** للاختبارات */
export function resetDataSource(): void {
  current = null
}
