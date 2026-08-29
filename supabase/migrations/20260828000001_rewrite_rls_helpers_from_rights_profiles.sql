-- CLE-201c — Rewrite get_user_role + get_user_permission to source
-- from `rights_profiles` (Rights Profiles v2) rather than the legacy
-- members.role + members.permissions columns.
--
-- Strategy: keep the existing RETURN shapes so almost every RLS
-- policy continues to work unchanged. Two return-value changes need
-- accompanying policy rewrites (included below):
--
--   1. get_user_role never returns 'owner' any more (the rank enum is
--      employee|manager|hr|admin). The one RLS policy that checks
--      `= 'owner'` is rewritten to check `in ('admin')` (same intent
--      under the flattened model — anyone with the Admin rank).
--
--   2. Direct `role = 'owner'` reads on the members table (present in
--      notice_period_profiles RLS + the approval-profile-seed trigger)
--      are rewritten to check the Admin rank via a rights-profile
--      join. See sections 3 + 4 below.
--
-- Historical reference — the pre-rewrite bodies were:
--
--   CREATE OR REPLACE FUNCTION public.get_user_role(org_id uuid)
--   RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path TO ''
--   AS $$
--     SELECT role FROM public.members
--     WHERE organisation_id = org_id AND user_id = (SELECT auth.uid())
--     LIMIT 1;
--   $$;
--
--   CREATE OR REPLACE FUNCTION public.get_user_permission(org_id uuid, permission_key text)
--   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path TO ''
--   AS $$
--     SELECT coalesce((permissions->>permission_key)::boolean, false)
--     FROM public.members
--     WHERE organisation_id = org_id AND user_id = (SELECT auth.uid())
--     LIMIT 1;
--   $$;

-- ---------------------------------------------------------------------------
-- 1. get_user_role — sourced from rights_profiles.rank
-- ---------------------------------------------------------------------------
-- Rank enum: employee | manager | hr | admin
-- Returned text values kept as 'employee' | 'admin' so existing
-- RLS `in ('admin','owner')` and `in ('employee','admin','owner')`
-- checks continue to gate correctly.

create or replace function public.get_user_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p.rank = 'employee' then 'employee'
    else 'admin'
  end
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 2. get_user_permission — sourced from rights_profiles flags
-- ---------------------------------------------------------------------------
-- Maps the legacy permission keys still consulted by RLS + get_org_members.

create or replace function public.get_user_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case permission_key
    when 'can_view_all_teams'      then p.cross_user_access = 'all'
    when 'can_view_team_members'   then p.cross_user_access in ('team', 'all')
    when 'can_see_currency'        then p.can_view_sensitive_fields
    when 'can_add_members'         then (p.can_create_users or p.can_invite_users)
    when 'can_manage_members'      then p.cross_user_access <> 'self'
    when 'can_approve_holidays'    then p.can_approve_holidays
    when 'can_define_custom_fields' then p.can_edit_org_settings
    when 'can_request_holidays'    then true
    when 'can_edit_organisation'   then p.can_edit_org_settings
    else false
  end
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewrite the single `get_user_role(...) = 'owner'` RLS policy
-- ---------------------------------------------------------------------------
-- Original: holiday_bookings DELETE, gated on caller being the org
-- Owner. Under the flat model there is no Owner; the equivalent
-- intent is "any Admin-rank member". Reassign to the same intent.

