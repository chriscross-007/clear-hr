-- Migration: create absence_reasons table
-- Bookable absence reasons belonging to an absence_type

create table public.absence_reasons (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  absence_type_id uuid not null references public.absence_types(id) on delete cascade,
  name text not null,
  colour text not null default '#6366f1',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for org-scoped and type-scoped queries
create index idx_absence_reasons_organisation_id on public.absence_reasons(organisation_id);
create index idx_absence_reasons_absence_type_id on public.absence_reasons(absence_type_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_absence_reasons_updated_at
  before update on public.absence_reasons
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.absence_reasons enable row level security;

-- Employees: SELECT their org's reasons
create policy "absence_reasons_select"
  on public.absence_reasons for select
  using (
    get_user_role(organisation_id) in ('employee', 'admin', 'owner')
  );

-- Admins + Owners: INSERT
create policy "absence_reasons_insert"
  on public.absence_reasons for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE
create policy "absence_reasons_update"
  on public.absence_reasons for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE only non-default reasons
create policy "absence_reasons_delete"
  on public.absence_reasons for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
    and is_default = false
  );
