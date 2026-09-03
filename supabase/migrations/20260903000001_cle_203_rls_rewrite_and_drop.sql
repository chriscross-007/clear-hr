-- CLE-203 — RLS rewrite + drop legacy columns/tables.
--
-- Completes the Path B cutover that started in 20260828000003 and was
-- partially unblocked in 20260830000001. Rewrites every residual RLS
-- policy that still reads members.role directly or calls
-- get_user_permission, then drops the vestigial plumbing:
--
--   * members.role, members.permissions (columns)
--   * admin_profiles, employee_profiles (tables)
--
-- get_user_role is kept in place because it already sources from
-- rights_profiles.rank (see 20260828000001) — it stays as a
-- convenience shim for policies that just want "employee vs admin".
-- get_user_permission is rewritten to always return false as a
-- safety net for any caller we missed at the policy-rewrite pass.
--
-- Rewrite conventions:
--   • Admin write on a Settings-configured resource       →
--     has_rights_flag(organisation_id, 'can_edit_org_settings')
--   • Member-management (create/update/delete)            →
--     has_rights_flag(organisation_id, 'can_create_users' |
--                                       'can_delete_users')
--   • Approver operations on holidays/sick               →
--     has_rights_flag(organisation_id, 'can_approve_holidays')
--   • Team management                                     →
--     has_rights_flag(organisation_id, 'can_manage_teams')
--   • Cross-user visibility (Employees Directory scope)   →
--     get_cross_user_access(organisation_id) IN ('team','all')
--   • "Anyone authenticated in this org can see this"     →
--     get_user_role(organisation_id) IS NOT NULL
--
-- All helpers used below are SECURITY DEFINER (defined in
-- 20260828000001 and 20260828000003), so referencing them from
-- policies on `members` does not cause RLS recursion.

begin;

-- ---------------------------------------------------------------------------
-- absence_comments (2)
-- ---------------------------------------------------------------------------
drop policy if exists "absence_comments_insert" on public.absence_comments;
create policy "absence_comments_insert" on public.absence_comments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = absence_comments.holiday_booking_id
        and public.get_user_role(hb.organisation_id) is not null
    )
  );

drop policy if exists "absence_comments_select_org" on public.absence_comments;
create policy "absence_comments_select_org" on public.absence_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = absence_comments.holiday_booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

-- ---------------------------------------------------------------------------
-- absence_reasons (1)
-- ---------------------------------------------------------------------------
drop policy if exists "absence_reasons_select" on public.absence_reasons;
create policy "absence_reasons_select" on public.absence_reasons
  for select to authenticated
  using (public.get_user_role(organisation_id) is not null);

-- ---------------------------------------------------------------------------
-- absence_types (1)
-- ---------------------------------------------------------------------------
drop policy if exists "absence_types_select" on public.absence_types;
create policy "absence_types_select" on public.absence_types
  for select to authenticated
  using (public.get_user_role(organisation_id) is not null);

-- ---------------------------------------------------------------------------
-- approval_profile_levels (1)
-- ---------------------------------------------------------------------------
drop policy if exists "approval_profile_levels_select" on public.approval_profile_levels;
create policy "approval_profile_levels_select" on public.approval_profile_levels
  for select to authenticated
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = approval_profile_levels.profile_id
        and public.get_user_role(ap.organisation_id) is not null
    )
  );

-- ---------------------------------------------------------------------------
-- approval_profiles (1)
-- ---------------------------------------------------------------------------
drop policy if exists "approval_profiles_select_org" on public.approval_profiles;
create policy "approval_profiles_select_org" on public.approval_profiles
  for select to authenticated
  using (public.get_user_role(organisation_id) is not null);

-- ---------------------------------------------------------------------------
-- bank_holidays (1)
-- ---------------------------------------------------------------------------
drop policy if exists "bank_holidays_select_org" on public.bank_holidays;
create policy "bank_holidays_select_org" on public.bank_holidays
  for select to authenticated
  using (
    organisation_id is not null
    and public.get_user_role(organisation_id) is not null
  );

