-- Migration: create employee_work_profiles table
-- Junction/history table: which work_profile applies to an employee from a given date

create table public.employee_work_profiles (
  id uuid primary key default gen_random_uuid(),
  work_profile_id uuid not null references public.work_profiles(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete cascade,
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_employee_work_profile_date unique (member_id, effective_from)
);

-- Indexes for common query patterns
create index idx_employee_work_profiles_member_id on public.employee_work_profiles(member_id);
create index idx_employee_work_profiles_work_profile_id on public.employee_work_profiles(work_profile_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_employee_work_profiles_updated_at
  before update on public.employee_work_profiles
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.employee_work_profiles enable row level security;

-- Employees: SELECT their own assignments
create policy "employee_work_profiles_select_own"
  on public.employee_work_profiles for select
  using (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admins + Owners: SELECT assignments for members in their org
create policy "employee_work_profiles_select_org"
  on public.employee_work_profiles for select
  using (
    exists (
      select 1 from public.members m
      where m.id = employee_work_profiles.member_id
        and get_user_role(m.organisation_id) in ('admin', 'owner')
    )
  );

-- Admins + Owners: INSERT
create policy "employee_work_profiles_insert"
  on public.employee_work_profiles for insert
  with check (
    exists (
      select 1 from public.members m
      where m.id = employee_work_profiles.member_id
        and get_user_role(m.organisation_id) in ('admin', 'owner')
    )
  );

-- Admins + Owners: UPDATE
create policy "employee_work_profiles_update"
  on public.employee_work_profiles for update
  using (
    exists (
      select 1 from public.members m
      where m.id = employee_work_profiles.member_id
        and get_user_role(m.organisation_id) in ('admin', 'owner')
    )
  );

-- Admins + Owners: DELETE
create policy "employee_work_profiles_delete"
  on public.employee_work_profiles for delete
  using (
    exists (
      select 1 from public.members m
      where m.id = employee_work_profiles.member_id
        and get_user_role(m.organisation_id) in ('admin', 'owner')
    )
  );
