-- Run this yourself in the Supabase SQL editor. The app does not execute it.
-- It lets a venue change its login email without leaving sales behind.
-- Review it before running. It changes a foreign key on public.sales.

alter table public.sales drop constraint if exists sales_tenant_email_fkey;

alter table public.sales
  add constraint sales_tenant_email_fkey
  foreign key (tenant_email)
  references public.tenants (email)
  on update cascade
  on delete cascade;

-- The summary view should respect the querying user's row security.
alter view public.tenant_summaries set (security_invoker = true);

-- Deny-all policies belong on every tenant table. 002_login_hotfix.sql
-- does not enable them, and kv_store_b88a7963 is leftover from the old store.
-- Enable these only after you have confirmed the edge function uses the
-- service role and no browser client reads these tables directly.
alter table public.tenants enable row level security;
alter table public.sales enable row level security;

do $$
begin
  if to_regclass('public.kv_store_b88a7963') is not null then
    execute 'alter table public.kv_store_b88a7963 enable row level security';
    execute 'revoke all on table public.kv_store_b88a7963 from anon, authenticated';
  end if;
end $$;
