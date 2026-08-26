-- CLE-197 — Replace the "last-Admin" guard with a "≥2 rights-editors"
-- guard. Under the flattened model, rank has no user-visible meaning;
-- the invariant we actually need to protect is bus-factor on the
-- meta permission `can_edit_rights_profiles`.
--
-- The trigger uses the same "block only operations that cross the
-- threshold" semantics as the previous version, so a tenant that
-- currently has 1 rights-editor (Chris on the Admin default) can
-- operate normally until they promote a second — then the ≥2 floor
-- becomes active.

-- ---------------------------------------------------------------------------
-- 1. Drop the old rank-based guard
-- ---------------------------------------------------------------------------

drop trigger if exists trg_ensure_at_least_one_admin on public.members;
drop function if exists public.ensure_at_least_one_admin();

-- ---------------------------------------------------------------------------
-- 2. Members trigger — fires when a member is updated (profile change)
--     or deleted. Counts rights-editors excluding the changing row and
--     blocks if the operation would drop from ≥2 to <2.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_at_least_two_rights_editors_on_member()
returns trigger language plpgsql as $$
declare
  target_org           uuid := coalesce(old.organisation_id, new.organisation_id);
  other_editors        int;
  old_was_editor       boolean := false;
  new_will_be_editor   boolean := false;
  before_count         int;
  after_count          int;
begin
  if target_org is null then
    return coalesce(new, old);
  end if;

  -- Editors in this org NOT counting the row under change.
  select count(*) into other_editors
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and p.can_edit_rights_profiles = true
     and m.id != coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  -- Was the row on an editor profile before?
  if old.rights_profile_id is not null then
    select p.can_edit_rights_profiles
      into old_was_editor
      from public.rights_profiles p
     where p.id = old.rights_profile_id;
  end if;

  -- Will the row be on an editor profile after? (DELETE = no.)
  if tg_op = 'UPDATE' and new.rights_profile_id is not null then
    select p.can_edit_rights_profiles
      into new_will_be_editor
      from public.rights_profiles p
     where p.id = new.rights_profile_id;
  end if;

  before_count := other_editors + (case when old_was_editor then 1 else 0 end);
  after_count  := other_editors + (case when new_will_be_editor then 1 else 0 end);

  if before_count >= 2 and after_count < 2 then
    raise exception 'Cannot leave organisation % with fewer than 2 members who can edit User Rights', target_org
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_ensure_two_rights_editors_on_member on public.members;
create trigger trg_ensure_two_rights_editors_on_member
  before update or delete on public.members
  for each row execute function public.ensure_at_least_two_rights_editors_on_member();

-- ---------------------------------------------------------------------------
-- 3. Rights-profiles trigger — fires when a profile is updated to
--     turn OFF can_edit_rights_profiles. Needs its own guard because
--     the members trigger only sees profile-id changes on members,
--     not flag changes on the profile itself.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_at_least_two_rights_editors_on_profile()
returns trigger language plpgsql as $$
declare
  target_org      uuid := old.organisation_id;
  editor_count    int;
begin
  -- Only guard when the flag is being turned off. Turning it on can't
  -- reduce the count.
  if old.can_edit_rights_profiles = false or new.can_edit_rights_profiles = true then
    return new;
  end if;

  -- Count members on OTHER editor profiles + members on this profile
  -- who'll lose their editor status if we allow the change.
  select count(*) into editor_count
    from public.members m
    join public.rights_profiles p on p.id = m.rights_profile_id
   where m.organisation_id = target_org
     and p.can_edit_rights_profiles = true
     and p.id != old.id;

  -- If this profile had assigned members and it's the only editor
  -- source, blocking allows the admin to reassign them first.
  if editor_count < 2 and exists (
    select 1 from public.members
     where organisation_id = target_org
       and rights_profile_id = old.id
  ) then
    raise exception 'Cannot turn off Edit User Rights on % — the organisation would drop below 2 rights-editors. Reassign members first, or grant the right to another profile first.', old.name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_two_rights_editors_on_profile on public.rights_profiles;
create trigger trg_ensure_two_rights_editors_on_profile
  before update on public.rights_profiles
  for each row execute function public.ensure_at_least_two_rights_editors_on_profile();
