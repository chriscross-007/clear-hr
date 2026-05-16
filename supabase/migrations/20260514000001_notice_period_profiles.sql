-- CLE-194 — Notice Period: multi-profile model
--
-- Lifts notice rules from a single "Default" set per org to multiple named
-- profiles, mirroring approval_profiles / work_profiles. Each member points
-- at exactly one notice profile (default = org's "Default" profile,
-- auto-seeded on org create and assigned to new members via trigger).
--
-- `organisations.notice_rules_block_requests` is kept during the parallel
-- period so the legacy OrganisationEditDialog Notice Periods tab keeps
-- working. The new editor mirrors writes back to it for the Default
-- profile only. Production reads route through the booking author's
-- profile. Drop the org-level column once the legacy dialog is removed.

-- ---------------------------------------------------------------------------
-- 1. notice_period_profiles
-- ---------------------------------------------------------------------------

create table public.notice_period_profiles (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name            text not null,
  is_default      boolean not null default false,
  block_requests  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_notice_period_profiles_org_name unique (organisation_id, name)
);

create index idx_notice_period_profiles_organisation_id
  on public.notice_period_profiles(organisation_id);

-- One default per org
create unique index uq_notice_period_profiles_one_default_per_org
  on public.notice_period_profiles(organisation_id)
  where is_default = true;

create trigger set_notice_period_profiles_updated_at
  before update on public.notice_period_profiles
  for each row execute function handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Backfill: one Default profile per org, carrying the current
--    organisations.notice_rules_block_requests value across to it.
-- ---------------------------------------------------------------------------

insert into public.notice_period_profiles (organisation_id, name, is_default, block_requests)
select id, 'Default', true, coalesce(notice_rules_block_requests, false)
from public.organisations;

-- ---------------------------------------------------------------------------
-- 3. Add profile_id to notice_period_rules, backfill, make NOT NULL
-- ---------------------------------------------------------------------------

alter table public.notice_period_rules
  add column profile_id uuid references public.notice_period_profiles(id) on delete cascade;

update public.notice_period_rules npr
set profile_id = npp.id
from public.notice_period_profiles npp
where npp.organisation_id = npr.organisation_id and npp.is_default = true;

alter table public.notice_period_rules alter column profile_id set not null;

create index idx_notice_period_rules_profile_id
  on public.notice_period_rules(profile_id);

-- ---------------------------------------------------------------------------
-- 4. Per-member assignment
-- ---------------------------------------------------------------------------

alter table public.members
  add column notice_period_profile_id uuid references public.notice_period_profiles(id) on delete set null;

update public.members m
set notice_period_profile_id = npp.id
from public.notice_period_profiles npp
where npp.organisation_id = m.organisation_id and npp.is_default = true;

create index idx_members_notice_period_profile_id
  on public.members(notice_period_profile_id);

-- ---------------------------------------------------------------------------
-- 5. Trigger: assign new members to their org's Default Notice profile.
-- ---------------------------------------------------------------------------

create or replace function public.trigger_assign_notice_profile()
returns trigger
language plpgsql
security definer
as $$
declare def_id uuid;
begin
  if NEW.notice_period_profile_id is not null then
    return NEW;
  end if;
  select id into def_id from public.notice_period_profiles
    where organisation_id = NEW.organisation_id and is_default = true
    limit 1;
  NEW.notice_period_profile_id := def_id;
  return NEW;
end $$;

create trigger assign_notice_profile_on_member_insert
  before insert on public.members
  for each row execute function public.trigger_assign_notice_profile();

-- ---------------------------------------------------------------------------
-- 6. Trigger: seed a Default Notice profile when a new org is created so
--    the assign-on-member trigger above always has something to point at.
-- ---------------------------------------------------------------------------

create or replace function public.trigger_seed_default_notice_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.notice_period_profiles (organisation_id, name, is_default, block_requests)
  values (NEW.id, 'Default', true, false)
  on conflict (organisation_id, name) do nothing;
  return NEW;
end $$;

create trigger seed_default_notice_profile_on_org_insert
  after insert on public.organisations
  for each row execute function public.trigger_seed_default_notice_profile();

-- ---------------------------------------------------------------------------
-- 7. RLS on notice_period_profiles
-- ---------------------------------------------------------------------------

alter table public.notice_period_profiles enable row level security;

-- Members of the org can read all profiles in their org (needed for the
-- booking sheet client to resolve "my profile's rules + block flag").
create policy notice_period_profiles_select on public.notice_period_profiles
  for select to authenticated
  using (
    organisation_id in (
      select organisation_id from public.members where user_id = auth.uid()
    )
  );

-- Only owners can write
create policy notice_period_profiles_insert on public.notice_period_profiles
  for insert to authenticated
  with check (
    organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

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

-- Default profile cannot be deleted via RLS — non-default only.
create policy notice_period_profiles_delete on public.notice_period_profiles
  for delete to authenticated
  using (
    is_default = false
    and organisation_id in (
      select organisation_id from public.members
      where user_id = auth.uid() and role = 'owner'
    )
  );

comment on table public.notice_period_profiles is
  'CLE-194 — named sets of notice-period rules. Multiple per org; one is_default per org (auto-seeded on org create and assigned to new members).';
comment on column public.notice_period_profiles.block_requests is
  'When TRUE, the server hard-rejects holiday requests that breach this profile''s rules. When FALSE, breach surfaces as an advisory warning. Per-profile — replaces organisations.notice_rules_block_requests during the parallel period.';
