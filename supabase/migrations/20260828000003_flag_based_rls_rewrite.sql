-- CLE-201c-11 — Path B: rewrite every RLS policy to check
-- rights_profiles flags directly, ending the era of policies gated
-- on derived role labels. After this migration:
--
--   * every policy that was `get_user_role(org) in ('admin','owner')`
--     checks the specific flag that captures its intent
--     (can_edit_org_settings / can_approve_holidays / etc.)
--   * every policy that was `role='owner'` (direct member column read)
--     is rewritten the same way
--   * two thin helpers (`has_rights_flag`, `get_cross_user_access`)
--     replace `get_user_permission` at the call sites; the legacy
--     helpers stay in place as bridges for rollback safety
--   * one new flag column `can_manage_holiday_bookings` gates
--     admin-edit + admin-delete on holiday_bookings (a booking is a
--     confirmed leave, distinct from a request)
--   * `trigger_seed_approval_profile_assignments` is retuned to
--     check `can_edit_org_settings` instead of rank
--
-- Rollback strategy: the original policies live in migrations
-- 20260401000001 .. 20260517000001. If rollback is needed, drop the
-- policies this migration creates (all DROP POLICY IF EXISTS syntax)
-- and re-run the CREATE POLICY blocks from the original files. The
-- legacy helpers get_user_role + get_user_permission stay in place so
-- the original policies work verbatim.

-- ---------------------------------------------------------------------------
-- 1. New flag column: can_manage_holiday_bookings
-- ---------------------------------------------------------------------------
alter table public.rights_profiles
  add column if not exists can_manage_holiday_bookings boolean not null default false;

-- Seed defaults: on for Admin, off for HR / Manager / Employee.
update public.rights_profiles set can_manage_holiday_bookings = true
 where is_default = true and rank = 'admin';

