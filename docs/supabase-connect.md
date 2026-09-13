# ربط مشروع Supabase باسم `dion` — دليل التنفيذ

التطبيق جاهز للعمل السحابي: المخطّط الكامل (جداول + RLS + دوال مالية + Realtime) موجود في
`supabase/migrations/0001_init.sql`، ولم يبقَ إلا وضعه في مشروعك وتشغيله بمفاتيحه.

---

## 1) ما أحتاجه منك لأربطه بنفسي

| # | القيمة | من أين تجيبها | لماذا |
|---|---|---|---|
| 1 | **Project URL** مثل `https://abcd1234.supabase.co` | Settings ← API | عنوان المشروع |
| 2 | **anon (publishable) key** | Settings ← API ← `anon public` | يُستخدم في الواجهة (آمن مع RLS) |
| 3 | **Project ref** (`abcd1234`) | من داخل الرابط نفسه | للوصول الإداري |
| 4 | **Personal Access Token** (`sbp_…`) — اختياري | Account ← Access Tokens ← Generate | لأشغّل أنا المخطّط والدوال على مشروعك مباشرة |

بدون (4) أستطيع أن أجهّز كل شيء وأعطيك ملف SQL واحدًا تلصقه في **SQL Editor** بضغطة واحدة،
وهذا هو الأكثر أمانًا. ومع (4) أنفّذ الخطوات كلها عنك (إنشاء الجداول، الفهارس، السياسات،
الدوال المالية، تشغيل Realtime، الأسرار، الدوال السحابية) وأتحقق من النتيجة.

### أمان التعامل مع التوكن
- يُستخدم داخل بيئة العمل فقط ويُحفظ في `/tmp` (خارج المستودع) — **لا يُرفَع إلى GitHub ولا يُكتب في أي ملف داخل المشروع**.
- بعد انتهاء الربط: **احذف التوكن** من Supabase (Account ← Access Tokens ← Revoke) ثم أَرسِله من جديد إن احتجنا صيانة.
- مفتاح `anon` ليس سرًّا (مصمَّم ليُشحن للواجهة)، ومع ذلك يُحفظ في `.env.local` وهو **مستثنى في `.gitignore`**.
- **Service Role Key لا يدخل الواجهة ولا هذا المستودع إطلاقًا** (قاعدة ثابتة في المشروع).

## 2) من أين تأخذ المفاتيح — خطوة بخطوة

### أ) Project URL + anon key
1. افتح <https://supabase.com/dashboard> وسجّل الدخول.
2. اختر المشروع **dion** من قائمة المشاريع.
3. من الشريط الجانبي: ⚙ **Project Settings** ← **Data API** (كان اسمه API سابقًا).
4. انسخ **Project URL** — شكله `https://xxxxxxxx.supabase.co`.
5. من نفس الصفحة (أو من **API Keys**) انسخ **anon public** / **publishable key**.
   - المفتاح القديم يبدأ بـ `eyJ…`، والجديد بـ `sb_publishable_…` — كلاهما صالح.
   - ⚠️ لا تنسخ **service_role / secret** إطلاقًا — هذا مفتاح إداري ولا يدخل الواجهة أبدًا.
6. **Project ref** = الجزء `xxxxxxxx` من الرابط (أو من `https://supabase.com/dashboard/project/xxxxxxxx`).

### ب) Personal Access Token (للتنفيذ الإداري)
1. افتح <https://supabase.com/dashboard/account/tokens>.
2. **Generate new token** ← اسم مثل `arena-dion-setup` ← انسخ القيمة `sbp_…` (تظهر مرة واحدة فقط).
3. أرسلها لي في المحادثة. سأستخدمها لأشغّل المخطّط والدوال والتحقق، ولن تُكتب في أي ملف داخل المشروع (تُحفظ في `/tmp` فقط).
4. بعد انتهاء الربط: ارجع لنفس الصفحة واضغط **Revoke** على التوكن — لا حاجة له بعد ذلك.

### ج) ماذا أفعل بالتوكن (بلا أي لبس)
- تشغيل `0001_init.sql` و`0002_push_notifications.sql` على مشروعك (Management API: `POST /v1/projects/{ref}/database/query`).
- ضبط أسرار الدالة: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `PUSH_HOOK_SECRET`.
- نشر Edge Function `send-push` وضبط `function_url` و`vapid_public_key` في `push_settings`.
- إضافة `Site URL` و`Redirect URLs` للمصادقة.
- اختبار سريع: جداول موجودة، RLS فعّال، وإشعار يصل والجهاز مغلق.
- **لا ألمس بياناتك**: لا حذف جداول ولا مساس بحسابات قائمة.

## 3) خطوات الربط (سأنفّذها أنا أو تلصقها أنت)

1. **متغيّرات البيئة** — انسخ `.env.example` إلى `.env.local` واملأ `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY`.
   في الاستضافة (Vercel/Netlify) أضف نفس المتغيّرين في Environment Variables.
2. **المخطّط** — نفّذ محتوى `supabase/migrations/0001_init.sql` في SQL Editor.
   يحوي: `profiles, parties, relationships, link_requests, balance_proposals, financial_entries,
   notifications, audit_logs, settings` + الفهارس + RLS الصارم + الدوال المالية المؤمّنة
   (`create_entry`, `confirm_entry`, `reject_entry`, `cancel_entry`, `create_link_invite`, `claim_link_invite`,
   `accept_link_request`, `preview_link_token`, `propose_opening_balance`, `respond_opening_balance` …)
   + تشغيل Realtime على الجداول اللازمة.
