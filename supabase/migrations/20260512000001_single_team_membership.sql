-- Migration: Single-team membership (CLE-185)
--
-- Earlier work introduced a `member_teams` junction table so admins/owners
-- could belong to multiple teams. Chris has decided the intended model is
-- simpler:
--
--   * Every member (employee, admin, owner) belongs to ONE team — the
--     single Team picker on Employment.
--   * Admins/owners can VIEW additional teams via the existing "Team
--     Access" setting on Admin Profiles
--     (`permissions.object_access.teams = { scope, ids }`), distinct from
--     membership.
--
-- This migration:
--   1. For any member currently in `member_teams`, sets `members.team_id`
--      to the lexically-first team (by team name). Their existing primary
--      `team_id` is overwritten so it's deterministic.
--   2. Patches `members.permissions.object_access.teams` to
--      `{ scope: 'selected', ids: <union of legacy team_id + every
--      member_teams row> }` for any admin who currently has access to >1
--      team — preserves the admin's existing viewing scope so nothing
--      disappears.
--   3. Drops the `member_teams` table.
--
-- Owners are implicitly all-teams at the application layer — they never
-- need Team Access values set.

-- ---------------------------------------------------------------------------
-- 1. Pick lexically-first team as members.team_id for anyone in member_teams
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'member_teams'
  ) then
    update public.members m
    set team_id = chosen.team_id
    from (
      select distinct on (mt.member_id)
        mt.member_id,
        mt.team_id
      from public.member_teams mt
      join public.teams t on t.id = mt.team_id
      order by mt.member_id, t.name asc
    ) chosen
    where m.id = chosen.member_id;

    -- ---------------------------------------------------------------------
    -- 2. Seed object_access.teams for admins currently in multiple teams.
    --    We compute the union (legacy team_id + every member_teams row),
    --    and only patch when the union has >= 2 teams. Single-team admins
    --    just keep the default ("own team") behaviour.
    -- ---------------------------------------------------------------------

    update public.members m
    set permissions = coalesce(m.permissions, '{}'::jsonb)
      || jsonb_build_object(
        'object_access',
        coalesce(m.permissions -> 'object_access', '{}'::jsonb)
          || jsonb_build_object(
            'teams',
            jsonb_build_object(
              'scope', 'selected',
              'ids',   to_jsonb(unioned.team_ids)
            )
          )
      )
    from (
      select
        m2.id as member_id,
        array(
          select distinct t_id
          from unnest(
            coalesce(
              (select array_agg(mt.team_id) from public.member_teams mt where mt.member_id = m2.id),
              array[]::uuid[]
            )
            || case when m2.team_id is null then array[]::uuid[] else array[m2.team_id] end
          ) as t_id
          where t_id is not null
        ) as team_ids
      from public.members m2
      where m2.role in ('admin', 'owner')
    ) unioned
    where m.id = unioned.member_id
      and coalesce(array_length(unioned.team_ids, 1), 0) >= 2;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Drop member_teams
-- ---------------------------------------------------------------------------

drop table if exists public.member_teams cascade;