drop policy if exists "holiday_bookings_delete_owner" on public.holiday_bookings;
create policy "holiday_bookings_delete_admin"
  on public.holiday_bookings for delete
  using (
    get_user_role(organisation_id) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 4. Rewrite notice_period_profiles RLS policies (direct role='owner')
-- ---------------------------------------------------------------------------
-- These read `members.role` directly rather than via get_user_role.
-- Rewritten to join through rights_profiles + check Admin rank.

drop policy if exists notice_period_profiles_insert on public.notice_period_profiles;
create policy notice_period_profiles_insert on public.notice_period_profiles
  for insert to authenticated
  with check (
    organisation_id in (
      select m.organisation_id
      from public.members m
      join public.rights_profiles p on p.id = m.rights_profile_id
      where m.user_id = auth.uid() and p.rank = 'admin'
    )
  );

drop policy if exists notice_period_profiles_update on public.notice_period_profiles;
create policy notice_period_profiles_update on public.notice_period_profiles
  for update to authenticated
  using (
    organisation_id in (
      select m.organisation_id
      from public.members m
      join public.rights_profiles p on p.id = m.rights_profile_id
      where m.user_id = auth.uid() and p.rank = 'admin'
    )
  )
  with check (
    organisation_id in (
      select m.organisation_id
      from public.members m
      join public.rights_profiles p on p.id = m.rights_profile_id
      where m.user_id = auth.uid() and p.rank = 'admin'
    )
  );

drop policy if exists notice_period_profiles_delete on public.notice_period_profiles;
create policy notice_period_profiles_delete on public.notice_period_profiles
  for delete to authenticated
  using (
    is_default = false
    and organisation_id in (
      select m.organisation_id
      from public.members m
      join public.rights_profiles p on p.id = m.rights_profile_id
      where m.user_id = auth.uid() and p.rank = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Rewrite trigger_seed_approval_profile_assignments to detect Admin
--     via rights_profiles.rank rather than NEW.role.
-- ---------------------------------------------------------------------------
-- Original fires on members INSERT and, when NEW.role = 'owner',
-- seeds default Annual Leave approval profiles. Under Rights
-- Profiles v2, the "org owner" heuristic is replaced by "the first
-- member on the Admin default profile in this tenant".

create or replace function public.trigger_seed_approval_profile_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_absence_type_id uuid;
  v_profile_id      uuid;
  v_is_admin_rank   boolean := false;
  v_first_admin_of_org boolean := false;
begin
  if NEW.rights_profile_id is null then
    return NEW;
  end if;

  -- Is the newly-inserted Member on an Admin-rank profile?
  select p.rank = 'admin'
    into v_is_admin_rank
    from public.rights_profiles p
    where p.id = NEW.rights_profile_id;

  if not v_is_admin_rank then
    return NEW;
  end if;

  -- Are they the first Admin-rank Member in this tenant? Only then
  -- seed the org-level defaults. (Prevents re-seeding when additional
  -- admins are added later.)
  select not exists (
    select 1
    from public.members m2
    join public.rights_profiles p2 on p2.id = m2.rights_profile_id
    where m2.organisation_id = NEW.organisation_id
      and m2.id <> NEW.id
      and p2.rank = 'admin'
  ) into v_first_admin_of_org;

  if not v_first_admin_of_org then
    return NEW;
  end if;

  -- Seed the default Annual Leave approval profile (identical body
  -- to the original trigger, minus the NEW.role branch).
  select id into v_absence_type_id
    from public.absence_types
    where organisation_id = NEW.organisation_id
      and is_default = true
      and name = 'Annual Leave'
    limit 1;

  if v_absence_type_id is null then
    return NEW;
  end if;

  select id into v_profile_id
    from public.approval_profiles
    where organisation_id = NEW.organisation_id
      and absence_type_id = v_absence_type_id
      and is_default = true
    limit 1;

  if v_profile_id is null then
    insert into public.approval_profiles (organisation_id, absence_type_id, name, is_default)
    values (NEW.organisation_id, v_absence_type_id, 'Default', true)
    returning id into v_profile_id;
  end if;

  -- Ensure a Level 1 with the new Admin as main approver.
  if not exists (
    select 1 from public.approval_profile_levels
    where profile_id = v_profile_id and level = 1
  ) then
    insert into public.approval_profile_levels
      (profile_id, level, length_threshold_days, length_threshold_hours,
       main_approver_ids, delegate_approver_ids)
    values
      (v_profile_id, 1, null, null, array[NEW.id]::uuid[], '{}'::uuid[]);
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Follow-up work — NOT included in this migration:
-- ---------------------------------------------------------------------------
--   - get_org_members still reads members.role and joins admin_profiles /
--     employee_profiles for the profile_name output. Rewrite in a
--     follow-up migration to source profile_name from rights_profiles.name
--     and to derive caller_role from the rank mapping above. Tracked as
--     CLE-201c-4 (#67).
--   - Once get_org_members is rewritten AND app-side is verified in
--     staging, drop members.role, members.permissions,
--     members.admin_profile_id, members.employee_profile_id, and the
--     admin_profiles / employee_profiles tables. Tracked as CLE-201c-9 (#72).