-- ---------------------------------------------------------------------------
-- clocking_adjustments (1)
-- ---------------------------------------------------------------------------
drop policy if exists "clocking_adjustments_owner_admin_insert" on public.clocking_adjustments;
create policy "clocking_adjustments_owner_admin_insert" on public.clocking_adjustments
  for insert to authenticated
  with check (
    adjusted_by in (
      select m.id
      from public.members m
      where m.user_id = (select auth.uid())
        and public.has_rights_flag(m.organisation_id, 'can_edit_org_settings')
    )
  );

-- ---------------------------------------------------------------------------
-- clockings (1)
-- ---------------------------------------------------------------------------
drop policy if exists "clockings_owner_admin_write" on public.clockings;
create policy "clockings_owner_admin_write" on public.clockings
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- custom_field_definitions (1)
-- ---------------------------------------------------------------------------
drop policy if exists "Owners manage field defs" on public.custom_field_definitions;
create policy "Owners manage field defs" on public.custom_field_definitions
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- custom_reports (1)
-- ---------------------------------------------------------------------------
drop policy if exists "custom_reports_insert" on public.custom_reports;
create policy "custom_reports_insert" on public.custom_reports
  for insert to authenticated
  with check (
    public.has_rights_flag(organisation_id, 'can_run_reports')
    and created_by in (
      select m.id
      from public.members m
      where m.user_id = (select auth.uid())
        and m.organisation_id = custom_reports.organisation_id
      limit 1
    )
  );

-- ---------------------------------------------------------------------------
-- employee_work_profiles (1)
-- ---------------------------------------------------------------------------
drop policy if exists "employee_work_profiles_select_org" on public.employee_work_profiles;
create policy "employee_work_profiles_select_org" on public.employee_work_profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = employee_work_profiles.member_id
        and public.has_rights_flag(m.organisation_id, 'can_edit_org_settings')
    )
  );

-- ---------------------------------------------------------------------------
-- holiday_periods (1)
-- ---------------------------------------------------------------------------
drop policy if exists "holiday_periods_select_org" on public.holiday_periods;
create policy "holiday_periods_select_org" on public.holiday_periods
  for select to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- members (9 → 4)
-- ---------------------------------------------------------------------------
-- The 9 legacy policies split cleanly into 4 responsibilities:
--   * SELECT  — visible per cross_user_access + always-see-self
--   * INSERT  — admin with can_create_users
--   * UPDATE  — admin with can_create_users, scoped to visible teams
--   * DELETE  — admin with can_delete_users
--
-- The 4 dead "Owner*" policies collapse into the admin path — 'owner'
-- rank hasn't existed since Path B and those policies have been
-- always-false since 20260828000001.

drop policy if exists "Admins can delete members"                    on public.members;
drop policy if exists "Admins can insert members"                    on public.members;
drop policy if exists "Admins can read team members"                 on public.members;
drop policy if exists "Admins can update team members"               on public.members;
drop policy if exists "Employees can read team members if permitted" on public.members;
drop policy if exists "Owners can delete members"                    on public.members;
drop policy if exists "Owners can insert members"                    on public.members;
drop policy if exists "Owners can read all org members"              on public.members;
drop policy if exists "Owners can update org members"                on public.members;

create policy "members_read_by_scope" on public.members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.get_cross_user_access(organisation_id) = 'all'
    or (
      public.get_cross_user_access(organisation_id) = 'team'
      and team_id is not distinct from public.get_user_team_id(organisation_id)
    )
  );

create policy "members_admin_insert" on public.members
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_create_users'));

create policy "members_admin_update" on public.members
  for update to authenticated
  using (
    public.has_rights_flag(organisation_id, 'can_create_users')
    and (
      public.get_cross_user_access(organisation_id) = 'all'
      or team_id is not distinct from public.get_user_team_id(organisation_id)
    )
  )
  with check (
    public.has_rights_flag(organisation_id, 'can_create_users')
  );

create policy "members_admin_delete" on public.members
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_delete_users'));

-- ---------------------------------------------------------------------------
-- notice_period_rules (3)
-- ---------------------------------------------------------------------------
drop policy if exists "Admins can insert notice rules" on public.notice_period_rules;
create policy "Admins can insert notice rules" on public.notice_period_rules
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

drop policy if exists "Admins can update notice rules" on public.notice_period_rules;
create policy "Admins can update notice rules" on public.notice_period_rules
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

drop policy if exists "Admins can delete notice rules" on public.notice_period_rules;
create policy "Admins can delete notice rules" on public.notice_period_rules
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- org_backups (1)
-- ---------------------------------------------------------------------------
drop policy if exists "Owners can manage their org backups" on public.org_backups;
create policy "Owners can manage their org backups" on public.org_backups
  for all to authenticated
  using (
    public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    or public.has_rights_flag(organisation_id, 'can_manage_billing')
  )
  with check (
    public.has_rights_flag(organisation_id, 'can_edit_org_settings')
    or public.has_rights_flag(organisation_id, 'can_manage_billing')
  );

-- ---------------------------------------------------------------------------
-- organisations (1)
-- ---------------------------------------------------------------------------
drop policy if exists "Owner can update their org" on public.organisations;
create policy "Owner can update their org" on public.organisations
  for update to authenticated
  using (public.has_rights_flag(id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- rates (3)
-- ---------------------------------------------------------------------------
drop policy if exists "owners_can_insert_rates" on public.rates;
create policy "owners_can_insert_rates" on public.rates
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

drop policy if exists "owners_can_update_rates" on public.rates;
create policy "owners_can_update_rates" on public.rates
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

drop policy if exists "owners_can_delete_rates" on public.rates;
create policy "owners_can_delete_rates" on public.rates
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- scheduled_shifts (1)
-- ---------------------------------------------------------------------------
drop policy if exists "scheduled_shifts_owner_admin_write" on public.scheduled_shifts;
create policy "scheduled_shifts_owner_admin_write" on public.scheduled_shifts
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- shift_definitions (1)
-- ---------------------------------------------------------------------------
drop policy if exists "shift_definitions_owner_admin_write" on public.shift_definitions;
create policy "shift_definitions_owner_admin_write" on public.shift_definitions
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- sick_booking_details (4)
-- ---------------------------------------------------------------------------
drop policy if exists "sick_details_select" on public.sick_booking_details;
create policy "sick_details_select" on public.sick_booking_details
  for select to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = sick_booking_details.booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

drop policy if exists "sick_details_insert" on public.sick_booking_details;
create policy "sick_details_insert" on public.sick_booking_details
  for insert to authenticated
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = sick_booking_details.booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

drop policy if exists "sick_details_update" on public.sick_booking_details;
create policy "sick_details_update" on public.sick_booking_details
  for update to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = sick_booking_details.booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  )
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = sick_booking_details.booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

drop policy if exists "sick_details_delete" on public.sick_booking_details;
create policy "sick_details_delete" on public.sick_booking_details
  for delete to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = sick_booking_details.booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

-- ---------------------------------------------------------------------------
-- teams (2 → 1)
-- ---------------------------------------------------------------------------
drop policy if exists "Owner can manage teams"                on public.teams;
drop policy if exists "Admins with permission can manage teams" on public.teams;

create policy "teams_manage" on public.teams
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_manage_teams'))
  with check (public.has_rights_flag(organisation_id, 'can_manage_teams'));

-- ---------------------------------------------------------------------------
-- work_periods (1)
-- ---------------------------------------------------------------------------
drop policy if exists "work_periods_owner_admin_write" on public.work_periods;
create policy "work_periods_owner_admin_write" on public.work_periods
  for all to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- work_profiles (2)
-- ---------------------------------------------------------------------------
drop policy if exists "work_profiles_select_employee" on public.work_profiles;
create policy "work_profiles_select_employee" on public.work_profiles
  for select to authenticated
  using (
    public.get_user_role(organisation_id) = 'employee'
    and (
      member_id is null
      or member_id in (
        select m.id from public.members m
        where m.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "work_profiles_select_org" on public.work_profiles;
create policy "work_profiles_select_org" on public.work_profiles
  for select to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- ---------------------------------------------------------------------------
-- Stragglers picked up on the second migration run (policies whose
-- text used `m.role` or referenced the column via a subquery my
-- pg_policies regex missed the first time).
-- ---------------------------------------------------------------------------

-- audit_log — admin-visible via can_view_audit_logs flag.
drop policy if exists "Owners and admins can view audit log" on public.audit_log;
create policy "Owners and admins can view audit log" on public.audit_log
  for select to authenticated
  using (public.has_rights_flag(organisation_id, 'can_view_audit_logs'));

-- members — bootstrap policy for the first insert during org creation.
-- Under Path B there's no 'owner' rank, so the intent collapses to
-- "the row's user_id matches the authenticated user" (the trigger
-- assigns a default rights_profile_id).
drop policy if exists "Users can insert themselves as owner of new org" on public.members;
create policy "Users can insert themselves as owner of new org" on public.members
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- overtime_after_rules — no direct org column; scoped via
-- shift_definition_id → shift_definitions.organisation_id.
drop policy if exists "overtime_after_rules_owner_admin_write" on public.overtime_after_rules;
create policy "overtime_after_rules_owner_admin_write" on public.overtime_after_rules
  for all to authenticated
  using (
    exists (
      select 1 from public.shift_definitions sd
      where sd.id = overtime_after_rules.shift_definition_id
        and public.has_rights_flag(sd.organisation_id, 'can_edit_org_settings')
    )
  )
  with check (
    exists (
      select 1 from public.shift_definitions sd
      where sd.id = overtime_after_rules.shift_definition_id
        and public.has_rights_flag(sd.organisation_id, 'can_edit_org_settings')
    )
  );

-- overtime_bands — same shape as overtime_after_rules.
drop policy if exists "overtime_bands_owner_admin_write" on public.overtime_bands;
create policy "overtime_bands_owner_admin_write" on public.overtime_bands
  for all to authenticated
  using (
    exists (
      select 1 from public.shift_definitions sd
      where sd.id = overtime_bands.shift_definition_id
        and public.has_rights_flag(sd.organisation_id, 'can_edit_org_settings')
    )
  )
  with check (
    exists (
      select 1 from public.shift_definitions sd
      where sd.id = overtime_bands.shift_definition_id
        and public.has_rights_flag(sd.organisation_id, 'can_edit_org_settings')
    )
  );

-- ---------------------------------------------------------------------------
-- Neutralise get_user_permission — safety net for any surviving caller.
-- Every policy call site above has been rewritten to has_rights_flag,
-- but there may be non-policy callers (functions, triggers) elsewhere
-- that a policy-only grep wouldn't find. Returning false is the
-- safe-default: any lingering caller degrades to "no permission".
-- ---------------------------------------------------------------------------
-- The existing function's second parameter is named `permission_key`.
-- CREATE OR REPLACE can't rename a parameter, so drop-then-create.
drop function if exists public.get_user_permission(uuid, text);
create function public.get_user_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  -- Path B has no per-user permission map; every access decision is
  -- carried by a rights_profiles flag column via has_rights_flag().
  -- This shim returns false so any residual caller fails-closed.
  select false;
$$;

-- ---------------------------------------------------------------------------
-- Drop the two vestigial profile-lookup tables. Any RLS policies on
-- them were exclusively `members.role`-based (per CLE-201c-9's error
-- output) and are no longer relevant now that those policies have
-- been replaced with flag-based ones on the surviving tables.
-- CASCADE covers the residual foreign keys / policies that live only
-- on these tables.
-- ---------------------------------------------------------------------------
drop table if exists public.admin_profiles    cascade;
drop table if exists public.employee_profiles cascade;

-- ---------------------------------------------------------------------------
-- Drop the vestigial members columns. Safe because:
--   * every policy that read them has been rewritten above
--   * get_user_role reads rights_profiles.rank (20260828000001)
--   * get_user_permission is now a no-op returning false (above)
--   * get_org_members reads rights_profiles (20260828000002)
--   * bulk_update_members no longer accepts a role param (20260830000001)
--   * the app stopped writing role/permissions in CLE-201c (already
--     shipped)
-- ---------------------------------------------------------------------------
alter table public.members
  drop column if exists role,
  drop column if exists permissions;

commit;
