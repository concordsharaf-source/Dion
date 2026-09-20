# ربط تسجيل الدخول بـ Google (Gmail) - بدون كلمة مرور

التطبيق الآن يدعم **المتابعة باستخدام Google** مثل بقية التطبيقات - يضغط المستخدم على زر Google ويُسجل دخوله بحساب Gmail تلقائياً بلا إدخال كلمة مرور.

## كيف يعمل؟

1. في شاشة البداية يختار المستخدم نوع حسابه (عميل / تاجر)
2. يضغط **"متابعة بـ Google"**
3. يتم حفظ الدور المختار مؤقتاً في `localStorage` ثم تحويل المتصفح إلى Google OAuth عبر Supabase
4. بعد موافقة المستخدم في Google يعود إلى `/#/` بجلسة جاهزة
5. trigger `handle_new_user()` في قاعدة البيانات ينشئ ملف شخصي تلقائياً من `user_metadata` القادم من Google (الاسم + البريد)
6. مكون `GoogleRoleSync` يتحقق إن كان الدور المحفوظ مختلفاً عن الدور الافتراضي ويحدّثه فوراً

في شاشة تسجيل الدخول أيضاً يوجد زر **"المتابعة باستخدام Google"** للمستخدمين السحابيين الحاليين.

## الإعداد المطلوب في Supabase و Google Cloud

حتى يعمل الزر في الإنتاج يجب تفعيل مزود Google في Supabase:

### 1) Google Cloud Console
1. افتح https://console.cloud.google.com
2. أنشئ مشروعاً أو اختر مشروعك
3. APIs & Services > Credentials > Create Credentials > OAuth client ID
4. نوع التطبيق: Web application
5. Authorized JavaScript origins:
   - `https://<your-app-domain>`
   - `https://<supabase-ref>.supabase.co`
6. Authorized redirect URIs:
   - `https://<supabase-ref>.supabase.co/auth/v1/callback`
7. انسخ Client ID و Client Secret

### 2) Supabase Dashboard
1. Authentication > Providers > Google > Enable
2. الصق Client ID و Client Secret من Google
3. احفظ

### 3) متغيرات البيئة
التطبيق يحتاج مفاتيح Supabase فقط (موجودة أصلاً):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

عند عدم وجودها (وضع الجهاز فقط) زر Google لا يظهر.

## الملفات التي تغيّرت
- `src/data/port.ts` : إضافة `signInWithGoogle?(role?:Role)` إلى AuthPort
- `src/data/supabase/adapter.ts` : تنفيذها عبر `supabase.auth.signInWithOAuth({provider:'google'})`
- `src/features/auth/WelcomeScreen.tsx` : زر Google مع أيقونة ملونة + حفظ الدور قبل التحويل
- `src/features/auth/SignInScreen.tsx` : زر Google لتسجيل الدخول السحابي
- `src/app/GoogleRoleSync.tsx` : مزامنة الدور بعد العودة من Google
- `src/app/App.tsx` : تضمين المزامن

## ملاحظات أمان
- لا كلمة مرور تُخزن عند استخدام Google - المصادقة عبر Google OAuth2
- RLS و SECURITY DEFINER يحميان البيانات نفس الحماية السابقة
- `access_type: offline` + `prompt: consent` لضمان الحصول على refresh token
