-- Migration: create absence_profiles table
-- Org-level profiles defining holiday rules per absence type

create table public.absence_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  absence_type_id uuid not null references public.absence_types(id) on delete restrict,
  type text not null default 'fixed' check (type in ('fixed', 'fixed_accrued', 'flexible', 'flexible_accrued')),
  carry_over_max numeric(6,2),
  carry_over_max_period integer,
  carry_over_min numeric(6,2),
  borrow_ahead_max numeric(6,2) not null default 0,
  borrow_ahead_max_period integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for org-scoped and type-scoped queries
create index idx_absence_profiles_organisation_id on public.absence_profiles(organisation_id);
create index idx_absence_profiles_absence_type_id on public.absence_profiles(absence_type_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_absence_profiles_updated_at
  before update on public.absence_profiles
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.absence_profiles enable row level security;

-- Employees: SELECT their org's profiles
create policy "absence_profiles_select"
  on public.absence_profiles for select
  using (
    get_user_role(organisation_id) in ('employee', 'admin', 'owner')
  );

-- Admins + Owners: INSERT
create policy "absence_profiles_insert"
  on public.absence_profiles for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE
create policy "absence_profiles_update"
  on public.absence_profiles for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE
create policy "absence_profiles_delete"
  on public.absence_profiles for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );
