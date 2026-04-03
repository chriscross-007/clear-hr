-- Migration: create absence_types table
-- Configurable absence categories per organisation

create table public.absence_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  requires_tracking boolean not null default false,
  is_paid boolean not null default true,
  deducts_from_entitlement boolean not null default true,
  requires_approval boolean not null default false,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for org-scoped queries
create index idx_absence_types_organisation_id on public.absence_types(organisation_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_absence_types_updated_at
  before update on public.absence_types
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.absence_types enable row level security;

-- Employees: SELECT their org's absence types
create policy "absence_types_select"
  on public.absence_types for select
  using (
    get_user_role(organisation_id) in ('employee', 'admin', 'owner')
  );

-- Admins + Owners: INSERT their org's absence types
create policy "absence_types_insert"
  on public.absence_types for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE their org's absence types
create policy "absence_types_update"
  on public.absence_types for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE only non-default absence types
create policy "absence_types_delete"
  on public.absence_types for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
    and is_default = false
  );
