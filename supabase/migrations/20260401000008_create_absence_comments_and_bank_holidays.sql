-- Migration: create absence_comments and bank_holidays tables

-- =========================================================================
-- Table 1: absence_comments
-- Immutable audit trail of status changes and notes on holiday bookings
-- =========================================================================

create table public.absence_comments (
  id uuid primary key default gen_random_uuid(),
  holiday_booking_id uuid not null references public.holiday_bookings(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  note text,
  holiday_status text not null check (holiday_status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_absence_comments_holiday_booking_id on public.absence_comments(holiday_booking_id);
create index idx_absence_comments_member_id on public.absence_comments(member_id);

-- No updated_at trigger — rows are immutable

-- Enable RLS
alter table public.absence_comments enable row level security;

-- Employees: SELECT comments on their own bookings
create policy "absence_comments_select_own"
  on public.absence_comments for select
  using (
    holiday_booking_id in (
      select id from public.holiday_bookings
      where member_id in (
        select id from public.members where user_id = (select auth.uid())
      )
    )
  );

-- Admins + Owners: SELECT all comments in their org (via holiday_bookings)
create policy "absence_comments_select_org"
  on public.absence_comments for select
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = absence_comments.holiday_booking_id
        and get_user_role(hb.organisation_id) in ('admin', 'owner')
    )
  );

-- Any authenticated member: INSERT a comment on a booking in their org
create policy "absence_comments_insert"
  on public.absence_comments for insert
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = absence_comments.holiday_booking_id
        and get_user_role(hb.organisation_id) in ('employee', 'admin', 'owner')
    )
  );

-- No UPDATE or DELETE policies — rows are immutable


-- =========================================================================
-- Table 2: bank_holidays
-- Country-specific public holidays with org-level overrides
-- =========================================================================

create table public.bank_holidays (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  organisation_id uuid references public.organisations(id) on delete cascade,
  date date not null,
  name text not null,
  is_excluded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uq_bank_holiday_country_org_date
    unique nulls not distinct (country_code, organisation_id, date)
);

-- Indexes
create index idx_bank_holidays_country_code on public.bank_holidays(country_code);
create index idx_bank_holidays_organisation_id on public.bank_holidays(organisation_id);
create index idx_bank_holidays_date on public.bank_holidays(date);

-- Reuse existing handle_updated_at trigger function
create trigger set_bank_holidays_updated_at
  before update on public.bank_holidays
  for each row
  execute function handle_updated_at();

-- Enable RLS
alter table public.bank_holidays enable row level security;

-- All authenticated users: SELECT system-wide records (organisation_id is null)
create policy "bank_holidays_select_system"
  on public.bank_holidays for select
  using (
    organisation_id is null
    and auth.uid() is not null
  );

-- Members: SELECT their org's overrides
create policy "bank_holidays_select_org"
  on public.bank_holidays for select
  using (
    organisation_id is not null
    and get_user_role(organisation_id) in ('employee', 'admin', 'owner')
  );

-- Admins + Owners: INSERT org-level overrides only
create policy "bank_holidays_insert"
  on public.bank_holidays for insert
  with check (
    organisation_id is not null
    and get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: UPDATE org-level overrides only
create policy "bank_holidays_update"
  on public.bank_holidays for update
  using (
    organisation_id is not null
    and get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins + Owners: DELETE org-level overrides only
create policy "bank_holidays_delete"
  on public.bank_holidays for delete
  using (
    organisation_id is not null
    and get_user_role(organisation_id) in ('admin', 'owner')
  );
