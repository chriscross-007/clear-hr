-- Migration: create holiday_year_records table
-- Per-employee, per-absence-type, per-holiday-year entitlement record

create table public.holiday_year_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  absence_type_id uuid not null references public.absence_types(id) on delete restrict,
  year_start date not null,
  year_end date not null,
  base_amount numeric(6,2) not null default 0,
  adjustment numeric(6,2) not null default 0,
  carried_over numeric(6,2) not null default 0,
  borrow_forward numeric(6,2) not null default 0,
  pro_rata_amount numeric(6,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_holiday_year_member_type_start unique (member_id, absence_type_id, year_start),
  constraint chk_year_end_after_start check (year_end > year_start)
);

-- Indexes for common query patterns
create index idx_holiday_year_records_organisation_id on public.holiday_year_records(organisation_id);
create index idx_holiday_year_records_member_id on public.holiday_year_records(member_id);
create index idx_holiday_year_records_absence_type_id on public.holiday_year_records(absence_type_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_holiday_year_records_updated_at
  before update on public.holiday_year_records
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.holiday_year_records enable row level security;

-- Employees: SELECT their own records
create policy "holiday_year_records_select_own"
  on public.holiday_year_records for select
  using (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admins + Owners: SELECT all records in their org
create policy "holiday_year_records_select_org"
  on public.holiday_year_records for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: INSERT
create policy "holiday_year_records_insert"
  on public.holiday_year_records for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE
create policy "holiday_year_records_update"
  on public.holiday_year_records for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE
create policy "holiday_year_records_delete"
  on public.holiday_year_records for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );
