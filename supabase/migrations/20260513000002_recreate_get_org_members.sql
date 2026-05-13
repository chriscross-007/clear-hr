-- Migration: Recreate get_org_members without member_teams (CLE-185 follow-up)
--
-- The CLE-185 migration dropped the member_teams junction. The
-- `get_org_members` RPC (authored via Supabase MCP, not in repo) still
-- referenced member_teams in two places inside its team-access WHERE
-- clause — for the `scope = 'own'` branch and for the legacy
-- `scope IS NULL` fallback. At runtime those subqueries error out, the
-- RPC returns nothing, and the Employee Directory silently shows empty.
--
-- Both member_teams subqueries are now replaced with a direct compare
-- against the caller's single `caller_team_id` (already resolved at the
-- top of the function). Owner / superuser / employee branches are
-- unchanged.

create or replace function public.get_org_members()
returns table (
  member_id       uuid,
  user_id         uuid,
  first_name      text,
  last_name       text,
  email           text,
  role            text,
  invited_at      timestamptz,
  accepted_at     timestamptz,
  team_id         uuid,
  last_log_in     timestamptz,
  payroll_number  text,
  profile_name    text,
  custom_fields   jsonb,
  avatar_url      text,
  updated_at      timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  caller_id uuid;
  caller_org_id uuid;
  caller_role text;
  caller_member_id uuid;
  caller_team_id uuid;
  can_view_all boolean;
  can_view_team boolean;
  can_see_currency boolean;
  currency_keys text[];
  team_access_scope text;
  allowed_team_ids uuid[];
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  select m.id, m.organisation_id, m.role, m.team_id
  into caller_member_id, caller_org_id, caller_role, caller_team_id
  from public.members m
  where m.user_id = caller_id
  limit 1;
  if caller_org_id is null then
    raise exception 'No organisation membership found';
  end if;
  can_view_all := public.get_user_permission(caller_org_id, 'can_view_all_teams');
  can_view_team := public.get_user_permission(caller_org_id, 'can_view_team_members');
  can_see_currency := caller_role = 'owner' or public.get_user_permission(caller_org_id, 'can_see_currency');
  -- Read object_access.teams scope for admin callers
  select
    m.permissions->'object_access'->'teams'->>'scope',
    array(
      select (elem#>>'{}')::uuid
      from jsonb_array_elements(
        coalesce(m.permissions->'object_access'->'teams'->'ids', '[]'::jsonb)
      ) elem
    )
  into team_access_scope, allowed_team_ids
  from public.members m
  where m.id = caller_member_id;
  if not can_see_currency then
    select array_agg(field_key) into currency_keys
    from public.custom_field_definitions
    where organisation_id = caller_org_id
      and object_type = 'member'
      and field_type = 'currency';
  end if;
  return query
  select
    m.id as member_id,
    m.user_id,
    m.first_name,
    m.last_name,
    m.email,
    m.role,
    m.invited_at,
    m.accepted_at,
    m.team_id,
    m.last_log_in,
    m.payroll_number,
    case
      when m.role in ('admin', 'owner') then ap.name
      else ep.name
    end as profile_name,
    case
      when can_see_currency then m.custom_fields
      else coalesce(
        (select jsonb_object_agg(key, value)
         from jsonb_each(m.custom_fields)
         where not (key = any(coalesce(currency_keys, array[]::text[])))),
        '{}'::jsonb
      )
    end as custom_fields,
    m.avatar_url,
    m.updated_at
  from public.members m
  left join public.admin_profiles ap on ap.id = m.admin_profile_id
  left join public.employee_profiles ep on ep.id = m.employee_profile_id
  where m.organisation_id = caller_org_id
    and (
      caller_role = 'owner'
      or public.is_superuser()
      or (caller_role = 'admin' and (
        (team_access_scope = 'all')
        or (team_access_scope = 'selected'
            and array_length(allowed_team_ids, 1) > 0
            and m.team_id = any(allowed_team_ids))
        -- CLE-185 — single team per member, so "own" is just the
        -- caller's `members.team_id` (already loaded above). The old
        -- member_teams subquery is gone.
        or (team_access_scope = 'own'
            and caller_team_id is not null
            and m.team_id = caller_team_id)
        -- Legacy fallback when an admin has no object_access set —
        -- behave like the original: either can_view_all globally, or
        -- restrict to the caller's own team.
        or (team_access_scope is null and (
          can_view_all
          or (caller_team_id is not null and m.team_id = caller_team_id)
        ))
      ))
      or (caller_role = 'employee' and (
        m.user_id = caller_id
        or (can_view_team and m.team_id = caller_team_id)
      ))
    )
  order by m.first_name, m.last_name;
end;
$$;