-- ---------------------------------------------------------------------------
-- 2. New helper: has_rights_flag
-- ---------------------------------------------------------------------------
create or replace function public.has_rights_flag(org_id uuid, flag_name text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case flag_name
    when 'can_create_users'            then p.can_create_users
    when 'can_invite_users'            then p.can_invite_users
    when 'can_delete_users'            then p.can_delete_users
    when 'can_approve_holidays'        then p.can_approve_holidays
    when 'can_override_holiday_rules'  then p.can_override_holiday_rules
    when 'can_run_reports'             then p.can_run_reports
    when 'can_run_admin_reports'       then p.can_run_admin_reports
    when 'can_manage_teams'            then p.can_manage_teams
    when 'can_edit_org_settings'       then p.can_edit_org_settings
    when 'can_edit_rights_profiles'    then p.can_edit_rights_profiles
    when 'can_manage_billing'          then p.can_manage_billing
    when 'can_view_audit_logs'         then p.can_view_audit_logs
    when 'can_view_sensitive_fields'   then p.can_view_sensitive_fields
    when 'can_edit_sensitive_fields'   then p.can_edit_sensitive_fields
    when 'can_manage_holiday_bookings' then p.can_manage_holiday_bookings
    else false
  end
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. New helper: get_cross_user_access
-- ---------------------------------------------------------------------------
create or replace function public.get_cross_user_access(org_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(p.cross_user_access, 'self')
  from public.members m
  left join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3a. New helper: get_effective_tab_update
-- ---------------------------------------------------------------------------
-- Defined here (with the other helpers) so it exists before any policy
-- below tries to call it.
create or replace function public.get_effective_tab_update(org_id uuid, tab_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((p.tab_matrix->tab_key->>'update')::boolean, false)
  from public.members m
  join public.rights_profiles p on p.id = m.rights_profile_id
  where m.organisation_id = org_id
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Org-config tables — writes gated by can_edit_org_settings
-- ---------------------------------------------------------------------------

-- absence_types (reads: any org member; writes: can_edit_org_settings)
drop policy if exists absence_types_insert on public.absence_types;
drop policy if exists absence_types_update on public.absence_types;
drop policy if exists absence_types_delete on public.absence_types;
create policy absence_types_insert on public.absence_types
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy absence_types_update on public.absence_types
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy absence_types_delete on public.absence_types
  for delete to authenticated
  using (
    is_default = false
    and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
  );

-- absence_reasons
drop policy if exists absence_reasons_insert on public.absence_reasons;
drop policy if exists absence_reasons_update on public.absence_reasons;
drop policy if exists absence_reasons_delete on public.absence_reasons;
create policy absence_reasons_insert on public.absence_reasons
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy absence_reasons_update on public.absence_reasons
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy absence_reasons_delete on public.absence_reasons
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- bank_holidays
drop policy if exists bank_holidays_insert on public.bank_holidays;
drop policy if exists bank_holidays_update on public.bank_holidays;
drop policy if exists bank_holidays_delete on public.bank_holidays;
create policy bank_holidays_insert on public.bank_holidays
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy bank_holidays_update on public.bank_holidays
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy bank_holidays_delete on public.bank_holidays
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- work_profiles (writes gated; reads = org membership, handled by existing _select_org policy which we drop the admin/owner check from below)
drop policy if exists work_profiles_insert on public.work_profiles;
drop policy if exists work_profiles_update on public.work_profiles;
drop policy if exists work_profiles_delete on public.work_profiles;
create policy work_profiles_insert on public.work_profiles
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy work_profiles_update on public.work_profiles
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy work_profiles_delete on public.work_profiles
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));

-- notice_period_profiles (rewrite the rank-based version from 20260828000001)
drop policy if exists notice_period_profiles_insert on public.notice_period_profiles;
drop policy if exists notice_period_profiles_update on public.notice_period_profiles;
drop policy if exists notice_period_profiles_delete on public.notice_period_profiles;
create policy notice_period_profiles_insert on public.notice_period_profiles
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy notice_period_profiles_update on public.notice_period_profiles
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy notice_period_profiles_delete on public.notice_period_profiles
  for delete to authenticated
  using (
    is_default = false
    and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
  );

-- holiday_profiles (still using direct role='owner' — first rewrite)
drop policy if exists holiday_profiles_insert on public.holiday_profiles;
drop policy if exists holiday_profiles_update on public.holiday_profiles;
drop policy if exists holiday_profiles_delete on public.holiday_profiles;
create policy holiday_profiles_insert on public.holiday_profiles
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy holiday_profiles_update on public.holiday_profiles
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy holiday_profiles_delete on public.holiday_profiles
  for delete to authenticated
  using (
    is_default = false
    and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
  );

-- approval_profiles
drop policy if exists approval_profiles_insert on public.approval_profiles;
drop policy if exists approval_profiles_update on public.approval_profiles;
drop policy if exists approval_profiles_delete on public.approval_profiles;
create policy approval_profiles_insert on public.approval_profiles
  for insert to authenticated
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy approval_profiles_update on public.approval_profiles
  for update to authenticated
  using (public.has_rights_flag(organisation_id, 'can_edit_org_settings'))
  with check (public.has_rights_flag(organisation_id, 'can_edit_org_settings'));
create policy approval_profiles_delete on public.approval_profiles
  for delete to authenticated
  using (
    is_default = false
    and public.has_rights_flag(organisation_id, 'can_edit_org_settings')
  );

-- approval_profile_levels (parent's org drives the gate)
drop policy if exists approval_profile_levels_insert on public.approval_profile_levels;
drop policy if exists approval_profile_levels_update on public.approval_profile_levels;
drop policy if exists approval_profile_levels_delete on public.approval_profile_levels;
create policy approval_profile_levels_insert on public.approval_profile_levels
  for insert to authenticated
  with check (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = profile_id
        and public.has_rights_flag(ap.organisation_id, 'can_edit_org_settings')
    )
  );
create policy approval_profile_levels_update on public.approval_profile_levels
  for update to authenticated
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = profile_id
        and public.has_rights_flag(ap.organisation_id, 'can_edit_org_settings')
    )
  )
  with check (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = profile_id
        and public.has_rights_flag(ap.organisation_id, 'can_edit_org_settings')
    )
  );
create policy approval_profile_levels_delete on public.approval_profile_levels
  for delete to authenticated
  using (
    exists (
      select 1 from public.approval_profiles ap
      where ap.id = profile_id
        and public.has_rights_flag(ap.organisation_id, 'can_edit_org_settings')
    )
  );

-- ---------------------------------------------------------------------------
-- 5. members — cross-user visibility
-- ---------------------------------------------------------------------------
-- The existing "Admins can read all org members" policy checked
-- role='admin' (excluded 'owner' by legacy oversight). Rewrite to
-- cross_user_access <> 'self'; sibling policy for self-scope stays.

drop policy if exists "Admins can read all org members" on public.members;
create policy "Cross-user read all org members" on public.members
  for select to authenticated
  using (
    organisation_id in (
      select m2.organisation_id from public.members m2
      where m2.user_id = auth.uid()
    )
    and public.get_cross_user_access(organisation_id) <> 'self'
  );

-- ---------------------------------------------------------------------------
-- 6. employee_work_profiles — tab_matrix.employment.update
-- ---------------------------------------------------------------------------
-- Chris's call: per-Member employment writes gate on the tab matrix,
-- not can_edit_org_settings. Reads gate on org membership + cross-user.

drop policy if exists employee_work_profiles_select on public.employee_work_profiles;
drop policy if exists employee_work_profiles_insert on public.employee_work_profiles;
drop policy if exists employee_work_profiles_update on public.employee_work_profiles;
drop policy if exists employee_work_profiles_delete on public.employee_work_profiles;

