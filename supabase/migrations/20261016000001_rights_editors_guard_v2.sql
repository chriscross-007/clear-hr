-- CLE-229 — Rights-editor guard v2: close the lockout holes.
--
-- The CLE-197 guard (20260826000002) only blocked operations that
-- crossed from ≥2 rights-editors to <2. Two holes followed:
--
--   1. 1 → 0. A tenant with a single rights-editor could demote or
--      delete that editor and be left with nobody able to change
--      User Rights (out-of-band support recovery only).
--   2. Editors who can't sign in. Members with `user_id IS NULL`
--      (invited but never accepted) counted as editors, so an org
--      could keep "2 editors" on paper while nobody who can actually
--      log in holds the right.
--
-- New rule, applied identically on members and rights_profiles:
-- count only **active** editors (user_id IS NOT NULL, on a profile
-- with can_edit_rights_profiles = true). An operation is blocked when
-- it lowers that count AND the result would be below 2. In practice:
--   • ≥3 → 2 or more: allowed
--   • 2 → 1: blocked (unchanged from v1)
--   • 1 → 0: blocked (new)
--   • A tenant already at 1 can still add editors; it just can't
--     remove its last one.
--
-- Cascades from deleting the organisation itself are let through —
-- the org row is already gone by the time member rows are cascaded,
-- so the guard has nothing left to protect.
--
-- Idempotent: create or replace + drop/create trigger.

-- ---------------------------------------------------------------------------
-- 1. Members trigger
-- ---------------------------------------------------------------------------

create or replace function public.ensure_at_least_two_rights_editors_on_member()
returns trigger language plpgsql as $$
declare
  target_org          uuid := coalesce(old.organisation_id, new.organisation_id);
  other_editors       int;
  old_was_editor      boolean := false;
  new_will_be_editor  boolean := false;
  before_count        int;
  after_count         int;
begin
  if target_org is null then
    return coalesce(new, old);
  end if;

  -- Org being deleted (cascade) — nothing to protect.
  if not exists (select 1 from public.organisations where id = target_org) then
    return coalesce(new, old);
  end if;

  -- Active editors in this org, not counting the row under change.
  select count(*) into other_editors
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and m.user_id is not null
     and p.can_edit_rights_profiles = true
     and m.id <> old.id;

  if old.user_id is not null and old.rights_profile_id is not null then
    select coalesce(p.can_edit_rights_profiles, false)
      into old_was_editor
      from public.rights_profiles p
     where p.id = old.rights_profile_id;
  end if;

  if tg_op = 'UPDATE' and new.user_id is not null and new.rights_profile_id is not null then
    select coalesce(p.can_edit_rights_profiles, false)
      into new_will_be_editor
      from public.rights_profiles p
     where p.id = new.rights_profile_id;
  end if;

  before_count := other_editors + (case when old_was_editor then 1 else 0 end);
  after_count  := other_editors + (case when new_will_be_editor then 1 else 0 end);

  if after_count < before_count and after_count < 2 then
    raise exception using
      errcode = 'check_violation',
      message = case
        when after_count = 0 then
          'This would leave nobody who can change User Rights. Give another signed-in member a profile with "Edit User Rights" first.'
        else
          'At least 2 signed-in members must be able to change User Rights. Give another member a profile with "Edit User Rights" first.'
      end;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ensure_two_rights_editors_on_member on public.members;
create trigger trg_ensure_two_rights_editors_on_member
  before update or delete on public.members
  for each row execute function public.ensure_at_least_two_rights_editors_on_member();

-- ---------------------------------------------------------------------------
-- 2. Rights-profiles trigger — turning off can_edit_rights_profiles
-- ---------------------------------------------------------------------------

create or replace function public.ensure_at_least_two_rights_editors_on_profile()
returns trigger language plpgsql as $$
declare
  target_org    uuid := old.organisation_id;
  before_count  int;
  after_count   int;
begin
  -- Only guard when the flag is being turned off.
  if old.can_edit_rights_profiles = false or new.can_edit_rights_profiles = true then
    return new;
  end if;

  select count(*) into before_count
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and m.user_id is not null
     and p.can_edit_rights_profiles = true;

  select count(*) into after_count
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and m.user_id is not null
     and p.can_edit_rights_profiles = true
     and p.id <> old.id;

  if after_count < before_count and after_count < 2 then
    raise exception using
      errcode = 'check_violation',
      message = case
        when after_count = 0 then
          format('Turning off "Edit User Rights" on %s would leave nobody who can change User Rights. Give the right to another profile with signed-in members first.', old.name)
        else
          format('Turning off "Edit User Rights" on %s would leave fewer than 2 signed-in members who can change User Rights. Give the right to another profile first.', old.name)
      end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_two_rights_editors_on_profile on public.rights_profiles;
create trigger trg_ensure_two_rights_editors_on_profile
  before update on public.rights_profiles
  for each row execute function public.ensure_at_least_two_rights_editors_on_profile();
