-- Migration: Holiday Approvals — Phase A schema (CLE-181)
--
-- Replaces the "any admin can approve any pending holiday booking" model with
-- named-routing driven by Approval Profiles. Each profile has a ladder of one
-- to three levels carrying main + delegate approver lists and optional
-- length thresholds; each member points at one profile per absence type.
--
-- Phase A wires only Level 1 in the application layer; L2/L3 columns are
-- created here and ready for Phase B.
--
-- Settled spec:
--   https://linear.app/clearhr/document/holiday-approvals-settled-spec-5a4138404dbb

-- ---------------------------------------------------------------------------
-- 1. approval_profiles — the routing rule
-- ---------------------------------------------------------------------------

create table public.approval_profiles (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name            text not null,
  absence_type_id uuid not null references public.absence_types(id) on delete cascade,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Names are unique per (org, absence_type) so the editor list is unambiguous
  constraint uq_approval_profiles_org_type_name
    unique (organisation_id, absence_type_id, name)
);

create index idx_approval_profiles_organisation_id
  on public.approval_profiles(organisation_id);
create index idx_approval_profiles_absence_type_id
  on public.approval_profiles(absence_type_id);

-- One default per (org, absence_type)
create unique index uq_approval_profiles_one_default_per_type
  on public.approval_profiles(organisation_id, absence_type_id)
  where is_default = true;

create trigger set_approval_profiles_updated_at
  before update on public.approval_profiles
  for each row
  execute function handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. approval_profile_levels — the ladder
-- ---------------------------------------------------------------------------

create table public.approval_profile_levels (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null references public.approval_profiles(id) on delete cascade,
  level                    int  not null check (level between 1 and 3),
  -- NULL thresholds mean "always required for this booking unit". Only ≥
  -- comparisons are supported. Days and hours are independent and apply by
  -- the booking's unit at submit time.
  length_threshold_days    int,
  length_threshold_hours   numeric(10,3),
  -- Lists of member.ids. Empty delegate list = no fallback configured.
  main_approver_ids        uuid[] not null,
  delegate_approver_ids    uuid[] not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint chk_approval_profile_levels_threshold_days_non_negative
    check (length_threshold_days is null or length_threshold_days >= 0),
  constraint chk_approval_profile_levels_threshold_hours_non_negative
    check (length_threshold_hours is null or length_threshold_hours >= 0),
  -- L1 must have at least one main approver. (L2/L3 may exist but be unset
  -- via Phase A UI — we still require an array so the column is non-null.)
  constraint chk_approval_profile_levels_main_non_empty
    check (array_length(main_approver_ids, 1) >= 1),
  constraint uq_approval_profile_levels_profile_level
    unique (profile_id, level)
);

create index idx_approval_profile_levels_profile_id
  on public.approval_profile_levels(profile_id);

create trigger set_approval_profile_levels_updated_at
  before update on public.approval_profile_levels
  for each row
  execute function handle_updated_at();

-- ---------------------------------------------------------------------------
-- 3. members.approval_profile_assignments — per-employee profile pointer per
--    absence type. Shape: { "<absence_type_id>": "<profile_id>" }.
-- ---------------------------------------------------------------------------

alter table public.members
  add column approval_profile_assignments jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 4. booking_approvals — per-booking, per-level decision rows
-- ---------------------------------------------------------------------------
--
-- Approver lists are snapshotted at submit time so subsequent profile edits
-- never ripple into in-flight bookings. Rows are written progressively: L1 at
-- submit; higher levels only when the previous one approves.

