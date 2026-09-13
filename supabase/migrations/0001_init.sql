-- ============================================================================
--  دفتر الديون — المخطّط الأساسي (PostgreSQL / Supabase)
--  الإصدار: 0001_init
--
--  المبادئ الحاكمة في هذا المخطّط:
--   1) دفتر واحد للقيود المالية (financial_entries) بلا أي حقل رصيد مخزّن.
--      الرصيد = Σ الديون المؤكدة − Σ السدادات المؤكدة (يُحسب دائمًا).
--   2) لا تعديل صامت ولا حذف مالي: التصحيح بقيد عكسي مرتبط بالأصل.
--   3) كل الكتابات المالية تمرّ عبر دوال SECURITY DEFINER تتحقق من الملكية
--      والحالة والمبلغ — لا كتابة مباشرة على الجداول من العميل.
--   4) RLS صارم على كل الجداول: كل مستخدم يرى بياناته فقط، ولا يمكنه تأكيد
--      عملية نيابة عن الطرف الآخر.
--   5) shops/customers و debts/payments عروض (views) فوق الجداول الحقيقية
--      لتوافق التسميات المطلوبة دون تكرار البيانات أو إفساد الدفتر الواحد.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================ 1) الملفات الشخصية ============================

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('customer', 'merchant')),
  full_name   text not null check (char_length(full_name) between 1 and 60),
  phone       text,
  currency    text not null default 'YER' check (char_length(currency) = 3),
  theme       text not null default 'system' check (theme in ('light', 'dark', 'system')),
  numerals    text not null default 'latin' check (numerals in ('latin', 'arabic')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'ملف كل مستخدم: الدور والعملة والتفضيلات. يُنشأ مرة واحدة بعد التسجيل.';

-- ============================ 2) الأطراف (محل / عميل) ========================

create table if not exists public.parties (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users (id) on delete cascade,
  kind                text not null check (kind in ('shop', 'customer')),
  name                text not null check (char_length(name) between 1 and 80),
  phone               text,
  address             text,
  note                text,
  search_key          text not null default '',
  linked_user_id      uuid references auth.users (id) on delete set null,
  linked_profile_name text,
  relationship_id     uuid,
  link_status         text not null default 'none' check (link_status in ('none', 'pending', 'verified')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create index if not exists parties_owner_idx on public.parties (owner_id, archived_at);
create index if not exists parties_search_idx on public.parties (owner_id, search_key);
create index if not exists parties_linked_idx on public.parties (linked_user_id);

comment on table public.parties is 'المحل (في دفتر العميل) أو العميل (في دفتر التاجر). لا يشترط أن يكون الطرف مستخدمًا.';

-- ============================ 3) العلاقات بين الطرفين ========================

create table if not exists public.relationships (
  id                    uuid primary key default gen_random_uuid(),
  merchant_user_id      uuid not null references auth.users (id) on delete cascade,
  customer_user_id      uuid not null references auth.users (id) on delete cascade,
  merchant_party_id     uuid references public.parties (id) on delete set null,
  customer_party_id     uuid references public.parties (id) on delete set null,
  merchant_name         text,
  customer_name         text,
  status                text not null default 'verified' check (status in ('verified', 'ended')),
  opening_balance_status text not null default 'none' check (opening_balance_status in ('none', 'proposed', 'accepted', 'declined')),
  opening_balance_minor bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  ended_at              timestamptz,
  check (merchant_user_id <> customer_user_id)
);

create unique index if not exists relationships_pair_idx
  on public.relationships (merchant_user_id, customer_user_id)
  where status = 'verified';

create index if not exists relationships_customer_idx on public.relationships (customer_user_id);
create index if not exists relationships_merchant_idx on public.relationships (merchant_user_id);

-- طلبات الربط (رمز QR لمرة واحدة، قصير العمر، بلا أي بيانات مالية)
create table if not exists public.link_requests (
  id                   uuid primary key default gen_random_uuid(),
  merchant_user_id     uuid not null references auth.users (id) on delete cascade,
  merchant_name        text,
  customer_user_id     uuid references auth.users (id) on delete set null,
  customer_name        text,
  status               text not null default 'awaiting_scan'
                        check (status in ('awaiting_scan', 'pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  token                text not null unique,
  expires_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  used_at              timestamptz,
  previous_balance_minor bigint not null default 0,
  rejection_reason     text
);

create index if not exists link_requests_merchant_idx on public.link_requests (merchant_user_id);
create index if not exists link_requests_customer_idx on public.link_requests (customer_user_id);

-- اعتماد الرصيد السابق (لا دمج تلقائي أبدًا)
create table if not exists public.balance_proposals (
  id               uuid primary key default gen_random_uuid(),
  relationship_id  uuid not null references public.relationships (id) on delete cascade,
  proposed_by      uuid not null references auth.users (id) on delete cascade,
  amount_minor     bigint not null check (amount_minor > 0),
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_by     uuid references auth.users (id) on delete set null,
  responded_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists balance_proposals_rel_idx on public.balance_proposals (relationship_id, status);

-- ============================ 4) الدفتر المالي ============================

create table if not exists public.financial_entries (
  id                    uuid primary key default gen_random_uuid(),
  scope                 text not null check (scope in ('solo', 'shared')),
  entry_type            text not null check (entry_type in ('debt', 'payment')),
  entry_kind            text not null default 'normal' check (entry_kind in ('normal', 'opening', 'reversal')),
  status                text not null check (status in ('pending', 'confirmed', 'rejected', 'cancelled', 'reversed')),
  amount_minor          bigint not null check (amount_minor > 0),
  currency              text not null default 'YER' check (char_length(currency) = 3),
  details               text,
  note                  text,
  reason                text,

  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  creator_id            uuid not null references auth.users (id) on delete cascade,
  creator_role          text not null check (creator_role in ('customer', 'merchant')),
  creator_name          text,

  -- الوضع المستقل
  owner_id              uuid references auth.users (id) on delete cascade,
  party_id              uuid references public.parties (id) on delete cascade,

  -- الوضع المشترك
  relationship_id       uuid references public.relationships (id) on delete set null,
  merchant_user_id      uuid references auth.users (id) on delete set null,
  customer_user_id      uuid references auth.users (id) on delete set null,
  merchant_party_id     uuid references public.parties (id) on delete set null,
  customer_party_id     uuid references public.parties (id) on delete set null,

  -- المصادقة المالية بحساب الطرف الحقيقي + وقت التأكيد (+ الجهاز/الجلسة)
  confirmed_by          uuid references auth.users (id) on delete set null,
  confirmed_by_name     text,
  confirmed_at          timestamptz,
  rejected_by           uuid references auth.users (id) on delete set null,
  rejected_by_name      text,
  rejected_at           timestamptz,
  cancelled_at          timestamptz,
  device_ref            text,
  session_ref           text,

  -- العكس والتصحيح
  reverses_entry_id     uuid references public.financial_entries (id) on delete set null,
  reversed_by_entry_id  uuid references public.financial_entries (id) on delete set null,

  -- منع الإرسال المزدوج من نفس الجهاز
  client_ref            text not null,

  -- استثناء السجل القديم من الرصيد الموثّق (لا يُدمج إلا بموافقة صريحة)
  excluded_from_balance boolean not null default false,
  excluded_reason       text check (excluded_reason in ('superseded_by_opening', 'legacy_unverified')),

  constraint entries_scope_shape check (
    (scope = 'solo' and owner_id is not null and party_id is not null and relationship_id is null)
    or
    (scope = 'shared' and relationship_id is not null and merchant_user_id is not null and customer_user_id is not null)
  ),
  constraint entries_confirm_requires_actor check (
    status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)
  ),
  constraint entries_reversal_link check (
    (entry_kind = 'reversal') = (reverses_entry_id is not null)
  )
);

create unique index if not exists entries_client_ref_idx on public.financial_entries (creator_id, client_ref);
create index if not exists entries_owner_idx on public.financial_entries (owner_id, party_id, status);
create index if not exists entries_relationship_idx on public.financial_entries (relationship_id, status);
create index if not exists entries_merchant_idx on public.financial_entries (merchant_user_id, status, created_at desc);
create index if not exists entries_customer_idx on public.financial_entries (customer_user_id, status, created_at desc);
create index if not exists entries_creator_idx on public.financial_entries (creator_id, created_at desc);
create index if not exists entries_pending_idx on public.financial_entries (status) where status = 'pending';

comment on table public.financial_entries is
  'الدفتر المالي الوحيد: ديون وسدادات وأقياد افتتاحية وعكسية. لا حذف — التصحيح بقيد عكسي.';
comment on column public.financial_entries.amount_minor is
  'المبلغ بوحدات صغرى (عدد صحيح). لا Float ولا أرقام عشرية عائمة.';

-- ============================ 5) الإشعارات وسجل التدقيق =====================

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  ref_type    text check (ref_type in ('entry', 'party', 'link', 'relationship')),
  ref_id      uuid,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references auth.users (id) on delete set null,
  action         text not null,
  entity         text not null,
  entity_id      uuid,
  entry_id       uuid,
  counterparty_id uuid,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists audit_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_entity_idx on public.audit_logs (entity, entity_id);

-- إعدادات المستخدم
create table if not exists public.settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  currency   text not null default 'YER',
  theme      text not null default 'system',
  numerals   text not null default 'latin',
  locale     text not null default 'ar',
  updated_at timestamptz not null default now()
);

