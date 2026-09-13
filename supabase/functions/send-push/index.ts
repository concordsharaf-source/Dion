/**
 * Edge Function: send-push
 * ------------------------------------------------------------------
 * تُستدعى من القاعدة (trigger على جدول notifications) أو يدويًا، فتُرسل
 * إشعار ويب للمستخدمين المشتركين — ويصل والإشعار والتطبيق **مغلق تمامًا**.
 *
 * الأسرار (تُضبط من: supabase secrets set …):
 *   VAPID_PUBLIC_KEY   — المفتاح العام (نفس المستخدم في الواجهة)
 *   VAPID_PRIVATE_KEY  — المفتاح الخاص (لا يُكشف أبدًا للواجهة)
 *   VAPID_SUBJECT      — mailto:concordsharaf@gmail.com
 *   PUSH_HOOK_SECRET   — سرّ مشترك مع القاعدة لمنع الاستدعاء الخارجي
 *
 * Supabase يُوفّر SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY تلقائيًا للدوال.
 * Service Role يبقى داخل الدالة فقط — ولا يدخل الواجهة أبدًا.
 */

// @ts-expect-error — وحدات Deno متاحة في بيئة Edge Functions
import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-expect-error — مكتبة إرسال إشعارات الويب
import webpush from 'npm:web-push@3'

interface PushRequest {
  userId?: string
  title?: string
  body?: string | null
  kind?: string
  refType?: string | null
  refId?: string | null
  url?: string | null
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failed_count: number
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const expected = Deno.env.get('PUSH_HOOK_SECRET') ?? ''
  if (expected && req.headers.get('x-push-secret') !== expected) {
    return json(401, { error: 'unauthorized' })
  }

  let payload: PushRequest
  try {
    payload = (await req.json()) as PushRequest
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  if (!payload?.userId) return json(400, { error: 'missing_user' })

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:concordsharaf@gmail.com'
  if (!vapidPublic || !vapidPrivate) return json(500, { error: 'vapid_not_configured' })

  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failed_count')
    .eq('user_id', payload.userId)
    .eq('enabled', true)

  if (error) return json(500, { error: 'db_error', detail: error.message })
  const subscriptions = (subs ?? []) as SubscriptionRow[]
  if (subscriptions.length === 0) return json(200, { sent: 0, reason: 'no_subscriptions' })

  const notification = {
    title: payload.title?.trim() || 'دفتر الديون',
    body: payload.body ?? '',
    kind: payload.kind ?? 'info',
    url: payload.url ?? '/#/notifications',
    tag: payload.refId ? `${payload.refType ?? 'ref'}-${payload.refId}` : `daftar-${Date.now()}`,
  }

  let sent = 0
  const dead: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(notification),
          { TTL: 60 * 60 * 24 },
        )
        sent += 1
        await supabase
          .from('push_subscriptions')
          .update({ last_seen_at: new Date().toISOString(), failed_count: 0 })
          .eq('id', sub.id)
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0
        // 404/410 ⇒ اشتراك ميت (أُلغيت الثقة أو أُزيل التطبيق) — يُحذف
        if (status === 404 || status === 410) {
          dead.push(sub.id)
        } else {
          await supabase
            .from('push_subscriptions')
            .update({ failed_count: sub.failed_count + 1 })
            .eq('id', sub.id)
        }
      }
    }),
  )

  if (dead.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', dead)
  }

  return json(200, { sent, dead: dead.length, total: subscriptions.length })
})
