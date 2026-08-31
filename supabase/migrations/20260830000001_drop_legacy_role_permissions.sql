-- CLE-201c-9 + CLE-201c-10 — Drop the legacy identity/authorisation
-- surface that Rights Profiles v2 replaced.
--
-- What lands in this migration:
--   • members.role              — dropped
--   • members.permissions       — dropped
--   • members.admin_profile_id  — dropped
--   • members.employee_profile_id — dropped
--   • table admin_profiles      — dropped
--   • table employee_profiles   — dropped
--   • function get_user_role    — dropped (no longer read anywhere)
--   • function get_user_permission — dropped
--   • RPC bulk_update_members   — CREATE OR REPLACE with the p_role parameter removed
--   • trigger trigger_assign_default_rights_profile — ensured (creates if missing)
--
-- Pre-flight expectations:
--   • App has already stopped writing role/permissions (this commit).
--   • Path B flag-based RLS is live (migration 20260828000003) so no
--     policy still calls get_user_role / get_user_permission.
--   • get_org_members was rewritten in 20260828000002 to source
--     "rank" from rights_profiles.rank rather than members.role.
--   • Every member has a valid rights_profile_id (CLE-196a foundation
--     migration assigned defaults). This migration double-checks.

begin;

-- ---------------------------------------------------------------------------
-- 0. Defensive check — abort if any member is still unassigned. This
--    would otherwise silently strand the row without an access
--    profile, which the resolver treats as read-only-self-only.
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
-- 1. Ensure the assign-default-profile trigger exists on members. The
--    app's addEmployee / backup restore paths rely on the trigger to
--    seed rights_profile_id when the insert doesn't specify one.
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

  -- Prefer the org's seeded Employee default (rank='employee', is_default=true).
  -- Fall back to any is_default profile if the specific rank isn't
  -- there (paranoid — every seeded org has all four defaults).
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
--    fails loudly rather than silently ignoring the role change.
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
-- 3. Drop legacy DB helpers. Both were rewritten in 20260828000001 to
--    source from rights_profiles.rank; nothing calls them any more
--    (all RLS now uses the flag-based helpers from 20260828000003).
-- ---------------------------------------------------------------------------
drop function if exists public.get_user_role(uuid);
drop function if exists public.get_user_permission(uuid, text);

-- ---------------------------------------------------------------------------
-- 4. Drop the legacy profile-assignment FKs and pointer columns on
--    members. Safe because no page selects them any more (verified in
--    the app-side cleanup that lands with this migration).
-- ---------------------------------------------------------------------------
alter table public.members
  drop column if exists admin_profile_id,
  drop column if exists employee_profile_id;

-- ---------------------------------------------------------------------------
-- 5. Drop the legacy role + permissions columns on members. Every
--    access decision has been on rights_profile_id for a while; this
--    is the final step to make the schema match the runtime truth.
-- ---------------------------------------------------------------------------
alter table public.members
  drop column if exists role,
  drop column if exists permissions;

-- ---------------------------------------------------------------------------
-- 6. Drop the vestigial profile tables. Their content has no reader.
-- ---------------------------------------------------------------------------
drop table if exists public.admin_profiles cascade;
drop table if exists public.employee_profiles cascade;

commit;