-- ============================ 6) عروض التوافق ============================
-- تسميات مطلوبة (shops/customers/debts/payments) فوق نفس البيانات بلا تكرار.

create or replace view public.shops with (security_invoker = true) as
  select id, owner_id, name, phone, address, note, linked_user_id, relationship_id,
         link_status, created_at, updated_at, archived_at
  from public.parties where kind = 'shop';

create or replace view public.customers with (security_invoker = true) as
  select id, owner_id, name, phone, address, note, linked_user_id, relationship_id,
         link_status, created_at, updated_at, archived_at
  from public.parties where kind = 'customer';

create or replace view public.debts with (security_invoker = true) as
  select id, scope, entry_kind, status, amount_minor, currency, details, note, occurred_at,
         creator_id, owner_id, party_id, relationship_id, merchant_user_id, customer_user_id,
         confirmed_by, confirmed_at, reverses_entry_id, reversed_by_entry_id, client_ref, created_at
  from public.financial_entries where entry_type = 'debt';

create or replace view public.payments with (security_invoker = true) as
  select id, scope, entry_kind, status, amount_minor, currency, details, note, occurred_at,
         creator_id, owner_id, party_id, relationship_id, merchant_user_id, customer_user_id,
         confirmed_by, confirmed_at, reverses_entry_id, reversed_by_entry_id, client_ref, created_at
  from public.financial_entries where entry_type = 'payment';

-- ============================ 7) دوال مساعدة ============================

-- أثر القيد على الرصيد: دين = موجب، سداد = سالب، والقيد العكسي بعكس إشارته.
create or replace function public.entry_effect(
  p_entry_type text, p_entry_kind text, p_amount bigint
) returns bigint language sql immutable as $$
  select case
    when p_entry_kind = 'reversal' then (case when p_entry_type = 'debt' then -p_amount else p_amount end)
    else (case when p_entry_type = 'debt' then p_amount else -p_amount end)
  end;
$$;

-- رصيد طرف في دفتر مستقل (المؤكد فقط، وبلا القيود المستثناة أو المعكوسة)
create or replace function public.solo_remaining(p_owner uuid, p_party uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(entry_effect(entry_type, entry_kind, amount_minor)), 0)::bigint
  from public.financial_entries
  where scope = 'solo'
    and owner_id = p_owner
    and party_id = p_party
    and status = 'confirmed'
    and excluded_from_balance = false
    and reversed_by_entry_id is null;