create table public.booking_approvals (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references public.holiday_bookings(id) on delete cascade,
  level                    int not null check (level between 1 and 3),
  main_approver_ids        uuid[] not null,
  delegate_approver_ids    uuid[] not null default '{}',
  routed_to                text not null check (routed_to in ('main', 'delegate')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by_member_id     uuid references public.members(id) on delete set null,
  decided_at               timestamptz,
  comment                  text,
  created_at               timestamptz not null default now(),

  constraint uq_booking_approvals_booking_level
    unique (booking_id, level)
);

create index idx_booking_approvals_booking_id
  on public.booking_approvals(booking_id);
create index idx_booking_approvals_status
  on public.booking_approvals(status)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 5. holiday_bookings.current_approval_level — pointer to the active level
-- ---------------------------------------------------------------------------
--
-- NULL = terminal (approved, rejected, cancelled, withdrawn, or auto-approved
-- because requires_approval = false). NULL also covers legacy "any admin"
-- bookings submitted before this rollout — those continue to surface on the
-- approvals page for any admin (migration day behaviour).

alter table public.holiday_bookings
  add column current_approval_level int
    check (current_approval_level is null or current_approval_level between 1 and 3);

create index idx_holiday_bookings_current_approval_level
  on public.holiday_bookings(current_approval_level)
  where current_approval_level is not null;

-- ---------------------------------------------------------------------------
-- 6. RLS — approval_profiles
-- ---------------------------------------------------------------------------

alter table public.approval_profiles enable row level security;

-- Any member of the org can read profiles (employees need to see their own
-- assigned profile name in the future; in Phase A this only matters for the
-- approvals page joins, but keeping read open keeps later phases simple).
create policy "approval_profiles_select_org"
  on public.approval_profiles for select
  using (
    get_user_role(organisation_id) in ('employee', 'admin', 'owner')
  );

create policy "approval_profiles_insert"
  on public.approval_profiles for insert
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

create policy "approval_profiles_update"
  on public.approval_profiles for update
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
  )
  with check (
    get_user_role(organisation_id) in ('admin', 'owner')
  );

create policy "approval_profiles_delete"
  on public.approval_profiles for delete
  using (
    get_user_role(organisation_id) in ('admin', 'owner')
    and is_default = false
  );

-- ---------------------------------------------------------------------------
-- 7. RLS — approval_profile_levels
-- ---------------------------------------------------------------------------

alter table public.approval_profile_levels enable row level security;

create policy "approval_profile_levels_select"
  on public.approval_profile_levels for select
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and get_user_role(ap.organisation_id) in ('employee', 'admin', 'owner')
    )
  );

create policy "approval_profile_levels_insert"
  on public.approval_profile_levels for insert
  with check (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and get_user_role(ap.organisation_id) in ('admin', 'owner')
    )
  );

create policy "approval_profile_levels_update"
  on public.approval_profile_levels for update
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and get_user_role(ap.organisation_id) in ('admin', 'owner')
    )
  )
  with check (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and get_user_role(ap.organisation_id) in ('admin', 'owner')
    )
  );

create policy "approval_profile_levels_delete"
  on public.approval_profile_levels for delete
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and get_user_role(ap.organisation_id) in ('admin', 'owner')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. RLS — booking_approvals
-- ---------------------------------------------------------------------------

alter table public.booking_approvals enable row level security;

-- The booking's owner can see their own approval rows. Admins/owners see
-- everything in their org. Routed approvers (main or delegate, depending on
-- routed_to) can also see the row — this is what powers the approvals page
-- for non-owner approvers.
create policy "booking_approvals_select"
  on public.booking_approvals for select
  using (
    exists (
      select 1
      from public.holiday_bookings hb
      where hb.id = booking_approvals.booking_id
        and (
          -- own booking
          hb.member_id in (select id from public.members where user_id = (select auth.uid()))
          -- admin/owner of the org
          or get_user_role(hb.organisation_id) in ('admin', 'owner')
          -- listed approver (main when routed_to='main', delegate when 'delegate')
          or (
            (
              booking_approvals.routed_to = 'main'
              and exists (
                select 1 from public.members m
                where m.user_id = (select auth.uid())
                  and m.id = any(booking_approvals.main_approver_ids)
              )
            )
            or (
              booking_approvals.routed_to = 'delegate'
              and exists (
                select 1 from public.members m
                where m.user_id = (select auth.uid())
                  and m.id = any(booking_approvals.delegate_approver_ids)
              )
            )
          )
        )
    )
  );

-- Application layer writes booking_approvals via the service-role client
-- (cross-user concerns). No public INSERT/UPDATE/DELETE policies.

-- ---------------------------------------------------------------------------
-- 9. Trigger — seed approval profile assignments on member insert
-- ---------------------------------------------------------------------------
--
-- Fires AFTER INSERT on members for every new row.
--
-- 1. If the inserted row is the org's owner AND no default Holiday Approval
--    Profile exists for the org yet, create one with the owner as L1
--    main + delegate. (This is the fresh-org install path.)
-- 2. Then, for every is_default=true profile in the org, ensure the new
--    member's approval_profile_assignments map carries a pointer to it.
--
-- Idempotent and safe to fire on every member insert. The owner trigger path
-- runs first so the owner ends up with the same auto-seeded pointer as
-- everyone else.

