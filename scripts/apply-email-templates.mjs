#!/usr/bin/env node
/**
 * تطبيق قوالب البريد العربية على مشروع Supabase دفعة واحدة.
 *
 * الأسرار لا تُكتب في المستودع — تُقرأ من البيئة فقط:
 *   SUPABASE_ACCESS_TOKEN   توكن إدارة (Personal Access Token) — أبطله بعد الاستخدام
 *   SUPABASE_PROJECT_REF    مرجع المشروع (افتراضيًا: dion)
 *
 * التشغيل:
 *   node scripts/apply-email-templates.mjs            # يطبّق القوالب
 *   node scripts/apply-email-templates.mjs --no-confirm-email
 *        لتفعيل القوالب بلا إلزام تأكيد البريد (يبقى mailer_autoconfirm كما هو)
 *
 * ملاحظة: Supabase ترفض تعديل القوالب على الخطة المجانية مع خدمة البريد الافتراضية،
 * فيلزم إضافة SMTP خاص أولًا (تفاصيل ذلك في supabase/email-templates/README.md).
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(HERE, '..', 'supabase', 'email-templates')

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const REF = process.env.SUPABASE_PROJECT_REF?.trim() || 'pyjjaekcqbdijcyloqvx'
const setConfirm = !process.argv.includes('--no-confirm-email')

if (!TOKEN) {
  console.error('✗ ضع توكن الإدارة في المتغيّر SUPABASE_ACCESS_TOKEN أولًا (لا يُكتب في المستودع).')
  process.exit(1)
}

/** أزواج: ملف القالب ← مفتاح الإعداد في Supabase (مع العنوان المناسب) */
const MAP = [
  ['confirmation.html', 'mailer_templates_confirmation_content', 'mailer_subjects_confirmation', 'تأكيد بريدك الإلكتروني — دفتر الديون'],
  ['recovery.html', 'mailer_templates_recovery_content', 'mailer_subjects_recovery', 'استعادة كلمة المرور — دفتر الديون'],
  ['magic-link.html', 'mailer_templates_magic_link_content', 'mailer_subjects_magic_link', 'رابط الدخول — دفتر الديون'],
  ['email-change.html', 'mailer_templates_email_change_content', 'mailer_subjects_email_change', 'تأكيد البريد الجديد — دفتر الديون'],
  ['invite.html', 'mailer_templates_invite_content', 'mailer_subjects_invite', 'دعوة إلى دفتر الديون'],
]

const payload = {}
for (const [file, bodyKey, subjectKey, subject] of MAP) {
  payload[bodyKey] = await readFile(join(TEMPLATES_DIR, file), 'utf8')
  payload[subjectKey] = subject
}
if (setConfirm) payload.mailer_autoconfirm = false

const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

if (!response.ok) {
  const text = await response.text()
  console.error(`✗ فشل التطبيق (${response.status}): ${text}`)
  if (text.includes('Custom SMTP') || text.includes('custom SMTP')) {
    console.error('  ↳ الحل: أضف SMTP خاصًا أولًا (Authentication ← Emails ← SMTP Settings).')
  }
  process.exit(1)
}

const config = await response.json()
console.log('✓ طُبِّقت القوالب العربية على', REF)
console.log('  mailer_autoconfirm =', config.mailer_autoconfirm)
console.log('  subject(confirm)   =', config.mailer_subjects_confirmation)