create policy employee_work_profiles_select on public.employee_work_profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and (
          m.user_id = auth.uid()  -- self
          or public.get_cross_user_access(m.organisation_id) <> 'self'
        )
    )
  );
create policy employee_work_profiles_insert on public.employee_work_profiles
  for insert to authenticated
  with check (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and (public.get_effective_tab_update(m.organisation_id, 'employment'))
    )
  );
create policy employee_work_profiles_update on public.employee_work_profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and public.get_effective_tab_update(m.organisation_id, 'employment')
    )
  );
create policy employee_work_profiles_delete on public.employee_work_profiles
  for delete to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and public.get_effective_tab_update(m.organisation_id, 'employment')
    )
  );

-- (get_effective_tab_update helper is defined in §3a, above.)

-- ---------------------------------------------------------------------------
-- 7. holiday_periods — tab_matrix.holiday.update
-- ---------------------------------------------------------------------------

drop policy if exists holiday_periods_select on public.holiday_periods;
drop policy if exists holiday_periods_insert on public.holiday_periods;
drop policy if exists holiday_periods_update on public.holiday_periods;
drop policy if exists holiday_periods_delete on public.holiday_periods;

create policy holiday_periods_select on public.holiday_periods
  for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and (
          m.user_id = auth.uid()  -- self
          or public.get_cross_user_access(m.organisation_id) <> 'self'
        )
    )
  );
create policy holiday_periods_insert on public.holiday_periods
  for insert to authenticated
  with check (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and public.get_effective_tab_update(m.organisation_id, 'holiday')
    )
  );
create policy holiday_periods_update on public.holiday_periods
  for update to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and public.get_effective_tab_update(m.organisation_id, 'holiday')
    )
  );
create policy holiday_periods_delete on public.holiday_periods
  for delete to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id
        and public.get_effective_tab_update(m.organisation_id, 'holiday')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. holiday_bookings — split update + delete on can_manage_holiday_bookings
-- ---------------------------------------------------------------------------
-- Read: own OR cross_user_access <> 'self'
-- Insert: own (existing employee policy)
-- Update: can_approve_holidays OR can_manage_holiday_bookings
--   (approver approves a booking, or admin edits confirmed booking)
-- Delete: can_manage_holiday_bookings

drop policy if exists holiday_bookings_select_org on public.holiday_bookings;
drop policy if exists holiday_bookings_update_org on public.holiday_bookings;
drop policy if exists holiday_bookings_delete_admin on public.holiday_bookings;
drop policy if exists holiday_bookings_delete_owner on public.holiday_bookings;

create policy holiday_bookings_select_cross_user on public.holiday_bookings
  for select to authenticated
  using (public.get_cross_user_access(organisation_id) <> 'self');

create policy holiday_bookings_update_org on public.holiday_bookings
  for update to authenticated
  using (
    public.has_rights_flag(organisation_id, 'can_approve_holidays')
    or public.has_rights_flag(organisation_id, 'can_manage_holiday_bookings')
  );

create policy holiday_bookings_delete_manage on public.holiday_bookings
  for delete to authenticated
  using (public.has_rights_flag(organisation_id, 'can_manage_holiday_bookings'));

-- ---------------------------------------------------------------------------
-- 9. sick_booking_details — can_approve_holidays
-- ---------------------------------------------------------------------------

drop policy if exists sick_booking_details_select on public.sick_booking_details;
drop policy if exists sick_booking_details_insert on public.sick_booking_details;
drop policy if exists sick_booking_details_update on public.sick_booking_details;
drop policy if exists sick_booking_details_delete on public.sick_booking_details;

create policy sick_booking_details_select on public.sick_booking_details
  for select to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and (
          hb.member_id in (
            select m.id from public.members m where m.user_id = auth.uid()
          )
          or public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
        )
    )
  );
create policy sick_booking_details_insert on public.sick_booking_details
  for insert to authenticated
  with check (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );
create policy sick_booking_details_update on public.sick_booking_details
  for update to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );
create policy sick_booking_details_delete on public.sick_booking_details
  for delete to authenticated
  using (
    exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and public.has_rights_flag(hb.organisation_id, 'can_approve_holidays')
    )
  );

-- ---------------------------------------------------------------------------
-- 10. member_documents — tab_matrix.documents.update; reads cross-user
-- ---------------------------------------------------------------------------

drop policy if exists member_documents_select_org on public.member_documents;
drop policy if exists member_documents_insert_org on public.member_documents;
drop policy if exists member_documents_update_org on public.member_documents;
drop policy if exists member_documents_delete_org on public.member_documents;

create policy member_documents_select_org on public.member_documents
  for select to authenticated
  using (public.get_cross_user_access(organisation_id) <> 'self');
create policy member_documents_insert_org on public.member_documents
  for insert to authenticated
  with check (public.get_effective_tab_update(organisation_id, 'documents'));