$$;

-- رصيد العلاقة المشتركة (ما على العميل للتاجر — المؤكد فقط)
create or replace function public.relationship_remaining(p_relationship uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(entry_effect(entry_type, entry_kind, amount_minor)), 0)::bigint
  from public.financial_entries
  where scope = 'shared'
    and relationship_id = p_relationship
    and status = 'confirmed'
    and excluded_from_balance = false
    and reversed_by_entry_id is null;
$$;

-- إشعار داخلي
create or replace function public.notify_user(
  p_user uuid, p_kind text, p_title text, p_body text default null,
  p_ref_type text default null, p_ref_id uuid default null
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, title, body, ref_type, ref_id)
  values (p_user, p_kind, p_title, p_body, p_ref_type, p_ref_id);
$$;

-- سجل التدقيق
create or replace function public.audit(
  p_action text, p_entity text, p_entity_id uuid, p_entry uuid default null,
  p_counterparty uuid default null, p_detail jsonb default null
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, entry_id, counterparty_id, detail)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_entry, p_counterparty, p_detail);
$$;

-- الطرف الآخر في قيد مشترك
create or replace function public.entry_counterparty(p_entry public.financial_entries, p_me uuid)
returns uuid language sql immutable as $$
  select case when p_entry.merchant_user_id = p_me then p_entry.customer_user_id else p_entry.merchant_user_id end;
$$;

-- استثناء السجلات المستقلة السابقة لهذه العلاقة من الرصيد الموثّق
create or replace function public.exclude_legacy_entries(p_relationship uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rel public.relationships;
begin
  select * into v_rel from public.relationships where id = p_relationship;
  if v_rel.id is null then return; end if;

  update public.financial_entries e
     set excluded_from_balance = true,
         excluded_reason = p_reason,
         updated_at = now()
   where e.scope = 'solo'
     and e.status = 'confirmed'
     and e.excluded_from_balance = false
     and e.owner_id = v_rel.merchant_user_id
     and e.party_id = v_rel.merchant_party_id;

  update public.financial_entries e
     set excluded_from_balance = true,
         excluded_reason = p_reason,
         updated_at = now()
   where e.scope = 'solo'
     and e.status = 'confirmed'
     and e.excluded_from_balance = false
     and e.owner_id = v_rel.customer_user_id
     and e.party_id = v_rel.customer_party_id;
end;
$$;

-- تطابق اسم (مفتاح بحث مبسّط: إزالة التشكيل والألف والهمزات والتاء المربوطة)
create or replace function public.name_key(p_name text) returns text
language sql immutable as $$
  select lower(trim(regexp_replace(
    translate(coalesce(p_name, ''), 'أإآٱىة', 'اااايه'),
    '[ًٌٍَُِّْـ[:space:]]+', '', 'g')));
$$;

-- مفتاح البحث يُحسب دائمًا في قاعدة البيانات ليتطابق الطرفان على نفس القاعدة
create or replace function public.parties_set_search_key() returns trigger
language plpgsql as $$
begin
  new.search_key := public.name_key(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists parties_search_key on public.parties;
create trigger parties_search_key
  before insert or update of name on public.parties
  for each row execute function public.parties_set_search_key();

-- ============================ 8) تسجيل مستخدم جديد ============================
-- ملف شخصي تلقائي (يُنشأ عند أول تسجيل، والدور يُحدّث عند إتمام الإعداد)

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, role, full_name, currency)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'merchant' then 'merchant' else 'customer' end,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'مستخدم'),
    'YER'
  )
  on conflict (id) do nothing;

  insert into public.settings (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.notifications (user_id, kind, title, body)
  values (new.id, 'sync', 'مرحبًا بك في دفتر الديون', 'ابدأ بإضافة عميل أو محل ثم سجّل أول دين.');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================ 9) الكتابة المالية ============================

