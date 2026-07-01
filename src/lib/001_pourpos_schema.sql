-- PourPOS — Online Storage Schema (Supabase)
-- Paste and run in Supabase SQL Editor.
-- This creates all tables required by the current app and migrates old KV data if present.

create extension if not exists pgcrypto;

-- ── Main Tenants Table ──────────────────────────────────────────────────────
create table if not exists public.tenants (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  business_info jsonb not null default '{}'::jsonb,
  config        jsonb not null default '{}'::jsonb,
  menu          jsonb not null default '[]'::jsonb,
  customers     jsonb not null default '[]'::jsonb,
  staff         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Bring forward older tenant schemas (if table already existed with different columns)
alter table public.tenants add column if not exists email text;
alter table public.tenants add column if not exists password_hash text;
alter table public.tenants add column if not exists business_info jsonb;
alter table public.tenants add column if not exists config jsonb;
alter table public.tenants add column if not exists menu jsonb;
alter table public.tenants add column if not exists customers jsonb;
alter table public.tenants add column if not exists staff jsonb;
alter table public.tenants add column if not exists created_at timestamptz;
alter table public.tenants add column if not exists updated_at timestamptz;

-- Backfill/default legacy rows so constraints can be safely applied.
update public.tenants
set
  email = coalesce(nullif(lower(trim(email)), ''), nullif(lower(trim(business_info->>'email')), ''), 'legacy-' || id || '@local.invalid'),
  password_hash = coalesce(nullif(password_hash, ''), encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')),
  business_info = coalesce(business_info, '{}'::jsonb),
  config = coalesce(config, '{}'::jsonb),
  menu = coalesce(menu, '[]'::jsonb),
  customers = coalesce(customers, '[]'::jsonb),
  staff = coalesce(staff, '[]'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  email is null
  or password_hash is null
  or business_info is null
  or config is null
  or menu is null
  or customers is null
  or staff is null
  or created_at is null
  or updated_at is null;

alter table public.tenants alter column email set not null;
alter table public.tenants alter column password_hash set not null;
alter table public.tenants alter column business_info set default '{}'::jsonb;
alter table public.tenants alter column business_info set not null;
alter table public.tenants alter column config set default '{}'::jsonb;
alter table public.tenants alter column config set not null;
alter table public.tenants alter column menu set default '[]'::jsonb;
alter table public.tenants alter column menu set not null;
alter table public.tenants alter column customers set default '[]'::jsonb;
alter table public.tenants alter column customers set not null;
alter table public.tenants alter column staff set default '[]'::jsonb;
alter table public.tenants alter column staff set not null;
alter table public.tenants alter column created_at set default now();
alter table public.tenants alter column created_at set not null;
alter table public.tenants alter column updated_at set default now();
alter table public.tenants alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and contype = 'u'
      and conname = 'tenants_email_key'
  ) then
    alter table public.tenants add constraint tenants_email_key unique (email);
  end if;
end;
$$;

create index if not exists idx_tenants_email on public.tenants(email);

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row
execute function public.touch_updated_at();

-- ── Sales Table ──────────────────────────────────────────────────────────────
create table if not exists public.sales (
  id           uuid primary key default gen_random_uuid(),
  tenant_email text not null references public.tenants(email) on delete cascade,
  sale         jsonb not null,
  saved_at     timestamptz not null default now()
);

-- Bring forward older sales schemas (if table already existed with different columns)
alter table public.sales add column if not exists tenant_email text;
alter table public.sales add column if not exists sale jsonb;
alter table public.sales add column if not exists saved_at timestamptz;

update public.sales
set
  sale = coalesce(sale, '{}'::jsonb),
  saved_at = coalesce(saved_at, now())
where sale is null or saved_at is null;

alter table public.sales alter column sale set not null;
alter table public.sales alter column saved_at set default now();
alter table public.sales alter column saved_at set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales'
      and column_name = 'tenant_id'
  ) then
    update public.sales s
    set tenant_email = t.email
    from public.tenants t
    where s.tenant_email is null
      and s.tenant_id::text = t.id::text;
  end if;
end;
$$;

alter table public.sales alter column tenant_email set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales'::regclass
      and contype = 'f'
      and conname = 'sales_tenant_email_fkey'
  ) then
    alter table public.sales
      add constraint sales_tenant_email_fkey
      foreign key (tenant_email) references public.tenants(email) on delete cascade;
  end if;
end;
$$;

create index if not exists idx_sales_tenant_email on public.sales(tenant_email);
create index if not exists idx_sales_tenant_saved_at on public.sales(tenant_email, saved_at desc);

-- ── Optional Read View for Superadmin Dashboards ────────────────────────────
create or replace view public.tenant_summaries as
select
  t.email,
  coalesce(t.business_info->>'name', '') as name,
  t.created_at as "createdAt"
from public.tenants t
order by t.created_at desc;

-- ── Migrate Old KV Storage (if table exists) ───────────────────────────────
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'kv_store_b88a7963'
  ) then
    -- Tenant records: keys like tenant:owner@company.com
    insert into public.tenants (
      id, email, password_hash, business_info, config, menu, customers, staff, created_at
    )
    select
      coalesce(
        case
          when coalesce(value->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (value->>'id')::uuid
          else null
        end,
        gen_random_uuid()
      ) as id,
      lower(trim(value->>'email')) as email,
      value->>'passwordHash' as password_hash,
      coalesce(value->'businessInfo', '{}'::jsonb) as business_info,
      coalesce(value->'config', '{}'::jsonb) as config,
      coalesce(value->'menu', '[]'::jsonb) as menu,
      coalesce(value->'customers', '[]'::jsonb) as customers,
      coalesce(value->'staff', '[]'::jsonb) as staff,
      coalesce((value->>'createdAt')::timestamptz, now()) as created_at
    from public.kv_store_b88a7963
    where key like 'tenant:%'
      and value ? 'email'
      and value ? 'passwordHash'
    on conflict (email) do nothing;

    -- Sales records: keys like sales:owner@company.com
    insert into public.sales (id, tenant_email, sale, saved_at)
    select
      coalesce(
        case
          when coalesce(item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (item->>'id')::uuid
          else null
        end,
        gen_random_uuid()
      ) as id,
      lower(trim(replace(k.key, 'sales:', ''))) as tenant_email,
      item as sale,
      coalesce((item->>'savedAt')::timestamptz, now()) as saved_at
    from public.kv_store_b88a7963 k
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(k.value) = 'array' then k.value
        else '[]'::jsonb
      end
    ) as item
    where k.key like 'sales:%'
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ── RLS (service role in Edge Function bypasses this) ───────────────────────
alter table public.tenants enable row level security;
alter table public.sales enable row level security;

drop policy if exists "deny_all_tenants" on public.tenants;
create policy "deny_all_tenants" on public.tenants
for all to public
using (false)
with check (false);

drop policy if exists "deny_all_sales" on public.sales;
create policy "deny_all_sales" on public.sales
for all to public
using (false)
with check (false);
