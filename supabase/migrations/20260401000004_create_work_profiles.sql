-- Migration: create work_profiles table
-- Named working schedules with per-day hours; member_id null = org default

create table public.work_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  member_id uuid references public.members(id) on delete set null,
  effective_from date not null,
  hours_monday numeric(4,2) not null default 0,
  hours_tuesday numeric(4,2) not null default 0,
  hours_wednesday numeric(4,2) not null default 0,
  hours_thursday numeric(4,2) not null default 0,
  hours_friday numeric(4,2) not null default 0,
  hours_saturday numeric(4,2) not null default 0,
  hours_sunday numeric(4,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for common query patterns
create index idx_work_profiles_organisation_id on public.work_profiles(organisation_id);
create index idx_work_profiles_member_id on public.work_profiles(member_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_work_profiles_updated_at
  before update on public.work_profiles
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.work_profiles enable row level security;

-- Employees: SELECT their own profiles or the org default (member_id is null)
create policy "work_profiles_select_employee"
  on public.work_profiles for select
  using (
    get_user_role(organisation_id) = 'employee'
    and (
      member_id is null
      or member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    )
  );

-- Admins + Owners: SELECT all profiles in their org
create policy "work_profiles_select_org"
  on public.work_profiles for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: INSERT
create policy "work_profiles_insert"
  on public.work_profiles for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE
create policy "work_profiles_update"
  on public.work_profiles for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE
create policy "work_profiles_delete"
  on public.work_profiles for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );
