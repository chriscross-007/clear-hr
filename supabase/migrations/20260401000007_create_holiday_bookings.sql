-- Migration: create holiday_bookings table
-- Individual absence booking records — core transaction table

create table public.holiday_bookings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  leave_reason_id uuid not null references public.absence_reasons(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  start_half text check (start_half in ('am', 'pm')),
  end_half text check (end_half in ('am', 'pm')),
  hours_deducted numeric(6,2),
  days_deducted numeric(6,2),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver1_id uuid references public.members(id) on delete set null,
  approver_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_end_date_gte_start_date check (end_date >= start_date)
);

-- Indexes for common query patterns
create index idx_holiday_bookings_organisation_id on public.holiday_bookings(organisation_id);
create index idx_holiday_bookings_member_id on public.holiday_bookings(member_id);
create index idx_holiday_bookings_status on public.holiday_bookings(status);
create index idx_holiday_bookings_start_date on public.holiday_bookings(start_date);
create index idx_holiday_bookings_leave_reason_id on public.holiday_bookings(leave_reason_id);

-- Reuse existing handle_updated_at trigger function
create trigger set_holiday_bookings_updated_at
  before update on public.holiday_bookings
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.holiday_bookings enable row level security;

-- Employees: SELECT their own bookings
create policy "holiday_bookings_select_own"
  on public.holiday_bookings for select
  using (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admins + Owners: SELECT all bookings in their org
create policy "holiday_bookings_select_org"
  on public.holiday_bookings for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Employees: INSERT their own bookings
create policy "holiday_bookings_insert_own"
  on public.holiday_bookings for insert
  with check (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Employees: UPDATE their own bookings only when pending (for cancellation)
create policy "holiday_bookings_update_own_pending"
  on public.holiday_bookings for update
  using (
    status = 'pending'
    and member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admins + Owners: UPDATE all bookings in their org
create policy "holiday_bookings_update_org"
  on public.holiday_bookings for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Owners only: DELETE (prefer cancellation over hard deletes)
create policy "holiday_bookings_delete_owner"
  on public.holiday_bookings for delete
  using (
    get_user_role(organisation_id) = 'owner'
  );