create or replace function trigger_seed_approval_profile_assignments()
returns trigger
language plpgsql
as $$
declare
  v_absence_type_id uuid;
  v_profile_id      uuid;
  v_assignments     jsonb := coalesce(NEW.approval_profile_assignments, '{}'::jsonb);
begin
  -- (1) Owner path: create the default profile if missing.
  if NEW.role = 'owner' then
    select id
      into v_absence_type_id
    from public.absence_types
    where organisation_id = NEW.organisation_id
      and is_default = true
      and name = 'Annual Leave'
    limit 1;

    if v_absence_type_id is not null then
      select id
        into v_profile_id
      from public.approval_profiles
      where organisation_id = NEW.organisation_id
        and absence_type_id = v_absence_type_id
        and is_default = true
      limit 1;

      if v_profile_id is null then
        insert into public.approval_profiles (organisation_id, name, absence_type_id, is_default)
        values (NEW.organisation_id, 'Holiday Approval Default', v_absence_type_id, true)
        returning id into v_profile_id;

        insert into public.approval_profile_levels (profile_id, level, main_approver_ids, delegate_approver_ids)
        values (v_profile_id, 1, array[NEW.id]::uuid[], array[NEW.id]::uuid[]);
      end if;
    end if;
  end if;

  -- (2) Seed assignments from every is_default profile in the org.
  for v_absence_type_id, v_profile_id in
    select absence_type_id, id
    from public.approval_profiles
    where organisation_id = NEW.organisation_id
      and is_default = true
  loop
    if not (v_assignments ? v_absence_type_id::text) then
      v_assignments := v_assignments
        || jsonb_build_object(v_absence_type_id::text, v_profile_id::text);
    end if;
  end loop;

  if v_assignments <> coalesce(NEW.approval_profile_assignments, '{}'::jsonb) then
    update public.members
    set approval_profile_assignments = v_assignments
    where id = NEW.id;
  end if;

  return NEW;
end;
$$;

create trigger seed_approval_profile_on_member_insert
  after insert on public.members
  for each row
  execute function trigger_seed_approval_profile_assignments();

-- ---------------------------------------------------------------------------
-- 10. Backfill — existing orgs and members
-- ---------------------------------------------------------------------------

-- 10a. Create one default Holiday Approval Profile per existing org.
-- Skip orgs with no owner — there's no member id to seed L1 with, and the
-- approval_profile_levels.main_approver_ids constraint requires ≥ 1 member.
insert into public.approval_profiles (organisation_id, name, absence_type_id, is_default)
select
  o.id,
  'Holiday Approval Default',
  at.id,
  true
from public.organisations o
join public.absence_types at
  on at.organisation_id = o.id
 and at.is_default = true
 and at.name = 'Annual Leave'
where exists (
  select 1 from public.members m
  where m.organisation_id = o.id and m.role = 'owner'
)
  and not exists (
    select 1 from public.approval_profiles ap
    where ap.organisation_id = o.id
      and ap.absence_type_id = at.id
      and ap.is_default = true
  );

-- 10b. Create the L1 row for each newly-seeded profile, with the owner-member
--      as both main and delegate.
insert into public.approval_profile_levels (profile_id, level, main_approver_ids, delegate_approver_ids)
select
  ap.id,
  1,
  array[m.id]::uuid[],
  array[m.id]::uuid[]
from public.approval_profiles ap
join lateral (
  select id
  from public.members
  where organisation_id = ap.organisation_id
    and role = 'owner'
  order by created_at asc
  limit 1
) m on true
where ap.is_default = true
  and not exists (
    select 1 from public.approval_profile_levels apl
    where apl.profile_id = ap.id and apl.level = 1
  );

-- 10c. Seed every existing member's approval_profile_assignments with the
--      org's default Holiday Approval Profile pointer (if not already set).
update public.members m
set approval_profile_assignments = coalesce(m.approval_profile_assignments, '{}'::jsonb)
      || jsonb_build_object(ap.absence_type_id::text, ap.id::text)
from public.approval_profiles ap
where ap.organisation_id = m.organisation_id
  and ap.is_default = true
  and not (m.approval_profile_assignments ? ap.absence_type_id::text);

-- Note on migration day behaviour: any holiday_bookings already in 'pending'
-- status retain current_approval_level = NULL. The approvals page will
-- continue to surface them for any admin to decide (legacy "any admin" feed).
-- Only NEW bookings submitted after rollout will have current_approval_level
-- set and routed via the profile flow. See settled spec for rationale.
