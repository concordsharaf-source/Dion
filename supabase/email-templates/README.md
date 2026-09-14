# قوالب البريد العربية (تأكيد الحساب / الاستعادة)

هذه القوالب جاهزة للتطبيق كما هي. الرابط المستخدم فيها هو **صيغة `token_hash`** لا الصيغة الافتراضية،
والسبب: التطبيق يعمل بتوجيه الهاش (`createHashRouter`)، والصيغة الافتراضية تضع الرمز بعد `#`
(`#access_token=…`) فيتعارض مع المسار. أمّا الاستعلام قبل `#` فيقرأه التطبيق عند الإقلاع ثم يتحقق منه.

```
{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email   ← تأكيد الحساب
{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery ← استعادة كلمة المرور
```

التطبيق يعالج هذا في `src/core/emailLink.ts` + `src/app/EmailLinkGate.tsx`
(ويتعامل أيضًا مع الصيغة الافتراضية `#access_token=…` احتياطًا).

## ⚠️ قيد مهم على الخطة المجانية

Supabase ترفض تعديل قوالب البريد على الخطة المجانية **طالما تستخدم خدمة البريد الافتراضية**:

```
Email template modification is not available for free tier projects using the default email provider.
Please upgrade your plan or configure a custom SMTP provider.
```

ولذلك لا بُدّ من **SMTP خاص** (مجاني أيضًا) لتفعيل القوالب العربية:

| المزوّد | ما يلزم | الحد المجاني |
| --- | --- | --- |
| Resend | حساب + API Key (يُستخدم ككلمة مرور SMTP) | 100 رسالة/يوم |
| Brevo | حساب + SMTP Key | 300 رسالة/يوم |
| Gmail | كلمة مرور التطبيقات (App Password) | ~500/يوم (غير مخصّص للنطاقات) |

ثم في لوحة Supabase: **Authentication ← Emails ← SMTP Settings** يُدخل:
`Host` و`Port` (587) و`Username` و`Password` و`Sender email`.

## بعد إضافة SMTP: طريقتان لتطبيق القوالب

### 1) من لوحة Supabase (الأسهل)
**Authentication ← Emails ← Templates** ← انسخ محتوى كل ملف من هذا المجلد:

| القالب في اللوحة | الملف | العنوان (Subject) |
| --- | --- | --- |
| Confirm signup | `confirmation.html` | من `subjects.txt` |
| Reset password | `recovery.html` | 〃 |
| Magic link | `magic-link.html` | 〃 |
| Change email address | `email-change.html` | 〃 |
| Invite user | `invite.html` | 〃 |

### 2) بأمر واحد (بعد ضبط التوكن في البيئة فقط — لا يُكتب في المستودع)
```bash
export SUPABASE_ACCESS_TOKEN=sbp_...        # توكن إدارة مؤقّت
export SUPABASE_PROJECT_REF=pyjjaekcqbdijcyloqvx
node scripts/apply-email-templates.mjs
```
يقوم بنسخ القوالب والعناوين دفعة واحدة، ويُثبّت `mailer_autoconfirm = false` (تأكيد البريد إلزامي).

## ترتيب التنفيذ الصحيح
1. أضف SMTP خاصًا (وإلا لن تُقبل القوالب ولن تصل الرسائل بالعربية).
2. طبّق القوالب (لوحة أو الأمر أعلاه).
3. تأكد أن `mailer_autoconfirm = false` (هذا ما يفعله الأمر أعلاه).
4. جرّب: أنشئ حسابًا من التطبيق ⇒ لا يدخل مباشرة ⇒ افتح الرابط من بريدك ⇒ يعود للتطبيق ويُنشأ ملفك الشخصي تلقائيًا.

## ملاحظة عن حدود الإرسال
خدمة Supabase الافتراضية تسمح بعدد قليل جدًا من الرسائل في الساعة (تحسبًا للمساء)،
فإن فعّلت «تأكيد البريد» قبل إضافة SMTP خاص فقد يتعذّر على بعض المستخدمين إنشاء حساباتهم.
