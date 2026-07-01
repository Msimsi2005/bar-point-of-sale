-- Emergency login hotfix for existing Supabase projects
-- Purpose: fix "column tenants.email does not exist" and restore login quickly.

create extension if not exists pgcrypto;

-- 1) Ensure required tenant columns exist
alter table if exists public.tenants add column if not exists email text;
alter table if exists public.tenants add column if not exists password_hash text;
alter table if exists public.tenants add column if not exists business_info jsonb;
alter table if exists public.tenants add column if not exists config jsonb;
alter table if exists public.tenants add column if not exists menu jsonb;
alter table if exists public.tenants add column if not exists customers jsonb;
alter table if exists public.tenants add column if not exists staff jsonb;
alter table if exists public.tenants add column if not exists created_at timestamptz;
alter table if exists public.tenants add column if not exists updated_at timestamptz;

-- 2) Backfill values needed by current edge function
update public.tenants
set
  email = coalesce(
    nullif(lower(trim(email)), ''),
    nullif(lower(trim(business_info->>'email')), ''),
    'legacy-' || id::text || '@local.invalid'
  ),
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

-- 3) Helpful indexes/uniqueness for login and tenant admin
create unique index if not exists uq_tenants_email on public.tenants(email);
create index if not exists idx_tenants_email on public.tenants(email);

-- 4) Ensure sales table can be read by current function code
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_email text,
  sale jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now()
);

alter table public.sales add column if not exists tenant_email text;
alter table public.sales add column if not exists sale jsonb;
alter table public.sales add column if not exists saved_at timestamptz;

update public.sales
set
  sale = coalesce(sale, '{}'::jsonb),
  saved_at = coalesce(saved_at, now())
where sale is null or saved_at is null;

create index if not exists idx_sales_tenant_email on public.sales(tenant_email);
create index if not exists idx_sales_tenant_saved_at on public.sales(tenant_email, saved_at desc);

-- 5) Legacy sales schema compatibility:
-- If older columns still exist and are NOT NULL, drop those NOT NULL constraints
-- so the current edge function can safely store the full sale in the `sale` jsonb column.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='tab_name') then
    execute 'alter table public.sales alter column tab_name drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='items') then
    execute 'alter table public.sales alter column items drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='subtotal') then
    execute 'alter table public.sales alter column subtotal drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='tax') then
    execute 'alter table public.sales alter column tax drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='total') then
    execute 'alter table public.sales alter column total drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='payment_method') then
    execute 'alter table public.sales alter column payment_method drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='currency_code') then
    execute 'alter table public.sales alter column currency_code drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='currency_symbol') then
    execute 'alter table public.sales alter column currency_symbol drop not null';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='staff_id') then
    execute 'alter table public.sales alter column staff_id drop not null';
  end if;
end $$;
