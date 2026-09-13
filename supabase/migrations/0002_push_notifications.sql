-- ============================================================
-- 0002 — إشعارات الويب (Web Push): تصل والتطبيق مغلق
-- ============================================================
-- الفكرة:
--   1) المتصفح يشترك في خدمة الدفع ⇒ يُحفظ الاشتراك هنا (جدول push_subscriptions).
--   2) كل إشعار جديد في جدول notifications يُدفع فورًا إلى صاحبه عبر Edge Function
--      باسم send-push (عبر pg_net)، فيصل الإشعار على الجهاز والتطبيق مغلق.
--
-- الأسرار المطلوبة (تُضبط ولا تُكتب في الكود):
--   supabase secrets set VAPID_PRIVATE_KEY=… VAPID_PUBLIC_KEY=… VAPID_SUBJECT=mailto:you@example.com
--   supabase secrets set PUSH_HOOK_SECRET=…            -- سرّ يربط القاعدة بالدالة
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- ============================ 1) جدول الاشتراكات ============================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_count integer not null default 0
);

-- ترقية آمنة: إن كان الجدول موجودًا بتصميم أقدم (keys jsonb) نُضيف أعمدة تصميمنا
-- ونتعبّئ المفاتيح منه بلا حذف أي صف.
alter table public.push_subscriptions add column if not exists p256dh text not null default '';
alter table public.push_subscriptions add column if not exists auth text not null default '';
alter table public.push_subscriptions add column if not exists user_agent text;
alter table public.push_subscriptions add column if not exists enabled boolean not null default true;
alter table public.push_subscriptions add column if not exists last_seen_at timestamptz not null default now();
alter table public.push_subscriptions add column if not exists failed_count integer not null default 0;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='push_subscriptions' and column_name='keys') then
    -- تعبئة المفاتيح من عمود keys القديم
    update public.push_subscriptions
       set p256dh = coalesce(nullif(keys->>'p256dh',''), nullif(keys->'keys'->>'p256dh',''), p256dh),
           auth   = coalesce(nullif(keys->>'auth',''),   nullif(keys->'keys'->>'auth',''),   auth)
     where keys is not null and (p256dh = '' or auth = '');

    -- في التصميم القديم كان keys إلزاميًا، وهذا يمنع العملاء الجدد (يكتبون p256dh/auth) من الاشتراك
    alter table public.push_subscriptions alter column keys drop not null;

    -- مُشغّل مزامنة ثنائي الاتجاه: يخدم العملاء القدامى (يكتبون keys) والجدد (يكتبون p256dh/auth)
    execute $fn$
      create or replace function public.push_subscriptions_sync_keys() returns trigger
      language plpgsql as $body$
      begin
        if new.p256dh is null or new.p256dh = '' then
          new.p256dh := coalesce(new.keys->>'p256dh', new.keys->'keys'->>'p256dh');
        end if;
        if new.auth is null or new.auth = '' then
          new.auth := coalesce(new.keys->>'auth', new.keys->'keys'->>'auth');
        end if;
        if new.keys is null and new.p256dh is not null and new.p256dh <> '' then
          new.keys := jsonb_build_object('p256dh', new.p256dh, 'auth', new.auth);
        end if;
        return new;
      end;
      $body$;
    $fn$;

    drop trigger if exists push_subscriptions_sync_keys on public.push_subscriptions;
    create trigger push_subscriptions_sync_keys
      before insert or update on public.push_subscriptions
      for each row execute function public.push_subscriptions_sync_keys();

    -- لم يبقَ صف بلا مفاتيح ⇒ نُطبّق شرط التصميم الجديد
    if not exists (select 1 from public.push_subscriptions
                   where p256dh is null or p256dh = '' or auth is null or auth = '') then
      alter table public.push_subscriptions alter column p256dh set not null;
      alter table public.push_subscriptions alter column auth set not null;
    end if;
  end if;
end $$;

create unique index if not exists push_subscriptions_endpoint_uidx on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where enabled;

comment on table public.push_subscriptions is 'اشتراكات إشعارات الويب لكل مستخدم (جهاز واحد لكل اشتراك)';

-- ============================ 2) RLS ============================
-- كل مستخدم يرى اشتراكاته فقط؛ الكتابة له فقط. الإرسال يتم بدور الخدمة داخل الدالة.

alter table public.push_subscriptions enable row level security;

drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ============================ 3) الإعدادات الخاصة بالإرسال ============================
-- إعدادات عامة يقرأها التطبيق (المفتاح العام فقط — بلا أي سرّ)

create table if not exists public.push_settings (
  id                  boolean primary key default true check (id),
  vapid_public_key    text,
  function_url        text,
  hook_secret_set     boolean not null default false,
  updated_at          timestamptz not null default now()
);

alter table public.push_settings enable row level security;

-- يقرأها أي مستخدم مسجَّل ليحصل على المفتاح العام عند الاشتراك
drop policy if exists push_settings_read on public.push_settings;
create policy push_settings_read on public.push_settings
  for select to authenticated using (true);

-- لا كتابة من الواجهة إطلاقًا
revoke insert, update, delete on public.push_settings from anon, authenticated;

insert into public.push_settings (id) values (true) on conflict (id) do nothing;

-- ============================ 4) دفع الإشعار عند إضافته ============================
-- كل صف جديد في notifications يُرسَل إلى الدالة السحابية send-push.
-- الدالة تتولّى: قراءة اشتراكات المستخدم، الإرسال، حذف الاشتراكات الميتة.

create or replace function public.notifications_dispatch_push() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg   public.push_settings;
  hook  text;
begin
  if new.user_id is null then
    return new;
  end if;

  select * into cfg from public.push_settings where id limit 1;
  if cfg.function_url is null then
    return new; -- لم يُضبط عنوان الدالة بعد
  end if;

  select decrypted_secret into hook
  from vault.decrypted_secrets
  where name = 'push_hook_secret'
  limit 1;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', coalesce(hook, '')
               ),
    body    := jsonb_build_object(
                 'userId',  new.user_id,
                 'title',   new.title,
                 'body',    new.body,
                 'kind',    new.kind,
                 'refType', new.ref_type,
                 'refId',   new.ref_id,
                 'url',     case
                              when new.ref_type = 'entry' then '/#/entries'
                              when new.ref_type = 'link'  then '/#/notifications'
                              else '/#/notifications'
                            end
               ),
    timeout_milliseconds := 5000
  );

  return new;
end $$;

drop trigger if exists notifications_push_dispatch on public.notifications;
create trigger notifications_push_dispatch
  after insert on public.notifications
  for each row execute function public.notifications_dispatch_push();

-- ============================ 5) صلاحيات ============================

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_settings to authenticated;

-- ============================ 6) ملاحظات التشغيل ============================
-- بعد نشر الدالة السحابية، اضبط عنوانها والمفتاح العام:
--
--   update public.push_settings
--      set function_url = 'https://<project-ref>.functions.supabase.co/send-push',
--          vapid_public_key = '<VAPID_PUBLIC_KEY>',
--          hook_secret_set = true
--    where id;
--
-- وسرّ الدالة نفسه يُحفظ في مخزن الأسرار:
--
--   select vault.create_secret('<random>', 'push_hook_secret');