-- إنشاء قيد (دين/سداد). المستقل يُعتمد فورًا، والمشترك ينتظر تأكيد الطرف الآخر.
create or replace function public.create_entry(
  p_party_id     uuid,
  p_entry_type   text,
  p_amount_minor bigint,
  p_currency     text default 'YER',
  p_details      text default null,
  p_note         text default null,
  p_occurred_at  timestamptz default null,
  p_client_ref   text default null,
  p_device_ref   text default null,
  p_session_ref  text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles;
  v_party    public.parties;
  v_rel      public.relationships;
  v_existing public.financial_entries;
  v_entry    public.financial_entries;
  v_scope    text := 'solo';
  v_status   text := 'confirmed';
  v_ref      text := coalesce(nullif(trim(p_client_ref), ''), gen_random_uuid()::text);
  v_other    uuid;
  v_remaining bigint;
  v_label    text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_entry_type not in ('debt', 'payment') then raise exception 'validation'; end if;
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'invalid_amount'; end if;

  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'profile_missing'; end if;

  -- منع الإرسال المزدوج: نفس المرجع من نفس المستخدم يعيد نفس القيد
  select * into v_existing from public.financial_entries
   where creator_id = v_uid and client_ref = v_ref;
  if v_existing.id is not null then return to_jsonb(v_existing); end if;

  select * into v_party from public.parties where id = p_party_id and owner_id = v_uid;
  if v_party.id is null then raise exception 'not_found'; end if;

  if v_party.relationship_id is not null and v_party.link_status = 'verified' then
    select * into v_rel from public.relationships
     where id = v_party.relationship_id and status = 'verified'
       and (merchant_user_id = v_uid or customer_user_id = v_uid);
    if v_rel.id is null then raise exception 'not_found'; end if;
    v_scope := 'shared';
    v_status := 'pending';
  end if;

  -- منع السداد الأكبر من الرصيد المؤكد (في القيد المستقل والمشترك)
  if p_entry_type = 'payment' then
    if v_scope = 'solo' then
      v_remaining := public.solo_remaining(v_uid, p_party_id);
    else
      v_remaining := public.relationship_remaining(v_rel.id);
    end if;
    if p_amount_minor > greatest(v_remaining, 0) then raise exception 'over_payment'; end if;
  end if;

  insert into public.financial_entries (
    scope, entry_type, entry_kind, status, amount_minor, currency, details, note,
    occurred_at, creator_id, creator_role, creator_name,
    owner_id, party_id, relationship_id, merchant_user_id, customer_user_id,
    merchant_party_id, customer_party_id,
    confirmed_by, confirmed_by_name, confirmed_at, device_ref, session_ref,
    client_ref
  ) values (
    v_scope, p_entry_type, 'normal', v_status, p_amount_minor, coalesce(p_currency, 'YER'),
    nullif(trim(coalesce(p_details, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    coalesce(p_occurred_at, now()), v_uid, v_profile.role, v_profile.full_name,
    case when v_scope = 'solo' then v_uid else null end,
    case when v_scope = 'solo' then p_party_id else null end,
    case when v_scope = 'shared' then v_rel.id else null end,
    case when v_scope = 'shared' then v_rel.merchant_user_id else null end,
    case when v_scope = 'shared' then v_rel.customer_user_id else null end,
    case when v_scope = 'shared' then v_rel.merchant_party_id else null end,
    case when v_scope = 'shared' then v_rel.customer_party_id else null end,
    case when v_scope = 'solo' then v_uid else null end,
    case when v_scope = 'solo' then v_profile.full_name else null end,
    case when v_scope = 'solo' then now() else null end,
    p_device_ref, p_session_ref, v_ref
  ) returning * into v_entry;

  v_label := case when p_entry_type = 'debt' then 'دين' else 'سداد' end;

  if v_scope = 'shared' then
    v_other := public.entry_counterparty(v_entry, v_uid);
    perform public.notify_user(
      v_other, 'entry_created',
      format('%s سجّل %s بقيمة %s', v_profile.full_name, v_label, to_char(p_amount_minor / 100.0, 'FM999G999G999G990D00')),
      coalesce(v_entry.details, 'بانتظار تأكيدك'),
      'entry', v_entry.id);
  end if;

  perform public.audit('create', 'financial_entries', v_entry.id, v_entry.id, v_other,
                       jsonb_build_object('scope', v_scope, 'type', p_entry_type, 'amount', p_amount_minor));

  return to_jsonb(v_entry);
end;
$$;

-- تأكيد قيد مشترك — لا يؤكّد المنشئ عمليته أبدًا
create or replace function public.confirm_entry(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_entry public.financial_entries;
  v_other uuid;
  v_remaining bigint;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;

  select * into v_entry from public.financial_entries where id = p_entry_id for update;
  if v_entry.id is null then raise exception 'not_found'; end if;
  if v_entry.scope <> 'shared' then raise exception 'not_shared'; end if;
  if v_entry.merchant_user_id <> v_uid and v_entry.customer_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_entry.creator_id = v_uid then raise exception 'self_confirm'; end if;
  if v_entry.status <> 'pending' then raise exception 'already_decided'; end if;

  -- إعادة التحقق من قاعدة المبلغ عند التأكيد (قد يتغير الرصيد قبل الموافقة)
  if v_entry.entry_type = 'payment' and v_entry.entry_kind <> 'reversal' then
    v_remaining := public.relationship_remaining(v_entry.relationship_id);
    if v_entry.amount_minor > greatest(v_remaining, 0) then raise exception 'over_payment'; end if;
  end if;

  update public.financial_entries
     set status = 'confirmed', confirmed_by = v_uid, confirmed_by_name = v_profile.full_name,
         confirmed_at = now(), updated_at = now()
   where id = p_entry_id returning * into v_entry;

  -- إن كان القيد عكسيًا: يُعلَّم الأصل كمعكوس
  if v_entry.reverses_entry_id is not null then
    update public.financial_entries
       set reversed_by_entry_id = v_entry.id, updated_at = now()
     where id = v_entry.reverses_entry_id;
  end if;

  v_other := public.entry_counterparty(v_entry, v_uid);
  perform public.notify_user(v_other, 'entry_confirmed', 'تم تأكيد العملية',
    format('%s أكّد %s بقيمة %s', v_profile.full_name,
      case when v_entry.entry_type = 'debt' then 'دينًا' else 'سدادًا' end,
      to_char(v_entry.amount_minor / 100.0, 'FM999G999G999G990D00')), 'entry', v_entry.id);
  perform public.audit('confirm', 'financial_entries', v_entry.id, v_entry.id, v_other, null);

  return to_jsonb(v_entry);
end;
$$;

create or replace function public.reject_entry(p_entry_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_entry public.financial_entries;
  v_other uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;

  select * into v_entry from public.financial_entries where id = p_entry_id for update;
  if v_entry.id is null then raise exception 'not_found'; end if;
  if v_entry.scope <> 'shared' then raise exception 'not_shared'; end if;
  if v_entry.merchant_user_id <> v_uid and v_entry.customer_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_entry.creator_id = v_uid then raise exception 'self_decide'; end if;
  if v_entry.status <> 'pending' then raise exception 'already_decided'; end if;

  update public.financial_entries
     set status = 'rejected', reason = nullif(trim(coalesce(p_reason, '')), ''),
         rejected_by = v_uid, rejected_by_name = v_profile.full_name,
         rejected_at = now(), updated_at = now()
   where id = p_entry_id returning * into v_entry;

  v_other := v_entry.creator_id;
  perform public.notify_user(v_other, 'entry_rejected', 'تم رفض العملية',
    coalesce(v_entry.reason, 'راجع التفاصيل مع الطرف الآخر'), 'entry', v_entry.id);
  perform public.audit('reject', 'financial_entries', v_entry.id, v_entry.id, v_other,
                       jsonb_build_object('reason', v_entry.reason));

  return to_jsonb(v_entry);
end;
$$;

-- الإلغاء للمنشئ فقط وقبل التأكيد
create or replace function public.cancel_entry(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_entry public.financial_entries;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select * into v_entry from public.financial_entries where id = p_entry_id for update;
  if v_entry.id is null then raise exception 'not_found'; end if;
  if v_entry.creator_id <> v_uid then raise exception 'forbidden'; end if;
  if v_entry.scope = 'shared' and v_entry.status <> 'pending' then raise exception 'already_decided'; end if;
  if v_entry.scope = 'solo' then raise exception 'solo_not_cancellable'; end if;

  update public.financial_entries
     set status = 'cancelled', cancelled_at = now(), updated_at = now()
   where id = p_entry_id returning * into v_entry;

  perform public.notify_user(public.entry_counterparty(v_entry, v_uid), 'entry_cancelled',
    'تم إلغاء العملية من منشئها', null, 'entry', v_entry.id);
  perform public.audit('cancel', 'financial_entries', v_entry.id, v_entry.id, null, null);

  return to_jsonb(v_entry);
end;
$$;

-- العكس: تصحيح بدون تعديل صامت — ينشئ قيدًا جديدًا مرتبطًا بالأصل
create or replace function public.reverse_entry(p_entry_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_entry public.financial_entries;
  v_new public.financial_entries;
  v_pending public.financial_entries;
  v_other uuid;
  v_status text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;

  select * into v_entry from public.financial_entries where id = p_entry_id for update;
  if v_entry.id is null then raise exception 'not_found'; end if;
  if v_entry.status <> 'confirmed' then raise exception 'not_confirmed'; end if;
  if v_entry.entry_kind = 'reversal' then raise exception 'cannot_reverse_reversal'; end if;

  if v_entry.scope = 'solo' then
    if v_entry.owner_id <> v_uid then raise exception 'forbidden'; end if;
    v_status := 'confirmed';
  else
    if v_entry.merchant_user_id <> v_uid and v_entry.customer_user_id <> v_uid then raise exception 'forbidden'; end if;
    if v_entry.reversed_by_entry_id is not null then raise exception 'already_reversed'; end if;
    v_status := 'pending';
  end if;

  select * into v_pending from public.financial_entries
   where reverses_entry_id = v_entry.id and status in ('pending', 'confirmed');
  if v_pending.id is not null then raise exception 'conflict'; end if;

  insert into public.financial_entries (
    scope, entry_type, entry_kind, status, amount_minor, currency, details, note,
    occurred_at, creator_id, creator_role, creator_name,
    owner_id, party_id, relationship_id, merchant_user_id, customer_user_id,
    merchant_party_id, customer_party_id,
    confirmed_by, confirmed_by_name, confirmed_at,
    reverses_entry_id, client_ref
  ) values (
    v_entry.scope, v_entry.entry_type, 'reversal', v_status, v_entry.amount_minor, v_entry.currency,
    concat('عكس عملية: ', coalesce(v_entry.details, case when v_entry.entry_type = 'debt' then 'دين' else 'سداد' end)),
    nullif(trim(coalesce(p_note, '')), ''),
    now(), v_uid, v_profile.role, v_profile.full_name,
    v_entry.owner_id, v_entry.party_id, v_entry.relationship_id,
    v_entry.merchant_user_id, v_entry.customer_user_id,
    v_entry.merchant_party_id, v_entry.customer_party_id,
    case when v_status = 'confirmed' then v_uid else null end,
    case when v_status = 'confirmed' then v_profile.full_name else null end,
    case when v_status = 'confirmed' then now() else null end,
    v_entry.id, concat('reversal:', v_entry.id, ':', v_uid)
  ) returning * into v_new;

  if v_status = 'confirmed' then
    update public.financial_entries set reversed_by_entry_id = v_new.id, updated_at = now()
     where id = v_entry.id;
  else
    v_other := public.entry_counterparty(v_new, v_uid);
    perform public.notify_user(v_other, 'entry_reversal', 'طلب عكس عملية',
      'قيد عكسي بانتظار موافقتك', 'entry', v_new.id);
  end if;

  perform public.audit('reverse', 'financial_entries', v_new.id, v_entry.id, v_other,
                       jsonb_build_object('reversal_id', v_new.id));

  return to_jsonb(v_new);
end;
$$;

-- ============================ 10) الربط بين الطرفين ============================

create or replace function public.create_link_invite() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_token text;
  v_row public.link_requests;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'profile_missing'; end if;

  -- إلغاء الرموز السابقة غير المستخدمة (رمز واحد فعّال لكل تاجر)
  update public.link_requests
     set status = 'cancelled', updated_at = now()
   where merchant_user_id = v_uid and status = 'awaiting_scan';

  -- رمز عشوائي 24 بايت، صالح 10 دقائق، يُستخدم مرة واحدة
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');

  insert into public.link_requests (merchant_user_id, merchant_name, token, expires_at)
  values (v_uid, v_profile.full_name, v_token, now() + interval '10 minutes')
  returning * into v_row;

  perform public.audit('create', 'link_requests', v_row.id, null, null, null);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.cancel_link_invite(p_request_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  update public.link_requests
     set status = 'cancelled', updated_at = now()
   where id = p_request_id and merchant_user_id = v_uid and status in ('awaiting_scan', 'pending');
  if not found then raise exception 'not_found'; end if;
end;
$$;

-- معاينة الرمز قبل الموافقة: اسم التاجر فقط + رصيد سابق مسجّل (لا بيانات مالية تفصيلية)
create or replace function public.preview_link_token(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_req public.link_requests;
  v_party public.parties;
  v_previous bigint := 0;
  v_linked boolean := false;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'profile_missing'; end if;

  select * into v_req from public.link_requests where token = p_token;
  if v_req.id is null then raise exception 'link_invalid'; end if;
  if v_req.merchant_user_id = v_uid then raise exception 'self_link'; end if;
  if v_req.status not in ('awaiting_scan', 'pending') then raise exception 'link_used'; end if;
  if v_req.expires_at <= now() then raise exception 'link_expired'; end if;

  -- رصيد سابق مسجّل عند التاجر بنفس اسم العميل (لا يُدمج تلقائيًا)
  select * into v_party from public.parties
   where owner_id = v_req.merchant_user_id
     and kind = 'customer'
     and archived_at is null
     and search_key = public.name_key(v_profile.full_name)
   limit 1;
  if v_party.id is not null then
    v_previous := greatest(public.solo_remaining(v_party.owner_id, v_party.id), 0);
  end if;

  select exists (
    select 1 from public.relationships
     where merchant_user_id = v_req.merchant_user_id and customer_user_id = v_uid and status = 'verified'
  ) into v_linked;

  return jsonb_build_object(
    'merchant_user_id', v_req.merchant_user_id,
    'merchant_name', v_req.merchant_name,
    'expires_at', v_req.expires_at,
    'previous_balance_minor', v_previous,
    'already_linked', v_linked
  );
end;
$$;

-- موافقة العميل (الطرف الأول) — يبقى الطلب معلّقًا حتى موافقة التاجر
create or replace function public.claim_link_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_req public.link_requests;
  v_party public.parties;
  v_previous bigint := 0;
  v_linked boolean := false;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'profile_missing'; end if;

  select * into v_req from public.link_requests where token = p_token for update;
  if v_req.id is null then raise exception 'link_invalid'; end if;
  if v_req.merchant_user_id = v_uid then raise exception 'self_link'; end if;
  if v_req.status not in ('awaiting_scan', 'pending') then raise exception 'link_used'; end if;
  if v_req.expires_at <= now() then raise exception 'link_expired'; end if;

  select exists (
    select 1 from public.relationships
     where merchant_user_id = v_req.merchant_user_id and customer_user_id = v_uid and status = 'verified'
  ) into v_linked;
  if v_linked then raise exception 'already_linked'; end if;

  -- رصيد سابق مسجّل عند التاجر بنفس اسم العميل (لا يُدمج تلقائيًا)
  select * into v_party from public.parties
   where owner_id = v_req.merchant_user_id and kind = 'customer' and archived_at is null
     and search_key = public.name_key(v_profile.full_name)
   limit 1;
  if v_party.id is not null then
    v_previous := greatest(public.solo_remaining(v_party.owner_id, v_party.id), 0);
  end if;

  update public.link_requests
     set customer_user_id = v_uid, customer_name = v_profile.full_name,
         status = 'pending', used_at = now(), updated_at = now(),
         previous_balance_minor = v_previous
   where id = v_req.id returning * into v_req;

  perform public.notify_user(v_req.merchant_user_id, 'link_request',
    format('%s وافق على الربط — بانتظار موافقتك', v_profile.full_name), null, 'link', v_req.id);
  perform public.audit('claim', 'link_requests', v_req.id, null, v_req.merchant_user_id, null);

  return to_jsonb(v_req);
end;
$$;

-- موافقة التاجر (الطرف الثاني) — الربط يتطلب الطرفين، ويُنشأ الرصيد السابق كمقترح لا كدمج
create or replace function public.accept_link_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_customer public.profiles;
  v_req public.link_requests;
  v_rel public.relationships;
  v_merchant_party public.parties;
  v_customer_party public.parties;
  v_legacy bigint := 0;
  v_key text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.id is null then raise exception 'profile_missing'; end if;

  select * into v_req from public.link_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'not_found'; end if;
  if v_req.merchant_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_req.status <> 'pending' or v_req.customer_user_id is null then raise exception 'conflict'; end if;
  if v_req.expires_at <= now() then raise exception 'link_expired'; end if;

  select * into v_customer from public.profiles where id = v_req.customer_user_id;

  -- طرف التاجر (سجل العميل في دفتره)
  v_key := public.name_key(coalesce(v_customer.full_name, v_req.customer_name, ''));
  select * into v_merchant_party from public.parties
   where owner_id = v_uid and kind = 'customer' and archived_at is null
     and search_key = v_key and link_status <> 'verified'
   limit 1;

  if v_merchant_party.id is null then
    insert into public.parties (owner_id, kind, name, search_key, linked_user_id, linked_profile_name, link_status)
    values (v_uid, 'customer', coalesce(v_customer.full_name, v_req.customer_name, 'عميل'),
            v_key, v_req.customer_user_id, v_customer.full_name, 'pending')
    returning * into v_merchant_party;
  end if;

  -- طرف العميل (سجل المحل في دفتره)
  select * into v_customer_party from public.parties
   where owner_id = v_req.customer_user_id and kind = 'shop' and archived_at is null
     and search_key = public.name_key(v_profile.full_name) and link_status <> 'verified'
   limit 1;

  if v_customer_party.id is null then
    insert into public.parties (owner_id, kind, name, search_key, linked_user_id, linked_profile_name, link_status)
    values (v_req.customer_user_id, 'shop', v_profile.full_name, public.name_key(v_profile.full_name),
            v_uid, v_profile.full_name, 'pending')
    returning * into v_customer_party;
  end if;

  insert into public.relationships (
    merchant_user_id, customer_user_id, merchant_party_id, customer_party_id,
    merchant_name, customer_name, status
  ) values (
    v_uid, v_req.customer_user_id, v_merchant_party.id, v_customer_party.id,
    v_profile.full_name, v_customer.full_name, 'verified'
  ) returning * into v_rel;

  update public.parties
     set relationship_id = v_rel.id, link_status = 'verified',
         linked_user_id = case when owner_id = v_uid then v_req.customer_user_id else v_uid end,
         linked_profile_name = case when owner_id = v_uid then v_customer.full_name else v_profile.full_name end,
         updated_at = now()
   where id in (v_merchant_party.id, v_customer_party.id);

  -- الرصيد السابق: يُحسب ثم يُستثنى من الرصيد الموثّق ويُعرض كمقترح للاعتماد
  v_legacy := greatest(public.solo_remaining(v_uid, v_merchant_party.id), 0);
  perform public.exclude_legacy_entries(v_rel.id, 'legacy_unverified');

  if v_legacy > 0 then
    insert into public.balance_proposals (relationship_id, proposed_by, amount_minor, note)
    values (v_rel.id, v_uid, v_legacy, 'رصيد سابق مسجّل في دفتر التاجر قبل الربط');

    update public.relationships
       set opening_balance_status = 'proposed', opening_balance_minor = v_legacy, updated_at = now()
     where id = v_rel.id returning * into v_rel;
  end if;

  update public.link_requests set status = 'accepted', updated_at = now() where id = v_req.id;

  perform public.notify_user(v_req.customer_user_id, 'link_established',
    format('تم الربط مع %s', v_profile.full_name),
    'أي عملية يسجّلها أحدكما تظهر للطرف الآخر وتحتاج تأكيده', 'relationship', v_rel.id);
  perform public.audit('accept', 'link_requests', v_req.id, null, v_req.customer_user_id,
                       jsonb_build_object('relationship_id', v_rel.id));

  return to_jsonb(v_rel);
end;
$$;

create or replace function public.reject_link_request(p_request_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_req public.link_requests;
begin
  select * into v_req from public.link_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'not_found'; end if;
  if v_req.merchant_user_id <> v_uid and v_req.customer_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_req.status not in ('awaiting_scan', 'pending') then raise exception 'already_decided'; end if;

  update public.link_requests
     set status = 'rejected', rejection_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_request_id;

  if v_req.merchant_user_id = v_uid and v_req.customer_user_id is not null then
    perform public.notify_user(v_req.customer_user_id, 'link_rejected', 'تم رفض طلب الربط', null, 'link', v_req.id);
  elsif v_req.customer_user_id = v_uid then
    perform public.notify_user(v_req.merchant_user_id, 'link_rejected', 'تم رفض طلب الربط', null, 'link', v_req.id);
  end if;
end;
$$;

create or replace function public.end_relationship(p_relationship_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_rel public.relationships;
begin
  select * into v_rel from public.relationships where id = p_relationship_id for update;
  if v_rel.id is null then raise exception 'not_found'; end if;
  if v_rel.merchant_user_id <> v_uid and v_rel.customer_user_id <> v_uid then raise exception 'forbidden'; end if;

  update public.relationships set status = 'ended', ended_at = now(), updated_at = now()
   where id = p_relationship_id;

  update public.parties set link_status = 'none', updated_at = now()
   where id in (v_rel.merchant_party_id, v_rel.customer_party_id);

  perform public.notify_user(
    case when v_rel.merchant_user_id = v_uid then v_rel.customer_user_id else v_rel.merchant_user_id end,
    'link_rejected', 'تم إلغاء الربط', 'السجل المالي السابق محفوظ كما هو', 'relationship', v_rel.id);
  perform public.audit('end', 'relationships', v_rel.id, null, null, null);
end;
$$;

-- اعتماد الرصيد السابق: اقتراح ثم موافقة صريحة من الطرف الآخر (لا دمج تلقائي)
create or replace function public.propose_opening_balance(
  p_relationship_id uuid, p_amount_minor bigint, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_rel public.relationships;
  v_row public.balance_proposals;
begin
  if p_amount_minor is null or p_amount_minor <= 0 then raise exception 'invalid_amount'; end if;

  select * into v_rel from public.relationships where id = p_relationship_id;
  if v_rel.id is null then raise exception 'not_found'; end if;
  if v_rel.merchant_user_id <> v_uid and v_rel.customer_user_id <> v_uid then raise exception 'forbidden'; end if;

  insert into public.balance_proposals (relationship_id, proposed_by, amount_minor, note)
  values (p_relationship_id, v_uid, p_amount_minor, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v_row;

  update public.relationships
     set opening_balance_status = 'proposed', opening_balance_minor = p_amount_minor, updated_at = now()
   where id = p_relationship_id;

  perform public.notify_user(
    case when v_rel.merchant_user_id = v_uid then v_rel.customer_user_id else v_rel.merchant_user_id end,
    'balance_proposal',
    format('اقتراح اعتماد رصيد سابق بقيمة %s', to_char(p_amount_minor / 100.0, 'FM999G999G999G990D00')),
    'لا يُدمج تلقائيًا — يحتاج موافقتك', 'relationship', p_relationship_id);

  return to_jsonb(v_row);
end;
$$;

create or replace function public.respond_opening_balance(p_proposal_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_row public.balance_proposals;
  v_rel public.relationships;
  v_other uuid;
begin
  select * into v_profile from public.profiles where id = v_uid;

  select * into v_row from public.balance_proposals where id = p_proposal_id for update;
  if v_row.id is null then raise exception 'not_found'; end if;
  if v_row.status <> 'pending' then raise exception 'already_decided'; end if;
  if v_row.proposed_by = v_uid then raise exception 'self_confirm'; end if;

  select * into v_rel from public.relationships where id = v_row.relationship_id;
  if v_rel.id is null then raise exception 'not_found'; end if;
  if v_rel.merchant_user_id <> v_uid and v_rel.customer_user_id <> v_uid then raise exception 'forbidden'; end if;

  update public.balance_proposals
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_by = v_uid, responded_at = now()
   where id = p_proposal_id returning * into v_row;

  perform public.exclude_legacy_entries(v_rel.id,
    case when p_accept then 'superseded_by_opening' else 'legacy_unverified' end);

  if p_accept then
    insert into public.financial_entries (
      scope, entry_type, entry_kind, status, amount_minor, currency, details, note,
      occurred_at, creator_id, creator_role, creator_name,
      relationship_id, merchant_user_id, customer_user_id, merchant_party_id, customer_party_id,
      confirmed_by, confirmed_by_name, confirmed_at, client_ref
    ) values (
      'shared', 'debt', 'opening', 'confirmed', v_row.amount_minor, 'YER',
      'اعتماد رصيد سابق بالاتفاق', v_row.note, now(),
      v_uid, v_profile.role, v_profile.full_name,
      v_rel.id, v_rel.merchant_user_id, v_rel.customer_user_id, v_rel.merchant_party_id, v_rel.customer_party_id,
      v_uid, v_profile.full_name, now(), concat('opening-shared:', v_rel.id)
    );
  end if;

  update public.relationships
     set opening_balance_status = case when p_accept then 'accepted' else 'declined' end,
         updated_at = now()
   where id = v_rel.id;

  v_other := v_row.proposed_by;
  perform public.notify_user(v_other,
    case when p_accept then 'balance_accepted' else 'balance_declined' end,
    case when p_accept then 'تم اعتماد الرصيد السابق' else 'تم رفض اعتماد الرصيد السابق' end,
    null, 'relationship', v_rel.id);
  perform public.audit('respond', 'balance_proposals', p_proposal_id, null, v_other,
                       jsonb_build_object('accepted', p_accept));

  return to_jsonb(v_row);
end;
$$;

-- ============================ 11) حماية الجداول (RLS) ============================

alter table public.profiles          enable row level security;
alter table public.parties           enable row level security;
alter table public.relationships     enable row level security;
alter table public.link_requests     enable row level security;
alter table public.balance_proposals enable row level security;
alter table public.financial_entries enable row level security;
alter table public.notifications     enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.settings          enable row level security;

-- الملف الشخصي: قراءة وتعديل ملفي فقط
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- الأطراف: صاحب الدفتر فقط (قراءة/كتابة سجلاته)
drop policy if exists parties_owner_all on public.parties;
create policy parties_owner_all on public.parties for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- العلاقات: طرفا العلاقة فقط
drop policy if exists relationships_member_select on public.relationships;
create policy relationships_member_select on public.relationships for select
  using (merchant_user_id = auth.uid() or customer_user_id = auth.uid());
-- لا سياسة كتابة: الإنشاء والتعديل عبر دوال SECURITY DEFINER فقط

-- طلبات الربط: التاجر صاحب الرمز أو العميل الذي ربطه فقط
drop policy if exists link_requests_member_select on public.link_requests;
create policy link_requests_member_select on public.link_requests for select
  using (merchant_user_id = auth.uid() or customer_user_id = auth.uid());

-- اعتماد الرصيد: طرفا العلاقة فقط
drop policy if exists balance_proposals_member_select on public.balance_proposals;
create policy balance_proposals_member_select on public.balance_proposals for select
  using (exists (
    select 1 from public.relationships r
     where r.id = relationship_id
       and (r.merchant_user_id = auth.uid() or r.customer_user_id = auth.uid())
  ));

-- القيود المالية: من أنشأها أو طرفا العلاقة المشتركة أو صاحب الدفتر المستقل
drop policy if exists entries_visible_select on public.financial_entries;
create policy entries_visible_select on public.financial_entries for select
  using (
    creator_id = auth.uid()
    or owner_id = auth.uid()
    or merchant_user_id = auth.uid()
    or customer_user_id = auth.uid()
  );
-- لا سياسة insert/update/delete: كل الكتابة المالية عبر الدوال المؤمّنة فقط،
-- وهذا يمنع تأكيد عملية نيابة عن الطرف الآخر أو التلاعب بالمبلغ أو الحالة.

-- الإشعارات: صاحبها فقط، ويمكنه تعليمها مقروءة
drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications for select using (user_id = auth.uid());

drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications for delete using (user_id = auth.uid());

-- سجل التدقيق: للقراءة فقط لمن كان طرفًا أو فاعلًا
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select
  using (actor_id = auth.uid() or counterparty_id = auth.uid());

-- الإعدادات: لي فقط
drop policy if exists settings_own on public.settings;
create policy settings_own on public.settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================ 12) الصلاحيات ============================
-- لا كتابة مباشرة على الجدول المالي أو جداول الربط من العميل.

revoke all on public.financial_entries from anon, authenticated;
grant select on public.financial_entries to authenticated;

revoke all on public.relationships from anon, authenticated;
grant select on public.relationships to authenticated;

revoke all on public.link_requests from anon, authenticated;
grant select on public.link_requests to authenticated;

revoke all on public.balance_proposals from anon, authenticated;
grant select on public.balance_proposals to authenticated;

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

grant select, insert, update on public.parties to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update, delete on public.notifications to authenticated;
grant select, insert, update on public.settings to authenticated;

grant execute on function public.create_entry(uuid, text, bigint, text, text, text, timestamptz, text, text, text) to authenticated;
grant execute on function public.confirm_entry(uuid) to authenticated;
grant execute on function public.reject_entry(uuid, text) to authenticated;
grant execute on function public.cancel_entry(uuid) to authenticated;
grant execute on function public.reverse_entry(uuid, text) to authenticated;
grant execute on function public.create_link_invite() to authenticated;
grant execute on function public.cancel_link_invite(uuid) to authenticated;
grant execute on function public.preview_link_token(text) to authenticated;
grant execute on function public.claim_link_invite(text) to authenticated;
grant execute on function public.accept_link_request(uuid) to authenticated;
grant execute on function public.reject_link_request(uuid, text) to authenticated;
grant execute on function public.end_relationship(uuid) to authenticated;
grant execute on function public.propose_opening_balance(uuid, bigint, text) to authenticated;
grant execute on function public.respond_opening_balance(uuid, boolean) to authenticated;

-- ============================ 13) Realtime ============================
-- المزامنة اللحظية للديون والسدادات والطلبات والحالات والعلاقات والإشعارات

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.financial_entries'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.parties'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.relationships'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.link_requests'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.balance_proposals'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.notifications'; exception when duplicate_object then null; end;
end $$;
