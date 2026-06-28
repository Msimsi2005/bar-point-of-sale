-- PourPOS — Initial Schema
-- Run this in your Supabase SQL editor: https://app.supabase.com/project/_/sql

-- ── Tenants ─────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade unique,
  plan        text default 'starter' check (plan in ('starter', 'pro', 'enterprise')),
  business_info jsonb default '{}',
  config      jsonb default '{}',
  created_at  timestamptz default now()
);

-- ── Menu Items ───────────────────────────────────────────────────────────────
create table if not exists menu_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  name        text not null,
  category    text not null,
  price       numeric(10,2) not null,
  description text default '',
  stock       integer default -1,
  popular     boolean default false,
  created_at  timestamptz default now()
);

-- ── Staff ────────────────────────────────────────────────────────────────────
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  name        text not null,
  pin         text not null,
  role        text default 'bartender' check (role in ('owner', 'manager', 'bartender')),
  created_at  timestamptz default now()
);

-- ── Customers ────────────────────────────────────────────────────────────────
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  name        text not null,
  email       text default '',
  phone       text default '',
  total_spent numeric(12,2) default 0,
  visits      integer default 0,
  notes       text default '',
  created_at  timestamptz default now()
);

-- ── Sales ────────────────────────────────────────────────────────────────────
create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  tab_name         text not null,
  items            jsonb not null default '[]',
  subtotal         numeric(12,2) not null,
  tax              numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  total_converted  numeric(12,2) not null,
  payment_method   text not null,
  currency_code    text not null default 'ZAR',
  currency_symbol  text not null default 'R',
  staff_id         uuid,
  customer_id      uuid,
  prepaid          numeric(12,2),
  change_amount    numeric(12,2),
  created_at       timestamptz default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table tenants    enable row level security;
alter table menu_items enable row level security;
alter table staff      enable row level security;
alter table customers  enable row level security;
alter table sales      enable row level security;

-- Tenants: own row only
create policy "tenants_own" on tenants
  for all using (user_id = auth.uid());

-- Menu items: via tenant ownership
create policy "menu_items_own" on menu_items
  for all using (
    tenant_id in (select id from tenants where user_id = auth.uid())
  );

create policy "staff_own" on staff
  for all using (
    tenant_id in (select id from tenants where user_id = auth.uid())
  );

create policy "customers_own" on customers
  for all using (
    tenant_id in (select id from tenants where user_id = auth.uid())
  );

create policy "sales_own" on sales
  for all using (
    tenant_id in (select id from tenants where user_id = auth.uid())
  );

-- ── Helper Function ──────────────────────────────────────────────────────────
-- Used to increment customer spend + visits atomically
create or replace function increment_customer_stats(customer_id uuid, amount_to_add numeric)
returns void language sql security definer as $$
  update customers
  set total_spent = total_spent + amount_to_add,
      visits = visits + 1
  where id = customer_id;
$$;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_menu_items_tenant on menu_items(tenant_id);
create index if not exists idx_staff_tenant      on staff(tenant_id);
create index if not exists idx_customers_tenant  on customers(tenant_id);
create index if not exists idx_sales_tenant      on sales(tenant_id);
create index if not exists idx_sales_created_at  on sales(tenant_id, created_at desc);
