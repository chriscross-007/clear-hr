-- Migration: Profileless Holiday Management — schema reset (CLE-167)
--
-- Replaces the old absence_profiles + holiday_year_records model with a
-- per-employee holiday_periods table whose parameters are set inline. Adds
-- per-employee cog columns to members and per-org default columns to
-- organisations to support the Default Cascade specced in
-- the "Profileless Holiday Management — settled spec" Linear document.
--
-- Clean break: no production orgs are using the product yet, so we drop
-- the old tables outright rather than migrate rows.

-- ---------------------------------------------------------------------------
-- 1. Drop superseded tables
-- ---------------------------------------------------------------------------

drop table if exists public.holiday_year_records cascade;
drop table if exists public.absence_profiles cascade;

-- ---------------------------------------------------------------------------
-- 2. Required extension for the no-overlap exclusion constraint
-- ---------------------------------------------------------------------------

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 3. holiday_periods — the new per-employee period record
-- ---------------------------------------------------------------------------

create table public.holiday_periods (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  member_id           uuid not null references public.members(id) on delete cascade,
  name                text not null,
  start_date          date not null,
  end_date            date not null,
  type                text not null default 'fixed'
                        check (type in ('fixed', 'earned')),
  units               text not null default 'days'
                        check (units in ('days', 'hours')),
  -- Fixed-type periods carry an Allowance value; Earned-type periods leave
  -- it null and the value is derived live from Worked × Earned Factor.
  allowance           numeric(10,3),
  earned_factor       numeric(10,3) not null default 0,
  adjust              numeric(10,3) not null default 0,
  max_carry_forward   numeric(10,3) not null default 0,
  min_carry_forward   numeric(10,3) not null default -999,
  locked              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_holiday_periods_end_after_start
    check (end_date > start_date),
  constraint chk_holiday_periods_min_cf_non_positive
    check (min_carry_forward <= 0),
  constraint chk_holiday_periods_max_cf_non_negative
    check (max_carry_forward >= 0),
  -- Earned-type periods must not have an allowance set; Fixed-type periods must.
  constraint chk_holiday_periods_allowance_per_type
    check (
      (type = 'fixed' and allowance is not null) or
      (type = 'earned' and allowance is null)
    ),
  -- Per-employee uniqueness on Name (spec: "Uniqueness enforced per employee")
  constraint uq_holiday_periods_member_name unique (member_id, name),
  -- Per-employee no overlapping date ranges
  constraint excl_holiday_periods_no_overlap exclude using gist (
    member_id with =,
    daterange(start_date, end_date, '[]') with &&
  )
);

create index idx_holiday_periods_organisation_id
  on public.holiday_periods(organisation_id);
create index idx_holiday_periods_member_start_date
  on public.holiday_periods(member_id, start_date);

create trigger set_holiday_periods_updated_at
  before update on public.holiday_periods
  for each row
  execute function handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4. holiday_periods RLS
-- ---------------------------------------------------------------------------

alter table public.holiday_periods enable row level security;

-- Employees can read their own periods.
create policy "holiday_periods_select_own"
  on public.holiday_periods for select
  using (
    member_id in (
      select id from public.members where user_id = (select auth.uid())
    )
  );

-- Admins and owners can read every period in their org.
create policy "holiday_periods_select_org"
  on public.holiday_periods for select
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- Admins and owners can create / update / delete periods.
create policy "holiday_periods_insert"
  on public.holiday_periods for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

create policy "holiday_periods_update"
  on public.holiday_periods for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  )
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

create policy "holiday_periods_delete"
  on public.holiday_periods for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

-- ---------------------------------------------------------------------------
-- 5. members — per-employee Default Cascade values (cog)
-- ---------------------------------------------------------------------------
--
-- Set at employee creation by snapshotting the org defaults. Non-null
-- thereafter (admin can edit but not clear). New holiday periods inherit
-- these values at period creation.

alter table public.members
  add column holiday_type text not null default 'fixed'
    check (holiday_type in ('fixed', 'earned')),
  add column holiday_units text not null default 'days'
    check (holiday_units in ('days', 'hours')),
  add column holiday_earned_factor numeric(10,3) not null default 0,
  add column holiday_allowance numeric(10,3) not null default 0,
  add column holiday_toil_hours_per_day numeric(10,3) not null default 0,
  add column holiday_max_carry_forward numeric(10,3) not null default 0
    check (holiday_max_carry_forward >= 0),
  add column holiday_min_carry_forward numeric(10,3) not null default -999
    check (holiday_min_carry_forward <= 0);

-- ---------------------------------------------------------------------------
-- 6. organisations — hardcoded Default Cascade values
-- ---------------------------------------------------------------------------
--
-- Per-org defaults that seed the employee cog at employee creation. The
-- existing holiday_year_start_type / holiday_year_start_day /
-- holiday_year_start_month columns continue to drive the Start Date / End
-- Date defaults documented in the spec.

alter table public.organisations
  add column default_holiday_type text not null default 'fixed'
    check (default_holiday_type in ('fixed', 'earned')),
  add column default_holiday_units text not null default 'days'
    check (default_holiday_units in ('days', 'hours')),
  add column default_holiday_earned_factor numeric(10,3) not null default 0,
  add column default_holiday_allowance numeric(10,3) not null default 0,
  add column default_holiday_toil_hours_per_day numeric(10,3) not null default 0,
  add column default_holiday_max_carry_forward numeric(10,3) not null default 0
    check (default_holiday_max_carry_forward >= 0),
  add column default_holiday_min_carry_forward numeric(10,3) not null default -999
    check (default_holiday_min_carry_forward <= 0);