3. **المصادقة** — Authentication ← Providers: تشغيل **Email** («Confirm email» حسب رغبتك).
   وفي URL Configuration أضف عنوان التطبيق في `Site URL` و`Redirect URLs`
   (مثل `https://<نطاقك>/#/` و`http://localhost:5173/#/`).
4. **التحقق** — أنشئ حسابًا، ثم: `profiles` فيه صفك، وتظهر `parties/financial_entries` بين جهازين
   بنفس الحساب، وتصل `notifications` لحظيًا.

## 4) الإشعارات حتى والتطبيق مغلق (Web Push)

الطريقة: **Web Push قياسي** — المتصفح يحتفظ بقناة إشعارات مع خدمة الدفع، فيصل الإشعار والتطبيق مغلق
أو مغلق تمامًا (كما في التطبيقات المثبّتة). على Android/Chrome يعمل مباشرة، وعلى iPhone يشترط
«إضافة إلى الشاشة الرئيسية» (iOS 16.4+).

### مفاتيح VAPID (تُضبط مرة واحدة)
- **العام** ← `VITE_VAPID_PUBLIC_KEY` في `.env.local` (وفي استضافتك):
  `BIQ-Xe9ivmpVy6eftxhHyHYroqO33tI1q5aFYaQefnrN7WNHAQcgg7POuDSMaAr5EnKGZigLvy_ft-lwQ7dCEIg`
- **الخاص** ← سرّ في Supabase فقط (لا يُكتب هنا ولا في المستودع):
  ```bash
  supabase secrets set VAPID_PRIVATE_KEY=<المفتاح الخاص> VAPID_PUBLIC_KEY=… VAPID_SUBJECT=mailto:concordsharaf@gmail.com
  ```
  أو ولّد زوجًا خاصًا بك بأمر واحد ولا يخرج من جهازك:
  ```bash
  npx web-push generate-vapid-keys
  ```
  (إن ولّدت زوجًا جديدًا: ضع العام في `VITE_VAPID_PUBLIC_KEY` والخاص في أسرار الدالة، وبذلك يُلغى أي مفتاح سابق.)

> 🔐 ملاحظة أمنية: المفتاح الخاص يكفي لإرسال إشعارات لمشتركيك، فهو سرّ. لذلك لا يُكتب في المستودع —
> يُحفظ في أسرار Edge Functions فقط. (أي مفتاح خاص يُكتب في ملف داخل المشروع يجب اعتباره مكشوفًا ويُستبدل.)

### ما نُفِّذ في التطبيق (جاهز الآن)
1. `src/core/push.ts` + `src/services/push.ts`: الدعم، الإذن، الاشتراك والإلغاء، تحويل مفاتيح VAPID.
2. `public/push-sw.js` محمّل داخل الـ Service Worker: يستقبل `push` ويعرض الإشعار، ويفتح الشاشة الصحيحة عند النقر.
3. زر **«إشعارات فورية»** في الإعدادات ← التفضيلات (تحت صوت العمليات).
4. `supabase/migrations/0002_push_notifications.sql`: جدول `push_subscriptions` + RLS + Trigger يدفع كل إشعار جديد.
5. `supabase/functions/send-push/index.ts`: الدالة السحابية التي ترسل وتنظّف الاشتراكات الميتة.
6. قسم **«الحساب السحابي»** في الإعدادات: التطبيق محلي أولًا، والسحابي خيار صريح من المستخدم.

### خطوات النشر عند ربط المشروع
```bash
# 1) نشر الدالة
supabase functions deploy send-push --project-ref <project-ref>

# 2) الأسرار (لا تُكتب في المستودع)
supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:concordsharaf@gmail.com PUSH_HOOK_SECRET=<عشوائي>

# 3) ربط القاعدة بالدالة
#    update public.push_settings set function_url='https://<ref>.functions.supabase.co/send-push',
#      vapid_public_key='<VAPID_PUBLIC_KEY>', hook_secret_set=true where id;
#    select vault.create_secret('<نفس PUSH_HOOK_SECRET>', 'push_hook_secret');
```
ثم في التطبيق: الإعدادات ← **إشعارات فورية** ← تفعيل. ومن جهاز آخر بنفس الحساب يعمل الاشتراك لكل جهاز على حدة.

### المكوّنات المتبقية بعد النشر
1. جدول `push_subscriptions` (endpoint فريد + مفاتيح التشفير + user_id + آخر ظهور) مع RLS لصاحبه فقط.
2. زر تفعيل في **الإعدادات ← الإشعارات**: «أشعرني حتى لو كان التطبيق مغلقًا» (طلب إذن + اشتراك).
3. `push-sw.js` داخل Service Worker: استقبال `push` وعرض الإشعار + فتح الشاشة الصحيحة عند النقر.
4. Edge Function `send-push`: تُرسل الإشعارات للمشتركين وتنظّف الاشتراكات الميتة (404/410).
5. Trigger على `notifications`: كل إشعار جديد (دين/سداد/طلب ربط/تأكيد/رفض) يُدفع فورًا لصاحبها —
   فالتاجر يسجّل عملية، والعميل يستلم إشعارًا على جهازه **والتطبيق مغلق**.
6. لاحقًا عند التحويل إلى Android: نفس البنية تتوسّع إلى FCM (`google-services.json`) بلا إعادة تصميم.

### ملاحظات مهمة
- الإشعار لا يُحسب تأكيدًا ماليًا: التأكيد يبقى داخل التطبيق (بالحالة والوقت)، والإشعار مجرّد تنبيه.
- على المتصفحات القديمة/الغير مثبّتة قد يبقى الإشعار داخل التطبيق فقط (الحزام الاحتياطي: الشاشة الحالية
  و`notifications` مع Realtime).