create policy member_documents_update_org on public.member_documents
  for update to authenticated
  using (public.get_effective_tab_update(organisation_id, 'documents'));
create policy member_documents_delete_org on public.member_documents
  for delete to authenticated
  using (public.get_effective_tab_update(organisation_id, 'documents'));

-- ---------------------------------------------------------------------------
-- 11. conversations + conversation_messages — cross_user_access <> 'self'
-- ---------------------------------------------------------------------------

drop policy if exists conversations_select_org on public.conversations;
drop policy if exists conversations_insert_org on public.conversations;
drop policy if exists conversations_update_org on public.conversations;

create policy conversations_select_org on public.conversations
  for select to authenticated
  using (public.get_cross_user_access(organisation_id) <> 'self');
create policy conversations_insert_org on public.conversations
  for insert to authenticated
  with check (public.get_cross_user_access(organisation_id) <> 'self');
create policy conversations_update_org on public.conversations
  for update to authenticated
  using (public.get_cross_user_access(organisation_id) <> 'self');

drop policy if exists conversation_messages_select_org on public.conversation_messages;
drop policy if exists conversation_messages_insert_org on public.conversation_messages;

create policy conversation_messages_select_org on public.conversation_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.get_cross_user_access(c.organisation_id) <> 'self'
    )
  );
create policy conversation_messages_insert_org on public.conversation_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and public.get_cross_user_access(c.organisation_id) <> 'self'
    )
  );

-- ---------------------------------------------------------------------------
-- 12. booking_approvals — approver-list OR cross-user
-- ---------------------------------------------------------------------------
-- Keep the "listed approver" branch untouched. Replace the
-- admin/owner branch with cross_user_access <> 'self'.

drop policy if exists booking_approvals_select on public.booking_approvals;
create policy booking_approvals_select on public.booking_approvals
  for select to authenticated
  using (
    (select auth.uid()) = any (
      select m.user_id from public.members m
      where m.id = any (main_approver_ids)
         or m.id = any (delegate_approver_ids)
    )
    or exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and hb.member_id in (
          select m2.id from public.members m2 where m2.user_id = auth.uid()
        )
    )
    or exists (
      select 1 from public.holiday_bookings hb
      where hb.id = booking_id
        and public.get_cross_user_access(hb.organisation_id) <> 'self'
    )
  );

-- ---------------------------------------------------------------------------
-- 13. rights_profiles — writes gated by can_edit_rights_profiles
-- ---------------------------------------------------------------------------
-- Foundation migration made writes org-scoped only (any member could
-- write). Tighten to the meta-permission.

drop policy if exists rights_profiles_write_own_org on public.rights_profiles;
create policy rights_profiles_write_own_org on public.rights_profiles
  for all to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
    and public.has_rights_flag(organisation_id, 'can_edit_rights_profiles')
  )
  with check (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
    and public.has_rights_flag(organisation_id, 'can_edit_rights_profiles')
  );

-- ---------------------------------------------------------------------------
-- 14. trigger_seed_approval_profile_assignments — flag-based detection
-- ---------------------------------------------------------------------------

create or replace function public.trigger_seed_approval_profile_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_absence_type_id uuid;
  v_profile_id      uuid;
  v_is_admin_ish    boolean := false;
  v_first_of_org    boolean := false;
begin
  if NEW.rights_profile_id is null then
    return NEW;
  end if;

  -- Is the newly-inserted Member on a profile with can_edit_org_settings?
  -- (Path B intent: "administrative" is a flag, not a rank.)
  select p.can_edit_org_settings
    into v_is_admin_ish
    from public.rights_profiles p
    where p.id = NEW.rights_profile_id;

  if not coalesce(v_is_admin_ish, false) then
    return NEW;
  end if;

  -- First such Member in the tenant?
  select not exists (
    select 1
    from public.members m2
    join public.rights_profiles p2 on p2.id = m2.rights_profile_id
    where m2.organisation_id = NEW.organisation_id
      and m2.id <> NEW.id
      and p2.can_edit_org_settings = true
  ) into v_first_of_org;

  if not v_first_of_org then
    return NEW;
  end if;

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
-- 15. Follow-up notes (deliberately NOT included in this migration)
-- ---------------------------------------------------------------------------
--   * get_user_role and get_user_permission stay in place as bridges.
--     Drop them in a follow-up migration once you've watched Supabase
--     logs for a week and confirmed nothing calls them.
--   * get_org_members RPC still consults get_user_permission and reads
--     members.role. Rewrite (CLE-201c-4) can now proceed cleanly
--     against the flag-based world.
--   * Once both above are done, drop members.role + members.permissions
--     + members.admin_profile_id + members.employee_profile_id +
--     admin_profiles + employee_profiles (CLE-201c-9).
