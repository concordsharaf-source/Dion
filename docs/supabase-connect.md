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

## 2) خطوات الربط (سأنفّذها أنا أو تلصقها أنت)

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

## 3) الإشعارات حتى والتطبيق مغلق (Web Push)

الطريقة: **Web Push قياسي** — المتصفح يحتفظ بقناة إشعارات مع خدمة الدفع، فيصل الإشعار والتطبيق مغلق
أو مغلق تمامًا (كما في التطبيقات المثبّتة). على Android/Chrome يعمل مباشرة، وعلى iPhone يشترط
«إضافة إلى الشاشة الرئيسية» (iOS 16.4+).

### مفاتيح VAPID (جاهزة — وُلِّدت لمشروعك)
```
VAPID_PUBLIC_KEY=BPbddHmjbgRMOUVoQ6z7cE3olOo4bKYxBXxj_UsoepYHJ4_7gp6CunDbT1z8eQaNRSGsjXt-6ZO70D4DYyqRnHo
VAPID_PRIVATE_KEY=a5_M3W5coUyzeYaXAVsZQDlyvlLkoZ_5tv4RmQsO7Js
```
- **العام** ← `VITE_VAPID_PUBLIC_KEY` في `.env.local` (وفي استضافتك).
- **الخاص** ← سرّ في Supabase: `supabase secrets set VAPID_PRIVATE_KEY=… VAPID_PUBLIC_KEY=… VAPID_SUBJECT=mailto:concordsharaf@gmail.com`
- لا يُكتب الخاص في المستودع. (وإن أردت مفاتيح خاصة بك: `npx web-push generate-vapid-keys` واستبدلها.)

### المكوّنات المطلوبة (سأبنيها في المرحلة التالية)
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
