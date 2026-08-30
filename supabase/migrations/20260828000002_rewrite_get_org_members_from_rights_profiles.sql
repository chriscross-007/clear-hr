-- CLE-201c-4 — Rewrite get_org_members to source from rights_profiles.
--
-- Same 15-column return shape so no downstream consumer (page.tsx,
-- reports, PDF exporter) needs to change. The `role` output collapses
-- to 'employee' | 'admin' (same rule as get_user_role rewritten in
-- 20260828000001). `profile_name` sourced from rights_profiles.name.
-- Team visibility gated by rights_profiles.cross_user_access
-- ('self' / 'team' / 'all') — the legacy 'selected' scope from
-- `members.permissions.object_access.teams` has no v2 equivalent
-- and is dropped (same decision the app layer made in CLE-196b).
--
-- Preserves SET search_path TO 'public' so unqualified names inside
-- the function body resolve correctly (matches the original body's
-- convention).

create or replace function public.get_org_members()
returns table(
  member_id uuid, user_id uuid, first_name text, last_name text,
  email text, role text, invited_at timestamp with time zone,
  accepted_at timestamp with time zone, team_id uuid,
  last_log_in timestamp with time zone, payroll_number text,
  profile_name text, custom_fields jsonb, avatar_url text,
  updated_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  caller_id uuid;
  caller_org_id uuid;
  caller_member_id uuid;
  caller_team_id uuid;
  caller_cross_user_access text;
  caller_can_view_sensitive boolean;
  currency_keys text[];
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Resolve caller's Member row + their profile flags. LEFT JOIN so a
  -- member with a NULL rights_profile_id still gets a row here (fails
  -- safe to self-scope + no sensitive access).
  select
    m.id,
    m.organisation_id,
    m.team_id,
    coalesce(rp.cross_user_access, 'self'),
    coalesce(rp.can_view_sensitive_fields, false)
  into
    caller_member_id,
    caller_org_id,
    caller_team_id,
    caller_cross_user_access,
    caller_can_view_sensitive
  from public.members m
  left join public.rights_profiles rp on rp.id = m.rights_profile_id
  where m.user_id = caller_id
  limit 1;

  if caller_org_id is null then
    raise exception 'No organisation membership found';
  end if;

  -- Currency-field redaction — same behaviour as before, now gated
  -- by rights_profile.can_view_sensitive_fields.
  if not caller_can_view_sensitive then
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
    -- `role` output collapses to 'employee' | 'admin'. Non-employee
    -- ranks (manager/hr/admin) all render as 'admin' so consumers
    -- doing `.role in ('admin','owner')` continue to see them.
    case
      when rp.rank is null then 'employee'
      when rp.rank = 'employee' then 'employee'
      else 'admin'
    end as role,
    m.invited_at,
    m.accepted_at,
    m.team_id,
    m.last_log_in,
    m.payroll_number,
    rp.name as profile_name,
    case
      when caller_can_view_sensitive then m.custom_fields
      else coalesce(
        (select jsonb_object_agg(key, value)
         from jsonb_each(m.custom_fields)
         where not (key = any(coalesce(currency_keys, array[]::text[])))),
        '{}'::jsonb)
    end as custom_fields,
    m.avatar_url,
    m.updated_at
  from public.members m
  left join public.rights_profiles rp on rp.id = m.rights_profile_id
  where m.organisation_id = caller_org_id
    and (
      public.is_superuser()
      or caller_cross_user_access = 'all'
      or (
        caller_cross_user_access = 'team'
        and caller_team_id is not null
        and m.team_id = caller_team_id
      )
      or (
        caller_cross_user_access = 'self'
        and m.user_id = caller_id
      )
    )
  order by m.first_name, m.last_name;
end;
$function$;
