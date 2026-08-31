-- CLE-201c-9 + CLE-201c-10 — legacy identity/authorisation cleanup,
-- reduced scope. What lands here is only what can drop cleanly
-- against current prod state.
--
-- Ships in this migration:
--   • members.admin_profile_id  — dropped
--   • members.employee_profile_id — dropped
--   • RPC bulk_update_members   — CREATE OR REPLACE, p_role parameter removed
--   • trigger trigger_assign_default_rights_profile — ensured (creates if missing)
--
-- Deferred to CLE-201d (blocked on policy rewrites):
--   • members.role, members.permissions — still read by 22 RLS
--     policies that source them directly rather than via
--     get_user_role. Dropping requires either CASCADE (silently
--     deletes the policies, opens RLS holes) or rewriting each
--     policy first onto rights_profiles.rank. Doing the rewrites
--     properly is CLE-201d.
--   • admin_profiles / employee_profiles tables — blocked by policies
--     on those tables that still reference members.role.
--   • get_user_role / get_user_permission functions — still called by
--     ~30 RLS policies; dropped when CLE-201d rewires them onto the
--     flag-based helpers (has_rights_flag / get_cross_user_access /
--     get_effective_tab_update from 20260828000003).
--
-- Pre-flight expectations:
--   • App has stopped writing role/permissions (same commit).
--   • Path B flag-based RLS is live (20260828000003).
--   • get_user_role + get_user_permission were rewritten to source
--     from rights_profiles in 20260828000001, so they don't touch
--     the members.role/permissions columns even though ~30 policies
--     still call them.
--   • get_org_members was rewritten in 20260828000002.
--   • Every member has a valid rights_profile_id (double-checked below).

begin;

-- ---------------------------------------------------------------------------
-- 0. Defensive check — abort if any member is still unassigned.
-- ---------------------------------------------------------------------------
do $$
declare
  orphan_count int;
begin
  select count(*) into orphan_count
  from public.members
  where rights_profile_id is null;

  if orphan_count > 0 then
    raise exception
      'CLE-201c-9 abort: % member(s) have NULL rights_profile_id. Assign them to a profile before running this migration.',
      orphan_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Ensure the assign-default-profile trigger exists. The app's
--    addEmployee / backup restore paths rely on the trigger to seed
--    rights_profile_id when the insert doesn't specify one.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_assign_default_rights_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_profile_id uuid;
begin
  if new.rights_profile_id is not null then
    return new;
  end if;

  select id into default_profile_id
  from public.rights_profiles
  where organisation_id = new.organisation_id
    and is_default = true
    and rank = 'employee'
  limit 1;

  if default_profile_id is null then
    select id into default_profile_id
    from public.rights_profiles
    where organisation_id = new.organisation_id
      and is_default = true
    order by sort_order asc, name asc
    limit 1;
  end if;

  if default_profile_id is null then
    raise exception
      'CLE-201c-9: no default rights profile found for organisation %. Cannot insert member without an explicit rights_profile_id.',
      new.organisation_id;
  end if;

  new.rights_profile_id := default_profile_id;
  return new;
end;
$$;

drop trigger if exists trg_assign_default_rights_profile on public.members;
create trigger trg_assign_default_rights_profile
before insert on public.members
for each row
execute function public.trigger_assign_default_rights_profile();

-- ---------------------------------------------------------------------------
-- 2. Rewrite bulk_update_members without the p_role parameter. The
--    old 5-arg signature is dropped explicitly so a stale app call
--    fails loudly rather than silently ignoring the change.
-- ---------------------------------------------------------------------------
drop function if exists public.bulk_update_members(uuid[], uuid, uuid, text, jsonb);

create or replace function public.bulk_update_members(
  p_member_ids uuid[],
  p_org_id uuid,
  p_team_id uuid,
  p_custom_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_team_id is not null or p_custom_fields is not null then
    update public.members m
    set
      team_id = coalesce(p_team_id, m.team_id),
      custom_fields = case
        when p_custom_fields is null then m.custom_fields
        else coalesce(m.custom_fields, '{}'::jsonb) || p_custom_fields
      end,
      updated_at = now()
    where m.id = any(p_member_ids)
      and m.organisation_id = p_org_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Drop the legacy profile-assignment pointer columns on members.
--    Safe because no page selects them any more and no RLS policy or
--    trigger references them.
-- ---------------------------------------------------------------------------
alter table public.members
  drop column if exists admin_profile_id,
  drop column if exists employee_profile_id;

-- ---------------------------------------------------------------------------
-- 4. Bridge the still-existing role + permissions columns so app
--    inserts that no longer specify them don't fail on NOT NULL.
--    Once CLE-201d rewrites the 22 policies and drops these columns,
--    these defaults become moot. Belt-and-braces `drop not null`
--    covers legacy schemas where the column was NOT NULL without
--    a default; no-op on schemas that already permit NULL.
-- ---------------------------------------------------------------------------
alter table public.members
  alter column role drop not null,
  alter column role set default 'employee',
  alter column permissions drop not null,
  alter column permissions set default '{}'::jsonb;

commit;
