-- ============================================================================
-- Rollback for CLE-201c migration
-- ---------------------------------------------------------------------------
-- Reverts everything applied by
--   supabase/migrations/20260828000001_rewrite_rls_helpers_from_rights_profiles.sql
-- back to the pre-migration state.
--
-- IMPORTANT: run steps 0 (preflight) BEFORE applying the CLE-201c migration.
--            Steps 1-5 (the actual rollback) run AFTER, only if something breaks.
--
-- Safe to run more than once — every statement is idempotent (CREATE OR REPLACE
-- FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY).
-- ============================================================================


-- ============================================================================
-- STEP 0 — PREFLIGHT: run this BEFORE the CLE-201c migration
-- ---------------------------------------------------------------------------
-- Captures the current trigger_seed_approval_profile_assignments body so the
-- rollback in Step 5 has something to restore. The two helpers' original
-- bodies + the four RLS policies' original bodies are already hardcoded below
-- (Steps 1-4) — those don't need a preflight snapshot.
--
-- Run this in Supabase Studio's SQL editor, copy the returned text, and save
-- it somewhere you can find it (e.g. paste-it into this file below the
-- placeholder in Step 5).
--
-- SELECT pg_get_functiondef(oid)
-- FROM pg_proc
-- WHERE proname = 'trigger_seed_approval_profile_assignments'
--   AND pronamespace = 'public'::regnamespace;
--
-- ============================================================================


-- ============================================================================
-- STEP 1 — Restore get_user_role
-- ============================================================================

create or replace function public.get_user_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select role from public.members
  where organisation_id = org_id and user_id = (select auth.uid())
  limit 1;
$$;


-- ============================================================================
-- STEP 2 — Restore get_user_permission
-- ============================================================================

create or replace function public.get_user_permission(org_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (permissions->>permission_key)::boolean,
    false
  )
  from public.members
  where organisation_id = org_id and user_id = (select auth.uid())
  limit 1;
$$;


-- ============================================================================
-- STEP 3 — Restore holiday_bookings_delete_owner policy
-- ---------------------------------------------------------------------------
-- Drops the new "_delete_admin" policy the migration installed and recreates
-- the original "_delete_owner" policy that checks get_user_role = 'owner'.
-- ============================================================================

drop policy if exists "holiday_bookings_delete_admin" on public.holiday_bookings;
create policy "holiday_bookings_delete_owner"
  on public.holiday_bookings for delete
  using (
    get_user_role(organisation_id) = 'owner'
  );


-- ============================================================================
-- STEP 4 — Restore the three notice_period_profiles policies
-- ---------------------------------------------------------------------------
-- Drops the rewritten policies (which join through rights_profiles.rank) and
-- recreates the originals (which read members.role directly).
-- ============================================================================

drop policy if exists notice_period_profiles_insert on public.notice_period_profiles;
create policy notice_period_profiles_insert on public.notice_period_profiles
  for insert to authenticated
  with check (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy if exists notice_period_profiles_update on public.notice_period_profiles;
create policy notice_period_profiles_update on public.notice_period_profiles
  for update to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy if exists notice_period_profiles_delete on public.notice_period_profiles;
create policy notice_period_profiles_delete on public.notice_period_profiles
  for delete to authenticated
  using (
    is_default = false
    and organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );


-- ============================================================================
-- STEP 5 — Restore trigger_seed_approval_profile_assignments
-- ---------------------------------------------------------------------------
-- The migration replaced this trigger. To roll it back you need the ORIGINAL
-- function body captured in Step 0's preflight.
--
-- REPLACE THE BLOCK BELOW with the text `pg_get_functiondef` returned in
-- Step 0. That text is itself a `CREATE OR REPLACE FUNCTION ...` statement
-- and can be run verbatim.
--
-- If you did NOT run Step 0 and the trigger's behaviour needs restoring
-- urgently, contact Claude to reconstruct it from the migration file where
-- it was originally defined (supabase/migrations/20260509000001_holiday_approval_profiles.sql,
-- lines 300+). That definition matches the pre-CLE-201c state.
--
-- <<< PASTE THE PREFLIGHT SNAPSHOT HERE, e.g.:
--
-- CREATE OR REPLACE FUNCTION public.trigger_seed_approval_profile_assignments()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- ...
-- $function$;
--
-- >>>


-- ============================================================================
-- VERIFICATION QUERIES
-- ---------------------------------------------------------------------------
-- Run after applying the rollback to confirm everything is back to normal.
-- ============================================================================

-- Helper functions should reflect the restored bodies.
select pg_get_functiondef(oid)
from pg_proc
where proname in ('get_user_role', 'get_user_permission')
  and pronamespace = 'public'::regnamespace;

-- The four RLS policies should exist under their original names.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and (
    (tablename = 'holiday_bookings' and policyname = 'holiday_bookings_delete_owner')
    or (tablename = 'notice_period_profiles' and policyname in ('notice_period_profiles_insert','notice_period_profiles_update','notice_period_profiles_delete'))
  )
order by tablename, policyname;
